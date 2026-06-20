import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { newId } from "./nanoid";

/**
 * Deep-clone a project and its storyboard images. Generated assets and chat
 * history are intentionally NOT copied — a clone starts with the same image
 * layouts (drafts) but its own generation/chat state. Attached styleguides are
 * re-attached so brand context carries over.
 */
export async function cloneProject(
  sourceId: string,
  newName?: string,
): Promise<{ newProjectId: string; counts: { images: number } }> {
  const [source] = await db.select().from(schema.projects).where(eq(schema.projects.id, sourceId));
  if (!source) throw new Error("Source project not found");

  const newProjectId = newId();
  const now = new Date().toISOString();

  await db.insert(schema.projects).values({
    ...source,
    id: newProjectId,
    name: newName || `${source.name} (copy)`,
    createdAt: now,
    updatedAt: now,
  });

  const images = await db.select().from(schema.images).where(eq(schema.images.projectId, sourceId));
  for (const img of images) {
    await db.insert(schema.images).values({
      ...img,
      id: newId(),
      projectId: newProjectId,
      // Reset generation state — the clone hasn't generated anything yet.
      status: "draft",
      assetId: null,
      filePath: null,
      seed: null,
      genWidth: null,
      genHeight: null,
      workflowId: null,
      lastError: null,
      executedWorkflowJson: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  // Re-attach styleguides.
  const attached = await db.select().from(schema.projectStyleguides)
    .where(eq(schema.projectStyleguides.projectId, sourceId));
  for (const a of attached) {
    await db.insert(schema.projectStyleguides).values({
      projectId: newProjectId,
      styleguideId: a.styleguideId,
      attachedAt: now,
    });
  }

  return { newProjectId, counts: { images: images.length } };
}
