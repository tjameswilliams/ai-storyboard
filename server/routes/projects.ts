import { Hono } from "hono";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { newId } from "../lib/nanoid";
import { cloneProject } from "../lib/cloneProject";
import {
  TOOL_BUCKETS,
  ALWAYS_ON_BUCKET_IDS,
  getDisabledToolBuckets,
  setDisabledToolBuckets,
} from "../lib/toolBuckets";
import { computeDimensions, isValidAspectRatio, isValidMegapixels } from "../lib/imageSize";

const app = new Hono();

app.get("/", async (c) => {
  const rows = await db.select().from(schema.projects);
  return c.json(rows);
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const rows = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
  if (rows.length === 0) return c.json({ error: "Not found" }, 404);
  return c.json(rows[0]);
});

app.post("/", async (c) => {
  const body = await c.req.json();
  const id = newId();
  const now = new Date().toISOString();

  const aspectRatio = isValidAspectRatio(body.aspectRatio) ? body.aspectRatio : "1:1";
  const megapixels = isValidMegapixels(body.megapixels) ? body.megapixels : 1;
  const { width, height } = computeDimensions(aspectRatio, megapixels);

  await db.insert(schema.projects).values({
    id,
    name: body.name || "Untitled Storyboard",
    description: body.description || "",
    aspectRatio,
    megapixels,
    width,
    height,
    defaultWorkflowId: typeof body.workflowId === "string" ? body.workflowId
      : (typeof body.defaultWorkflowId === "string" ? body.defaultWorkflowId : null),
    promptFormat: body.promptFormat === "plaintext" ? "plaintext" : "ideogram",
    createdAt: now,
    updatedAt: now,
  });
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
  return c.json(project, 201);
});

app.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();

  const updates: Record<string, unknown> = { ...body, updatedAt: new Date().toISOString() };
  // Accept `workflowId` as an alias for defaultWorkflowId from the client.
  if (typeof body.workflowId === "string") {
    updates.defaultWorkflowId = body.workflowId;
    delete (updates as Record<string, unknown>).workflowId;
  }
  // Recompute concrete dimensions whenever aspect ratio or megapixels change.
  if (body.aspectRatio !== undefined || body.megapixels !== undefined) {
    const [current] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
    const aspectRatio = isValidAspectRatio(body.aspectRatio) ? body.aspectRatio : (current?.aspectRatio ?? "1:1");
    const megapixels = isValidMegapixels(body.megapixels) ? body.megapixels : (current?.megapixels ?? 1);
    const { width, height } = computeDimensions(aspectRatio, megapixels);
    updates.aspectRatio = aspectRatio;
    updates.megapixels = megapixels;
    updates.width = width;
    updates.height = height;
  }

  await db.update(schema.projects).set(updates).where(eq(schema.projects.id, id));
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
  return c.json(project);
});

app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(schema.projects).where(eq(schema.projects.id, id));
  return c.json({ success: true });
});

app.get("/:id/toolsets", async (c) => {
  const id = c.req.param("id");
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
  if (!project) return c.json({ error: "Not found" }, 404);
  const disabled = await getDisabledToolBuckets(id);
  return c.json({
    buckets: TOOL_BUCKETS.map((b) => ({
      id: b.id,
      label: b.label,
      description: b.description,
      alwaysOn: b.alwaysOn,
      toolCount: b.toolNames.length,
      enabled: b.alwaysOn || !disabled.has(b.id),
    })),
    alwaysOnIds: Array.from(ALWAYS_ON_BUCKET_IDS),
  });
});

app.put("/:id/toolsets", async (c) => {
  const id = c.req.param("id");
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, id));
  if (!project) return c.json({ error: "Not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const disabledIds = Array.isArray(body?.disabledBucketIds) ? body.disabledBucketIds : [];
  const saved = await setDisabledToolBuckets(id, disabledIds);
  return c.json({ success: true, disabledBucketIds: saved });
});

app.post("/:id/clone", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  try {
    const { newProjectId, counts } = await cloneProject(id, body?.newName);
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, newProjectId));
    return c.json({ success: true, project, counts }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Clone failed";
    return c.json({ error: message }, 500);
  }
});

export default app;
