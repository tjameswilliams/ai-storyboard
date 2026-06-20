import { Hono } from "hono";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { newId } from "../lib/nanoid";
import { mcpClientManager } from "../lib/mcp/clientManager";

const app = new Hono();

app.get("/mcp-servers", async (c) => {
  const rows = await db.select().from(schema.mcpServers);
  const connectedIds = mcpClientManager.getConnectedServerIds();
  const result = rows.map((r) => ({
    ...r,
    args: JSON.parse(r.args || "[]"),
    env: JSON.parse(r.env || "{}"),
    connected: connectedIds.includes(r.id),
    tools: mcpClientManager.getServerTools(r.id),
  }));
  return c.json(result);
});

app.post("/mcp-servers", async (c) => {
  const body = await c.req.json();
  const now = new Date().toISOString();
  const id = newId();
  const row = {
    id, name: body.name, command: body.command,
    args: JSON.stringify(body.args || []),
    env: JSON.stringify(body.env || {}),
    enabled: body.enabled !== false, createdAt: now, updatedAt: now,
  };
  await db.insert(schema.mcpServers).values(row);
  if (row.enabled) {
    try { await mcpClientManager.connectServer(row); } catch {}
  }
  return c.json({ ...row, args: body.args || [], env: body.env || {}, connected: mcpClientManager.getConnectedServerIds().includes(id) });
});

app.patch("/mcp-servers/:id", async (c) => {
  const { id } = c.req.param();
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.command !== undefined) updates.command = body.command;
  if (body.args !== undefined) updates.args = JSON.stringify(body.args);
  if (body.env !== undefined) updates.env = JSON.stringify(body.env);
  if (body.enabled !== undefined) updates.enabled = body.enabled;
  await db.update(schema.mcpServers).set(updates).where(eq(schema.mcpServers.id, id));
  await mcpClientManager.refreshServer(id);
  const [row] = await db.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id));
  return c.json({ ...row, args: JSON.parse(row.args || "[]"), env: JSON.parse(row.env || "{}"), connected: mcpClientManager.getConnectedServerIds().includes(id) });
});

app.delete("/mcp-servers/:id", async (c) => {
  const { id } = c.req.param();
  await mcpClientManager.disconnectServer(id);
  await db.delete(schema.mcpServers).where(eq(schema.mcpServers.id, id));
  return c.json({ ok: true });
});

export default app;
