import { Hono } from "hono";
import { db, schema } from "../db/client";
import { eq, asc } from "drizzle-orm";

const app = new Hono();

// Reads + clears only. Message *writes* are owned server-side by the agent-run
// system (see chatPersistence.ts), not the client, so there are no POST routes.

app.get("/projects/:projectId/messages", async (c) => {
  const projectId = c.req.param("projectId");
  const rows = await db
    .select()
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.projectId, projectId))
    .orderBy(asc(schema.chatMessages.createdAt));
  return c.json(rows);
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
    .where(eq(schema.imageChatMessages.imageId, imageId))
    .orderBy(asc(schema.imageChatMessages.createdAt));
  return c.json(rows);
});

app.delete("/images/:imageId/messages", async (c) => {
  const imageId = c.req.param("imageId");
  await db.delete(schema.imageChatMessages).where(eq(schema.imageChatMessages.imageId, imageId));
  return c.json({ success: true });
});

export default app;
