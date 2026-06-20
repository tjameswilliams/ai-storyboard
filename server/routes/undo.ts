import { Hono } from "hono";
import { undo, redo, getHistory } from "../lib/undoManager";

const app = new Hono();

app.post("/projects/:projectId/undo", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await undo(projectId);
  return c.json(result);
});

app.post("/projects/:projectId/redo", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await redo(projectId);
  return c.json(result);
});

app.get("/projects/:projectId/history", async (c) => {
  const projectId = c.req.param("projectId");
  const result = await getHistory(projectId);
  return c.json(result);
});

export default app;
