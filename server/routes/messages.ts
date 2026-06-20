import { Hono } from "hono";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { newId } from "../lib/nanoid";

const app = new Hono();

app.get("/projects/:projectId/messages", async (c) => {
  const projectId = c.req.param("projectId");
  const rows = await db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.projectId, projectId));
  return c.json(rows);
});

app.post("/projects/:projectId/messages", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  const id = newId();
  await db.insert(schema.chatMessages).values({
    id,
    projectId,
    role: body.role,
    content: body.content || "",
    thinking: body.thinking || null,
    toolCalls: body.toolCalls ? JSON.stringify(body.toolCalls) : null,
    segments: body.segments ? JSON.stringify(body.segments) : null,
    createdAt: new Date().toISOString(),
  });
  return c.json({ id }, 201);
});

app.delete("/projects/:projectId/messages", async (c) => {
  const projectId = c.req.param("projectId");
  await db.delete(schema.chatMessages).where(eq(schema.chatMessages.projectId, projectId));
  return c.json({ success: true });
});

// --- Image-scoped chat (a side conversation focused on one frame) ---

app.get("/images/:imageId/messages", async (c) => {
  const imageId = c.req.param("imageId");
  const rows = await db
    .select()
    .from(schema.imageChatMessages)
    .where(eq(schema.imageChatMessages.imageId, imageId));
  return c.json(rows);
});

app.post("/images/:imageId/messages", async (c) => {
  const imageId = c.req.param("imageId");
  const body = await c.req.json();
  const id = body.id || newId();
  await db.insert(schema.imageChatMessages).values({
    id,
    imageId,
    role: body.role,
    content: body.content || "",
    thinking: body.thinking || null,
    toolCalls: body.toolCalls ? JSON.stringify(body.toolCalls) : null,
    segments: body.segments ? JSON.stringify(body.segments) : null,
    createdAt: body.createdAt || new Date().toISOString(),
  });
  return c.json({ id }, 201);
});

app.delete("/images/:imageId/messages", async (c) => {
  const imageId = c.req.param("imageId");
  await db.delete(schema.imageChatMessages).where(eq(schema.imageChatMessages.imageId, imageId));
  return c.json({ success: true });
});

export default app;
