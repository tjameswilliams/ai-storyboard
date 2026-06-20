import { db, schema } from "../db/client";
import { eq, and, desc, asc } from "drizzle-orm";
import { newId } from "./nanoid";
import { getUploadsDir } from "./config";
import { copyFileSync, unlinkSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import type { EntitySnapshot } from "./types";

function getFilePath(fileName: string): string {
  return resolve(getUploadsDir(), fileName);
}

export type { EntitySnapshot };

export function generateGroupId(): string {
  return newId();
}

function getUndoDir(): string {
  const dir = resolve(getUploadsDir(), ".undo");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export async function backupFile(fileName: string, actionId: string): Promise<{ originalPath: string; backupPath: string }> {
  const originalPath = getFilePath(fileName);
  const undoDir = getUndoDir();
  const backupName = `${actionId}_${fileName}`;
  const backupPath = resolve(undoDir, backupName);
  if (existsSync(originalPath)) {
    copyFileSync(originalPath, backupPath);
  }
  return { originalPath, backupPath };
}

export async function recordAction(input: {
  projectId: string;
  groupId: string;
  groupLabel: string;
  seq: number;
  toolName: string;
  source: "agent" | "ui";
  beforeState: EntitySnapshot[];
  afterState: EntitySnapshot[];
  fileBackups?: Array<{ originalPath: string; backupPath: string }>;
  filesCreated?: string[];
}): Promise<string> {
  await clearRedoStack(input.projectId);
  const id = newId();
  await db.insert(schema.undoActions).values({
    id,
    projectId: input.projectId,
    groupId: input.groupId,
    groupLabel: input.groupLabel,
    seq: input.seq,
    toolName: input.toolName,
    source: input.source,
    beforeState: JSON.stringify(input.beforeState),
    afterState: JSON.stringify(input.afterState),
    fileBackups: input.fileBackups ? JSON.stringify(input.fileBackups) : null,
    filesCreated: input.filesCreated ? JSON.stringify(input.filesCreated) : null,
    undone: 0,
    createdAt: new Date().toISOString(),
  });
  return id;
}

const tableMap = {
  images: schema.images,
} as const;

async function getRow(table: EntitySnapshot["table"], id: string): Promise<Record<string, unknown> | null> {
  const t = tableMap[table];
  const [row] = await db.select().from(t).where(eq(t.id, id));
  return (row as Record<string, unknown>) || null;
}

async function applySnapshot(snapshot: EntitySnapshot): Promise<void> {
  const t = tableMap[snapshot.table];
  const existing = await getRow(snapshot.table, snapshot.id);

  if (snapshot.row === null && existing) {
    await db.delete(t).where(eq(t.id, snapshot.id));
  } else if (snapshot.row !== null && !existing) {
    await db.insert(t).values(snapshot.row as any);
  } else if (snapshot.row !== null && existing) {
    const { id: _, ...updates } = snapshot.row;
    await db.update(t).set(updates as any).where(eq(t.id, snapshot.id));
  }
}

export async function undo(projectId: string): Promise<{ success: boolean; label?: string; canUndo: boolean; canRedo: boolean }> {
  const [latest] = await db.select()
    .from(schema.undoActions)
    .where(and(eq(schema.undoActions.projectId, projectId), eq(schema.undoActions.undone, 0)))
    .orderBy(desc(schema.undoActions.createdAt), desc(schema.undoActions.seq))
    .limit(1);

  if (!latest) {
    const state = await getUndoRedoState(projectId);
    return { success: false, ...state };
  }

  const groupId = latest.groupId;
  const groupActions = await db.select()
    .from(schema.undoActions)
    .where(and(eq(schema.undoActions.groupId, groupId)))
    .orderBy(desc(schema.undoActions.seq));

  for (const action of groupActions) {
    const beforeState: EntitySnapshot[] = JSON.parse(action.beforeState);
    for (const snapshot of beforeState) {
      await applySnapshot(snapshot);
    }

    if (action.fileBackups) {
      const backups: Array<{ originalPath: string; backupPath: string }> = JSON.parse(action.fileBackups);
      for (const backup of backups) {
        if (existsSync(backup.backupPath)) {
          copyFileSync(backup.backupPath, backup.originalPath);
        }
      }
    }

    if (action.filesCreated) {
      const files: string[] = JSON.parse(action.filesCreated);
      for (const f of files) {
        try { unlinkSync(f); } catch {}
      }
    }

    await db.update(schema.undoActions).set({ undone: 1 }).where(eq(schema.undoActions.id, action.id));
  }

  const state = await getUndoRedoState(projectId);
  return { success: true, label: latest.groupLabel, ...state };
}

export async function redo(projectId: string): Promise<{ success: boolean; label?: string; canUndo: boolean; canRedo: boolean }> {
  const [oldest] = await db.select()
    .from(schema.undoActions)
    .where(and(eq(schema.undoActions.projectId, projectId), eq(schema.undoActions.undone, 1)))
    .orderBy(asc(schema.undoActions.createdAt), asc(schema.undoActions.seq))
    .limit(1);

  if (!oldest) {
    const state = await getUndoRedoState(projectId);
    return { success: false, ...state };
  }

  const groupId = oldest.groupId;
  const groupActions = await db.select()
    .from(schema.undoActions)
    .where(and(eq(schema.undoActions.groupId, groupId)))
    .orderBy(asc(schema.undoActions.seq));

  for (const action of groupActions) {
    const afterState: EntitySnapshot[] = JSON.parse(action.afterState);
    for (const snapshot of afterState) {
      await applySnapshot(snapshot);
    }
    await db.update(schema.undoActions).set({ undone: 0 }).where(eq(schema.undoActions.id, action.id));
  }

  const state = await getUndoRedoState(projectId);
  return { success: true, label: oldest.groupLabel, ...state };
}

async function getUndoRedoState(projectId: string): Promise<{ canUndo: boolean; canRedo: boolean }> {
  const [undoRow] = await db.select({ id: schema.undoActions.id })
    .from(schema.undoActions)
    .where(and(eq(schema.undoActions.projectId, projectId), eq(schema.undoActions.undone, 0)))
    .limit(1);
  const [redoRow] = await db.select({ id: schema.undoActions.id })
    .from(schema.undoActions)
    .where(and(eq(schema.undoActions.projectId, projectId), eq(schema.undoActions.undone, 1)))
    .limit(1);
  return { canUndo: !!undoRow, canRedo: !!redoRow };
}

export async function getHistory(projectId: string) {
  const allActions = await db.select()
    .from(schema.undoActions)
    .where(eq(schema.undoActions.projectId, projectId))
    .orderBy(desc(schema.undoActions.createdAt), asc(schema.undoActions.seq));

  const undoGroups = new Map<string, typeof allActions>();
  const redoGroups = new Map<string, typeof allActions>();

  for (const action of allActions) {
    const map = action.undone === 1 ? redoGroups : undoGroups;
    if (!map.has(action.groupId)) map.set(action.groupId, []);
    map.get(action.groupId)!.push(action);
  }

  function toStack(groups: Map<string, typeof allActions>) {
    return Array.from(groups.entries()).map(([groupId, actions]) => ({
      groupId,
      label: actions[0].groupLabel,
      createdAt: actions[0].createdAt,
      actions: actions.map((a) => ({
        id: a.id,
        toolName: a.toolName,
        label: a.groupLabel,
        seq: a.seq,
      })),
    }));
  }

  const state = await getUndoRedoState(projectId);
  return { undoStack: toStack(undoGroups), redoStack: toStack(redoGroups), ...state };
}

export async function clearRedoStack(projectId: string): Promise<void> {
  const redoActions = await db.select()
    .from(schema.undoActions)
    .where(and(eq(schema.undoActions.projectId, projectId), eq(schema.undoActions.undone, 1)));

  for (const action of redoActions) {
    if (action.fileBackups) {
      const backups: Array<{ originalPath: string; backupPath: string }> = JSON.parse(action.fileBackups);
      for (const backup of backups) {
        try { unlinkSync(backup.backupPath); } catch {}
      }
    }
  }

  if (redoActions.length > 0) {
    await db.delete(schema.undoActions)
      .where(and(eq(schema.undoActions.projectId, projectId), eq(schema.undoActions.undone, 1)));
  }
}

export async function garbageCollect(projectId: string, maxGroups: number = 50): Promise<void> {
  const allActions = await db.select()
    .from(schema.undoActions)
    .where(and(eq(schema.undoActions.projectId, projectId), eq(schema.undoActions.undone, 0)))
    .orderBy(desc(schema.undoActions.createdAt));

  const groupIds = [...new Set(allActions.map((a) => a.groupId))];
  if (groupIds.length <= maxGroups) return;

  const toRemove = groupIds.slice(maxGroups);
  for (const groupId of toRemove) {
    const actions = allActions.filter((a) => a.groupId === groupId);
    for (const action of actions) {
      if (action.fileBackups) {
        const backups: Array<{ originalPath: string; backupPath: string }> = JSON.parse(action.fileBackups);
        for (const backup of backups) {
          try { unlinkSync(backup.backupPath); } catch {}
        }
      }
    }
    await db.delete(schema.undoActions).where(eq(schema.undoActions.groupId, groupId as string));
  }
}
