import { Hono } from "hono";
import { db, schema } from "../db/client";
import { eq, isNull } from "drizzle-orm";
import { newId } from "../lib/nanoid";

const app = new Hono();

// List all folders
app.get("/folders", async (c) => {
  const rows = await db.select().from(schema.folders);
  return c.json(rows);
});

// Create folder
app.post("/folders", async (c) => {
  const body = await c.req.json();
  const id = newId();
  const now = new Date().toISOString();
  await db.insert(schema.folders).values({
    id,
    name: body.name || "New Folder",
    parentId: body.parentId || null,
    order: body.order ?? 0,
    createdAt: now,
    updatedAt: now,
  });
  const [folder] = await db.select().from(schema.folders).where(eq(schema.folders.id, id));
  return c.json(folder, 201);
});

// Update folder
app.put("/folders/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  await db
    .update(schema.folders)
    .set({ ...body, updatedAt: new Date().toISOString() })
    .where(eq(schema.folders.id, id));
  const [folder] = await db.select().from(schema.folders).where(eq(schema.folders.id, id));
  return c.json(folder);
});

// Delete folder (moves contained projects to root)
app.delete("/folders/:id", async (c) => {
  const id = c.req.param("id");
  // Move projects in this folder to root
  await db
    .update(schema.projects)
    .set({ folderId: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.folderId, id));
  // Move sub-folders to root
  await db
    .update(schema.folders)
    .set({ parentId: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.folders.parentId, id));
  await db.delete(schema.folders).where(eq(schema.folders.id, id));
  return c.json({ success: true });
});

export default app;
