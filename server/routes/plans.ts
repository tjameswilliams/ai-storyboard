import { Hono } from "hono";
import { db, schema } from "../db/client";
import { eq, and, notInArray } from "drizzle-orm";

const app = new Hono();

// Get active plan for a project
app.get("/projects/:projectId/plan", async (c) => {
  const projectId = c.req.param("projectId");

  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(
      and(
        eq(schema.plans.projectId, projectId),
        notInArray(schema.plans.status, ["completed", "cancelled"])
      )
    )
    .limit(1);

  if (!plan) {
    return c.json(null);
  }

  return c.json({
    ...plan,
    steps: JSON.parse(plan.steps),
  });
});

// Cancel active plan for a project
app.delete("/projects/:projectId/plan", async (c) => {
  const projectId = c.req.param("projectId");

  const [plan] = await db
    .select()
    .from(schema.plans)
    .where(
      and(
        eq(schema.plans.projectId, projectId),
        notInArray(schema.plans.status, ["completed", "cancelled"])
      )
    )
    .limit(1);

  if (plan) {
    await db
      .update(schema.plans)
      .set({ status: "cancelled", updatedAt: new Date().toISOString() })
      .where(eq(schema.plans.id, plan.id));
  }

  return c.json({ success: true });
});

export default app;
