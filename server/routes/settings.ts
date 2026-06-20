import { Hono } from "hono";
import { db, schema } from "../db/client";

const app = new Hono();

app.get("/settings", async (c) => {
  const rows = await db.select().from(schema.settings);
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return c.json(result);
});

app.put("/settings", async (c) => {
  const body = await c.req.json();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== "string") continue;
    await db
      .insert(schema.settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  }
  const rows = await db.select().from(schema.settings);
  const result: Record<string, string> = {};
  for (const row of rows) result[row.key] = row.value;
  return c.json(result);
});

export default app;
