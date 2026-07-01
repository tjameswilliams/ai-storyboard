import { Hono } from "hono";
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";
import { writeFile, unlink } from "fs/promises";
import { db, schema } from "../db/client";
import { and, eq, desc, asc, sql } from "drizzle-orm";
import { newId } from "../lib/nanoid";
import { getUploadsDir } from "../lib/config";

const app = new Hono();

function ensureUploadsDir(): string {
  const uploadsDir = getUploadsDir();
  if (!existsSync(uploadsDir)) mkdirSync(uploadsDir, { recursive: true });
  return uploadsDir;
}

function mimeFromExt(ext: string): string | null {
  const m: Record<string, string> = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp",
  };
  return m[ext.toLowerCase()] ?? null;
}

async function loadStyleguideDetail(id: string) {
  const [sg] = await db.select().from(schema.styleguides).where(eq(schema.styleguides.id, id));
  if (!sg) return null;

  const assets = await db.select().from(schema.styleguideAssets)
    .where(eq(schema.styleguideAssets.styleguideId, id))
    .orderBy(schema.styleguideAssets.order, schema.styleguideAssets.createdAt);

  const attachedProjects = await db.select({
    projectId: schema.projectStyleguides.projectId,
    projectName: schema.projects.name,
    attachedAt: schema.projectStyleguides.attachedAt,
  })
    .from(schema.projectStyleguides)
    .innerJoin(schema.projects, eq(schema.projects.id, schema.projectStyleguides.projectId))
    .where(eq(schema.projectStyleguides.styleguideId, id));

  return { ...sg, assets, attachedProjects };
}

// ===== Styleguide CRUD =====

app.get("/styleguides", async (c) => {
  const rows = await db.select({
    id: schema.styleguides.id,
    name: schema.styleguides.name,
    description: schema.styleguides.description,
    markdown: schema.styleguides.markdown,
    createdAt: schema.styleguides.createdAt,
    updatedAt: schema.styleguides.updatedAt,
    attachedProjectCount: sql<number>`(SELECT COUNT(*) FROM ${schema.projectStyleguides} WHERE ${schema.projectStyleguides.styleguideId} = ${schema.styleguides.id})`,
  }).from(schema.styleguides).orderBy(desc(schema.styleguides.updatedAt));
  return c.json(rows);
});

app.get("/styleguides/:id", async (c) => {
  const detail = await loadStyleguideDetail(c.req.param("id"));
  if (!detail) return c.json({ error: "Not found" }, 404);
  return c.json(detail);
});

app.post("/styleguides", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const id = newId();
  const now = new Date().toISOString();
  await db.insert(schema.styleguides).values({
    id,
    name: body.name || "Untitled Styleguide",
    description: body.description || "",
    markdown: body.markdown || "",
    createdAt: now,
    updatedAt: now,
  });
  const detail = await loadStyleguideDetail(id);
  return c.json(detail, 201);
});

app.patch("/styleguides/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.markdown !== undefined) updates.markdown = body.markdown;
  await db.update(schema.styleguides).set(updates).where(eq(schema.styleguides.id, id));
  const detail = await loadStyleguideDetail(id);
  if (!detail) return c.json({ error: "Not found" }, 404);
  return c.json(detail);
});

app.delete("/styleguides/:id", async (c) => {
  const id = c.req.param("id");
  // Cascade will remove styleguide_assets, project_styleguides, and
  // styleguide_chat_messages via FK ON DELETE CASCADE. Brand asset files on
  // disk are cleaned up here (best-effort).
  const brandAssets = await db.select().from(schema.styleguideAssets)
    .where(eq(schema.styleguideAssets.styleguideId, id));
  for (const a of brandAssets) {
    try { await unlink(resolve(ensureUploadsDir(), a.filePath)); } catch { /* ignore */ }
  }
  await db.delete(schema.styleguides).where(eq(schema.styleguides.id, id));
  return c.json({ success: true });
});

// ===== Brand asset upload + linking =====

app.post("/styleguides/:id/assets", async (c) => {
  const styleguideId = c.req.param("id");
  const [sg] = await db.select().from(schema.styleguides).where(eq(schema.styleguides.id, styleguideId));
  if (!sg) return c.json({ error: "Styleguide not found" }, 404);

  const formData = await c.req.formData();
  const file = formData.get("file") as File | null;
  const role = (formData.get("role") as string) || "reference";
  const label = (formData.get("label") as string) || "";
  if (!file) return c.json({ error: "No file provided" }, 400);

  const id = newId();
  const ext = (file.name.split(".").pop() || "bin").toLowerCase();
  const storedName = `sg-${id}.${ext}`;
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await writeFile(resolve(ensureUploadsDir(), storedName), buffer);

  await db.insert(schema.styleguideAssets).values({
    id,
    styleguideId,
    filePath: storedName,
    fileName: file.name,
    mimeType: mimeFromExt(ext),
    fileSize: buffer.length,
    role,
    label,
    order: 0,
    createdAt: new Date().toISOString(),
  });

  // Bump styleguide updatedAt
  await db.update(schema.styleguides)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.styleguides.id, styleguideId));

  const [row] = await db.select().from(schema.styleguideAssets).where(eq(schema.styleguideAssets.id, id));
  return c.json(row, 201);
});

app.patch("/styleguides/:id/assets/:assetId", async (c) => {
  const styleguideId = c.req.param("id");
  const assetId = c.req.param("assetId");
  const body = await c.req.json();
  const updates: Record<string, unknown> = {};
  if (body.role !== undefined) updates.role = body.role;
  if (body.label !== undefined) updates.label = body.label;
  if (body.order !== undefined) updates.order = body.order;
  await db.update(schema.styleguideAssets).set(updates).where(and(
    eq(schema.styleguideAssets.id, assetId),
    eq(schema.styleguideAssets.styleguideId, styleguideId),
  ));
  const [row] = await db.select().from(schema.styleguideAssets).where(eq(schema.styleguideAssets.id, assetId));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json(row);
});

app.delete("/styleguides/:id/assets/:assetId", async (c) => {
  const styleguideId = c.req.param("id");
  const assetId = c.req.param("assetId");
  const [row] = await db.select().from(schema.styleguideAssets).where(and(
    eq(schema.styleguideAssets.id, assetId),
    eq(schema.styleguideAssets.styleguideId, styleguideId),
  ));
  if (!row) return c.json({ error: "Not found" }, 404);
  try { await unlink(resolve(ensureUploadsDir(), row.filePath)); } catch { /* ignore */ }
  await db.delete(schema.styleguideAssets).where(eq(schema.styleguideAssets.id, assetId));
  return c.json({ success: true });
});

// ===== Project attachment =====

app.get("/projects/:projectId/styleguides", async (c) => {
  const projectId = c.req.param("projectId");
  const rows = await db.select({
    id: schema.styleguides.id,
    name: schema.styleguides.name,
    description: schema.styleguides.description,
    updatedAt: schema.styleguides.updatedAt,
    attachedAt: schema.projectStyleguides.attachedAt,
  })
    .from(schema.projectStyleguides)
    .innerJoin(schema.styleguides, eq(schema.styleguides.id, schema.projectStyleguides.styleguideId))
    .where(eq(schema.projectStyleguides.projectId, projectId))
    .orderBy(desc(schema.projectStyleguides.attachedAt));
  return c.json(rows);
});

app.post("/projects/:projectId/styleguides", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const styleguideId = body.styleguideId as string;
  if (!styleguideId) return c.json({ error: "styleguideId required" }, 400);

  // Verify both exist
  const [proj] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!proj) return c.json({ error: "Project not found" }, 404);
  const [sg] = await db.select().from(schema.styleguides).where(eq(schema.styleguides.id, styleguideId));
  if (!sg) return c.json({ error: "Styleguide not found" }, 404);

  // Idempotent: ignore duplicates via ON CONFLICT DO NOTHING via upsert
  try {
    await db.insert(schema.projectStyleguides).values({
      projectId,
      styleguideId,
      attachedAt: new Date().toISOString(),
    });
  } catch {
    // Duplicate (already attached) — treat as success
  }
  return c.json({ success: true });
});

app.delete("/projects/:projectId/styleguides/:styleguideId", async (c) => {
  const projectId = c.req.param("projectId");
  const styleguideId = c.req.param("styleguideId");
  await db.delete(schema.projectStyleguides).where(and(
    eq(schema.projectStyleguides.projectId, projectId),
    eq(schema.projectStyleguides.styleguideId, styleguideId),
  ));
  return c.json({ success: true });
});

// ===== Styleguide chat =====

app.get("/styleguides/:id/messages", async (c) => {
  const styleguideId = c.req.param("id");
  const rows = await db.select().from(schema.styleguideChatMessages)
    .where(eq(schema.styleguideChatMessages.styleguideId, styleguideId))
    .orderBy(asc(schema.styleguideChatMessages.createdAt));
  return c.json(rows.map((r: typeof schema.styleguideChatMessages.$inferSelect) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    thinking: r.thinking,
    toolCalls: r.toolCalls ? JSON.parse(r.toolCalls) : undefined,
    segments: r.segments ? JSON.parse(r.segments) : undefined,
    createdAt: r.createdAt,
  })));
});

app.delete("/styleguides/:id/messages", async (c) => {
  const styleguideId = c.req.param("id");
  await db.delete(schema.styleguideChatMessages)
    .where(eq(schema.styleguideChatMessages.styleguideId, styleguideId));
  return c.json({ success: true });
});
export default app;
