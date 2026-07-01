import { test, expect, beforeEach } from "bun:test";
import { db, schema } from "../db/client";
import { resolveWorkflow } from "../lib/comfyuiClient";
import { newId } from "../lib/nanoid";

async function seedWorkflow(opts: { isDefault?: boolean; type?: string } = {}): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await db.insert(schema.workflows).values({
    id, pluginId: "comfyui", name: "Only Workflow", workflowType: opts.type ?? "t2i",
    workflowJson: "{}", isDefault: opts.isDefault ? 1 : 0, createdAt: now, updatedAt: now,
  });
  return id;
}

beforeEach(async () => {
  await db.delete(schema.workflows); // isolate from other tests
});

test("a lone non-default t2i workflow resolves when no id is requested", async () => {
  const id = await seedWorkflow({ isDefault: false });
  const wf = await resolveWorkflow("comfyui", "t2i");
  expect(wf?.id).toBe(id);
});

test("a stale/unknown explicit workflowId falls back to the only available workflow", async () => {
  // Reproduces the bug: a project's defaultWorkflowId points at a removed
  // workflow while a different, non-default one is the only one available.
  const id = await seedWorkflow({ isDefault: false });
  const wf = await resolveWorkflow("comfyui", "t2i", "deleted-workflow-id");
  expect(wf).not.toBeNull();
  expect(wf?.id).toBe(id);
});

test("a valid explicit workflowId is still honored", async () => {
  await seedWorkflow({ isDefault: true });
  const target = await seedWorkflow({ isDefault: false });
  const wf = await resolveWorkflow("comfyui", "t2i", target);
  expect(wf?.id).toBe(target);
});

test("returns null only when there is genuinely no workflow of that type", async () => {
  await seedWorkflow({ isDefault: false, type: "t2i" });
  const wf = await resolveWorkflow("comfyui", "i2i", "anything");
  expect(wf).toBeNull();
});
