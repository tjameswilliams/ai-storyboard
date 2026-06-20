import { Hono } from "hono";
import { db, schema } from "../db/client";
import { eq, asc, sql } from "drizzle-orm";
import { newId } from "../lib/nanoid";
import { validateLayout, stringifyLayout, emptyLayout, parseLayout } from "../lib/layout";
import { runImageGeneration } from "../lib/imageGeneration";

const app = new Hono();

function serializeImage(row: typeof schema.images.$inferSelect) {
  return { ...row, layout: parseLayout(row.layout) };
}

// List images for a project, ordered.
app.get("/projects/:projectId/images", async (c) => {
  const projectId = c.req.param("projectId");
  const rows = await db.select().from(schema.images)
    .where(eq(schema.images.projectId, projectId))
    .orderBy(asc(schema.images.order), asc(schema.images.createdAt));
  return c.json(rows.map(serializeImage));
});

// Create an image (optionally after a given image in the sequence).
app.post("/projects/:projectId/images", async (c) => {
  const projectId = c.req.param("projectId");
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) return c.json({ error: "Project not found" }, 404);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));

  // Default new image to the end of the sequence.
  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(schema.images)
    .where(eq(schema.images.projectId, projectId));
  let order = Number(count);

  // If afterImageId given, insert right after it and shift the rest down.
  const afterImageId = body.afterImageId as string | undefined;
  if (afterImageId) {
    const [after] = await db.select().from(schema.images).where(eq(schema.images.id, afterImageId));
    if (after && after.projectId === projectId) {
      order = after.order + 1;
      await db.update(schema.images)
        .set({ order: sql`${schema.images.order} + 1` })
        .where(sql`${schema.images.projectId} = ${projectId} AND ${schema.images.order} >= ${order}`);
    }
  }

  let layoutStr = stringifyLayout(emptyLayout());
  if (body.layout !== undefined) {
    const v = validateLayout(body.layout);
    if (!v.ok) return c.json({ error: v.error }, 400);
    layoutStr = stringifyLayout(v.layout);
  }

  const id = newId();
  const now = new Date().toISOString();
  await db.insert(schema.images).values({
    id,
    projectId,
    name: (body.name as string) ?? "",
    order,
    layout: layoutStr,
    plainPrompt: (body.plainPrompt as string) ?? "",
    negativePrompt: (body.negativePrompt as string) ?? "",
    status: "draft",
    createdAt: now,
    updatedAt: now,
  });
  const [row] = await db.select().from(schema.images).where(eq(schema.images.id, id));
  return c.json(serializeImage(row), 201);
});

app.get("/images/:id", async (c) => {
  const id = c.req.param("id");
  const [row] = await db.select().from(schema.images).where(eq(schema.images.id, id));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(serializeImage(row));
});

// Update name / layout / plainPrompt / negativePrompt.
app.put("/images/:id", async (c) => {
  const id = c.req.param("id");
  const [existing] = await db.select().from(schema.images).where(eq(schema.images.id, id));
  if (!existing) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  if (body.name !== undefined) updates.name = body.name;
  if (body.plainPrompt !== undefined) updates.plainPrompt = body.plainPrompt;
  if (body.negativePrompt !== undefined) updates.negativePrompt = body.negativePrompt;
  if (body.layout !== undefined) {
    const v = validateLayout(body.layout);
    if (!v.ok) return c.json({ error: v.error }, 400);
    updates.layout = stringifyLayout(v.layout);
  }

  await db.update(schema.images).set(updates).where(eq(schema.images.id, id));
  const [row] = await db.select().from(schema.images).where(eq(schema.images.id, id));
  return c.json(serializeImage(row));
});

app.delete("/images/:id", async (c) => {
  const id = c.req.param("id");
  const [existing] = await db.select().from(schema.images).where(eq(schema.images.id, id));
  if (!existing) return c.json({ error: "Not found" }, 404);

  await db.delete(schema.images).where(eq(schema.images.id, id));

  // Re-pack order of remaining siblings.
  const rest = await db.select().from(schema.images)
    .where(eq(schema.images.projectId, existing.projectId))
    .orderBy(asc(schema.images.order), asc(schema.images.createdAt));
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].order !== i) {
      await db.update(schema.images).set({ order: i }).where(eq(schema.images.id, rest[i].id));
    }
  }
  return c.json({ success: true });
});

// Reorder: body { imageIds: string[] } in the desired sequence.
app.put("/projects/:projectId/images/reorder", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const imageIds = Array.isArray(body.imageIds) ? (body.imageIds as string[]) : [];
  const now = new Date().toISOString();
  for (let i = 0; i < imageIds.length; i++) {
    await db.update(schema.images)
      .set({ order: i, updatedAt: now })
      .where(eq(schema.images.id, imageIds[i]));
  }
  const rows = await db.select().from(schema.images)
    .where(eq(schema.images.projectId, projectId))
    .orderBy(asc(schema.images.order), asc(schema.images.createdAt));
  return c.json(rows.map(serializeImage));
});

// Generate / regenerate the picture for an image.
async function handleGenerate(c: any, regenerate: boolean) {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const seed = typeof body.seed === "number" ? (body.seed as number) : (regenerate ? undefined : (body.seed as number | undefined));
  const workflowId = typeof body.workflowId === "string" ? (body.workflowId as string) : undefined;

  const outcome = await runImageGeneration(id, { seed, workflowId });
  if (!outcome.success) return c.json({ error: outcome.error }, 400);
  const [row] = await db.select().from(schema.images).where(eq(schema.images.id, id));
  return c.json(serializeImage(row));
}

app.post("/images/:id/generate", (c) => handleGenerate(c, false));
app.post("/images/:id/regenerate", (c) => handleGenerate(c, true));

export default app;
