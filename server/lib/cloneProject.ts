import { db, schema } from "../db/client";
import { eq, inArray } from "drizzle-orm";
import { newId } from "./nanoid";
import { getUploadsDir } from "./config";
import { existsSync, copyFileSync } from "fs";
import { resolve, extname } from "path";

export interface CloneCounts {
  images: number;
  assets: number;
  messages: number;
  imageMessages: number;
  plans: number;
  files: number;
}

/**
 * Deep-clone a project: its size/model config, every storyboard image WITH its
 * generated result, the generated asset rows, the project chat conversation,
 * each image's scoped side-conversation, plans, and attached styleguides.
 *
 * Generated files on disk are physically copied so the clone is fully
 * independent — deleting one project never affects the other's images.
 */
export async function cloneProject(
  sourceId: string,
  newName?: string,
): Promise<{ newProjectId: string; counts: CloneCounts }> {
  const [source] = await db.select().from(schema.projects).where(eq(schema.projects.id, sourceId));
  if (!source) throw new Error("Source project not found");

  const newProjectId = newId();
  const now = new Date().toISOString();
  const uploads = getUploadsDir();

  // Copy each referenced upload to a fresh filename once; share the mapping so
  // an image and its asset (same source file) point at the same new copy.
  const fileMap = new Map<string, string>();
  const remapFile = (rel: string | null | undefined): string | null | undefined => {
    if (!rel) return rel;
    const existing = fileMap.get(rel);
    if (existing) return existing;
    const ext = extname(rel) || ".png";
    const newRel = `${newId()}${ext}`;
    try {
      const src = resolve(uploads, rel);
      if (existsSync(src)) copyFileSync(src, resolve(uploads, newRel));
    } catch { /* best-effort; the row still points at the new path */ }
    fileMap.set(rel, newRel);
    return newRel;
  };

  await db.insert(schema.projects).values({
    ...source,
    id: newProjectId,
    name: newName || `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  });

  // --- Assets (build id map first so images + sourceAssetIds can be remapped) ---
  const assets = await db.select().from(schema.assets).where(eq(schema.assets.projectId, sourceId));
  const assetIdMap = new Map<string, string>();
  for (const a of assets) assetIdMap.set(a.id, newId());
  for (const a of assets) {
    let sourceAssetIds = a.sourceAssetIds;
    if (sourceAssetIds) {
      try {
        const ids = JSON.parse(sourceAssetIds) as string[];
        sourceAssetIds = JSON.stringify(ids.map((id) => assetIdMap.get(id) ?? id));
      } catch { /* leave as-is */ }
    }
    await db.insert(schema.assets).values({
      ...a,
      id: assetIdMap.get(a.id)!,
      projectId: newProjectId,
      filePath: remapFile(a.filePath) as string,
      sourceAssetIds,
      createdAt: now,
      updatedAt: now,
    });
  }

  // --- Images (preserve generated state; remap asset + file refs) ---
  const images = await db.select().from(schema.images).where(eq(schema.images.projectId, sourceId));
  const imageIdMap = new Map<string, string>();
  for (const img of images) imageIdMap.set(img.id, newId());
  for (const img of images) {
    await db.insert(schema.images).values({
      ...img,
      id: imageIdMap.get(img.id)!,
      projectId: newProjectId,
      assetId: img.assetId ? (assetIdMap.get(img.assetId) ?? null) : null,
      filePath: remapFile(img.filePath) ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // --- Per-image scoped conversations ---
  let imageMessages = 0;
  const sourceImageIds = images.map((i) => i.id);
  if (sourceImageIds.length > 0) {
    const imgMsgs = await db.select().from(schema.imageChatMessages)
      .where(inArray(schema.imageChatMessages.imageId, sourceImageIds));
    for (const m of imgMsgs) {
      await db.insert(schema.imageChatMessages).values({
        ...m,
        id: newId(),
        imageId: imageIdMap.get(m.imageId)!,
      });
      imageMessages++;
    }
  }

  // --- Project conversation ---
  const messages = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.projectId, sourceId));
  for (const m of messages) {
    await db.insert(schema.chatMessages).values({ ...m, id: newId(), projectId: newProjectId });
  }

  // --- Plans ---
  const plans = await db.select().from(schema.plans).where(eq(schema.plans.projectId, sourceId));
  for (const p of plans) {
    await db.insert(schema.plans).values({ ...p, id: newId(), projectId: newProjectId, createdAt: now, updatedAt: now });
  }

  // --- Attached styleguides ---
  const attached = await db.select().from(schema.projectStyleguides)
    .where(eq(schema.projectStyleguides.projectId, sourceId));
  for (const a of attached) {
    await db.insert(schema.projectStyleguides).values({
      projectId: newProjectId,
      styleguideId: a.styleguideId,
      attachedAt: now,
    });
  }

  return {
    newProjectId,
    counts: {
      images: images.length,
      assets: assets.length,
      messages: messages.length,
      imageMessages,
      plans: plans.length,
      files: fileMap.size,
    },
  };
}
