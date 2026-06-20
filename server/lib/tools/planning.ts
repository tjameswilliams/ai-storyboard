import type { ToolHandler } from "../types";
import { db, schema } from "../../db/client";
import { eq, and, notInArray } from "drizzle-orm";
import { newId } from "../nanoid";

interface PlanStep {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed" | "skipped" | "failed";
  notes?: string;
}

interface PlanRow {
  id: string;
  projectId: string;
  title: string;
  status: string;
  steps: string;
  createdAt: string;
  updatedAt: string;
}

function parsePlan(row: PlanRow) {
  return {
    ...row,
    steps: JSON.parse(row.steps) as PlanStep[],
  };
}

async function getActivePlan(projectId: string) {
  const [row] = await db
    .select()
    .from(schema.plans)
    .where(
      and(
        eq(schema.plans.projectId, projectId),
        notInArray(schema.plans.status, ["completed", "cancelled"])
      )
    )
    .limit(1);
  return row || null;
}

export const planningTools: Record<string, ToolHandler> = {
  update_plan: async (args, projectId) => {
    const action = args.action as string;
    const now = new Date().toISOString();

    if (action === "create") {
      const title = (args.title as string) || "Untitled Plan";
      const rawSteps = (args.steps as Array<{ label: string }>) || [];

      if (rawSteps.length === 0) {
        return { success: false, result: "Plan must have at least one step" };
      }

      // Cancel any existing active plan
      const existing = await getActivePlan(projectId);
      if (existing) {
        await db
          .update(schema.plans)
          .set({ status: "cancelled", updatedAt: now })
          .where(eq(schema.plans.id, existing.id));
      }

      const steps: PlanStep[] = rawSteps.map((s) => ({
        id: newId(),
        label: s.label,
        status: "pending",
      }));

      const plan = {
        id: newId(),
        projectId,
        title,
        status: "draft",
        steps: JSON.stringify(steps),
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(schema.plans).values(plan);

      return { success: true, result: parsePlan(plan) };
    }

    if (action === "revise") {
      const active = await getActivePlan(projectId);
      if (!active) return { success: false, result: "No active plan to revise" };

      const title = (args.title as string) || active.title;
      const rawSteps = (args.steps as Array<{ label: string }>) || [];

      if (rawSteps.length === 0) {
        return { success: false, result: "Revised plan must have at least one step" };
      }

      const steps: PlanStep[] = rawSteps.map((s) => ({
        id: newId(),
        label: s.label,
        status: "pending",
      }));

      await db
        .update(schema.plans)
        .set({ title, steps: JSON.stringify(steps), updatedAt: now })
        .where(eq(schema.plans.id, active.id));

      const [updated] = await db.select().from(schema.plans).where(eq(schema.plans.id, active.id));
      return { success: true, result: parsePlan(updated) };
    }

    if (action === "add_steps") {
      const active = await getActivePlan(projectId);
      if (!active) return { success: false, result: "No active plan" };

      const rawSteps = (args.steps as Array<{ label: string }>) || [];
      if (rawSteps.length === 0) {
        return { success: false, result: "No steps to add" };
      }

      const existingSteps: PlanStep[] = JSON.parse(active.steps);
      const newSteps: PlanStep[] = rawSteps.map((s) => ({
        id: newId(),
        label: s.label,
        status: "pending",
      }));

      const allSteps = [...existingSteps, ...newSteps];

      await db
        .update(schema.plans)
        .set({ steps: JSON.stringify(allSteps), updatedAt: now })
        .where(eq(schema.plans.id, active.id));

      const [updated] = await db.select().from(schema.plans).where(eq(schema.plans.id, active.id));
      return { success: true, result: parsePlan(updated) };
    }

    if (action === "update_step") {
      const active = await getActivePlan(projectId);
      if (!active) return { success: false, result: "No active plan" };

      const stepId = args.step_id as string;
      const stepStatus = args.step_status as PlanStep["status"];
      const stepNotes = args.step_notes as string | undefined;

      if (!stepId || !stepStatus) {
        return { success: false, result: "step_id and step_status are required" };
      }

      const steps: PlanStep[] = JSON.parse(active.steps);
      const step = steps.find((s) => s.id === stepId);
      if (!step) return { success: false, result: `Step "${stepId}" not found` };

      step.status = stepStatus;
      if (stepNotes !== undefined) step.notes = stepNotes;

      // Auto-set plan status to executing if a step is being worked on
      let planStatus = active.status;
      if (stepStatus === "in_progress" && (planStatus === "draft" || planStatus === "approved")) {
        planStatus = "executing";
      }

      // Auto-complete plan if all steps are done
      const allDone = steps.every((s) => ["completed", "skipped", "failed"].includes(s.status));
      if (allDone) {
        planStatus = "completed";
      }

      await db
        .update(schema.plans)
        .set({ steps: JSON.stringify(steps), status: planStatus, updatedAt: now })
        .where(eq(schema.plans.id, active.id));

      const [updated] = await db.select().from(schema.plans).where(eq(schema.plans.id, active.id));
      return { success: true, result: parsePlan(updated) };
    }

    if (action === "set_status") {
      const active = await getActivePlan(projectId);
      if (!active) return { success: false, result: "No active plan" };

      const planStatus = args.plan_status as string;
      if (!planStatus) return { success: false, result: "plan_status is required" };

      const steps: PlanStep[] = JSON.parse(active.steps);

      // When starting execution, auto-mark first pending step as in_progress
      if (planStatus === "executing") {
        const firstPending = steps.find((s) => s.status === "pending");
        if (firstPending) firstPending.status = "in_progress";
      }

      await db
        .update(schema.plans)
        .set({ status: planStatus, steps: JSON.stringify(steps), updatedAt: now })
        .where(eq(schema.plans.id, active.id));

      const [updated] = await db.select().from(schema.plans).where(eq(schema.plans.id, active.id));
      return { success: true, result: parsePlan(updated) };
    }

    return { success: false, result: `Unknown action: ${action}` };
  },
};
