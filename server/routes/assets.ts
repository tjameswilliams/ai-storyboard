import { Hono } from "hono";
import { db, schema } from "../db/client";
import { eq, desc } from "drizzle-orm";
import { searchAssetsSemantic } from "../lib/assetEmbeddings";
import { getUploadsDir } from "../lib/config";
import { resolve } from "path";
import { existsSync, unlinkSync } from "fs";

const app = new Hono();

function getFilePath(fileName: string): string {
  return resolve(getUploadsDir(), fileName);
}

// Stripped list-view shape — `executed_workflow_json` can be 5–50KB per row
// and is only needed when inspecting a single asset, so we exclude it from
// list/search responses to keep the payload light.
function stripWorkflowJson<T extends { executedWorkflowJson?: string | null }>(asset: T): Omit<T, "executedWorkflowJson"> {
  const { executedWorkflowJson: _unused, ...rest } = asset;
  return rest;
}

// List assets for a project
app.get("/assets", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  const type = c.req.query("type");
  const limit = Math.min(parseInt(c.req.query("limit") || "50"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  let rows = await db.select().from(schema.assets)
    .where(eq(schema.assets.projectId, projectId))
    .orderBy(desc(schema.assets.createdAt))
    .limit(limit)
    .offset(offset);

  if (type) rows = rows.filter((a) => a.type === type);

  return c.json(rows.map(stripWorkflowJson));
});

// Get single asset
app.get("/assets/:id", async (c) => {
  const id = c.req.param("id");
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, id));
  if (!asset) return c.json({ error: "Asset not found" }, 404);
  return c.json(asset);
});

// Text search
app.get("/assets/search", async (c) => {
  const projectId = c.req.query("projectId");
  if (!projectId) return c.json({ error: "projectId required" }, 400);

  const q = (c.req.query("q") || "").toLowerCase();
  const type = c.req.query("type");

  const rows = await db.select().from(schema.assets)
    .where(eq(schema.assets.projectId, projectId))
    .orderBy(desc(schema.assets.createdAt));

  const matches = rows.filter((a) => {
    if (type && a.type !== type) return false;
    const searchable = [a.prompt, a.fileName, a.tags, a.workflowName]
      .filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(q);
  });

  return c.json(matches.map(stripWorkflowJson));
});

// Semantic search
app.post("/assets/search-semantic", async (c) => {
  const body = await c.req.json();
  const { projectId, query, topK, type } = body;
  if (!projectId || !query) return c.json({ error: "projectId and query required" }, 400);

  const results = await searchAssetsSemantic(projectId, query, { type, topK });
  return c.json(results);
});

// Update asset (tags, favorite, fileName, description)
app.put("/assets/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();

  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.tags !== undefined) updates.tags = JSON.stringify(body.tags);
  if (body.favorite !== undefined) updates.favorite = body.favorite ? 1 : 0;
  if (body.fileName !== undefined) updates.fileName = body.fileName;
  if (body.description !== undefined) updates.description = body.description;

  await db.update(schema.assets).set(updates).where(eq(schema.assets.id, id));
  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, id));
  return c.json(asset);
});

// Delete asset
app.delete("/assets/:id", async (c) => {
  const id = c.req.param("id");
  const deleteFile = c.req.query("deleteFile") === "true";

  const [asset] = await db.select().from(schema.assets).where(eq(schema.assets.id, id));
  if (!asset) return c.json({ error: "Asset not found" }, 404);

  await db.delete(schema.assetEmbeddings).where(eq(schema.assetEmbeddings.assetId, id));
  await db.delete(schema.assets).where(eq(schema.assets.id, id));

  if (deleteFile) {
    try {
      const fullPath = getFilePath(asset.filePath);
      if (existsSync(fullPath)) unlinkSync(fullPath);
    } catch { /* ignore */ }
  }

  return c.json({ success: true });
});

export default app;
