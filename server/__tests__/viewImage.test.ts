import { test, expect, beforeEach } from "bun:test";
import { writeFileSync } from "fs";
import { resolve } from "path";
import { db, schema } from "../db/client";
import { executeToolCall } from "../lib/toolExecutor";
import { getUploadsDir } from "../lib/config";
import { newId } from "../lib/nanoid";
import { registry } from "../lib/agentRuns";
import { runAgentLoop, type AgentLoopContext } from "../lib/agentLoop";
import { fakeLLM } from "./fakeLLM";
import { seedProject, seedImage } from "./helpers";

async function seedGeneratedImage(projectId: string, filePath: string | null, assetId?: string): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await db.insert(schema.images).values({
    id, projectId, order: 0, status: "generated", filePath, assetId: assetId ?? null, createdAt: now, updatedAt: now,
  });
  return id;
}

async function seedImageAsset(projectId: string, filePath: string): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await db.insert(schema.assets).values({
    id, projectId, type: "image", filePath, fileName: "render.png", generationTool: "generate_image", createdAt: now, updatedAt: now,
  });
  return id;
}

// --- Handler -----------------------------------------------------------

test("view_image returns the generated frame's file", async () => {
  const projectId = await seedProject();
  const imageId = await seedGeneratedImage(projectId, "renders/frame.png");
  const res = await executeToolCall("view_image", { image_id: imageId }, projectId);
  expect(res.success).toBe(true);
  expect((res.result as any).file).toBe("renders/frame.png");
  expect((res.result as any).image_id).toBe(imageId);
});

test("view_image errors clearly when the frame has no generated image", async () => {
  const projectId = await seedProject();
  const imageId = await seedImage(projectId); // draft, no filePath
  const res = await executeToolCall("view_image", { image_id: imageId }, projectId);
  expect(res.success).toBe(false);
  expect(String(res.result)).toMatch(/no generated image/i);
});

test("view_image falls back to the linked asset when the frame has no filePath", async () => {
  const projectId = await seedProject();
  const assetId = await seedImageAsset(projectId, "renders/from-asset.png");
  const imageId = await seedGeneratedImage(projectId, null, assetId);
  const res = await executeToolCall("view_image", { image_id: imageId }, projectId);
  expect(res.success).toBe(true);
  expect((res.result as any).file).toBe("renders/from-asset.png");
});

test("view_image with asset_id returns that asset's file", async () => {
  const projectId = await seedProject();
  const imageId = await seedImage(projectId);
  const assetId = await seedImageAsset(projectId, "renders/specific.png");
  const res = await executeToolCall("view_image", { image_id: imageId, asset_id: assetId }, projectId);
  expect(res.success).toBe(true);
  expect((res.result as any).file).toBe("renders/specific.png");
  expect((res.result as any).asset_id).toBe(assetId);
});

test("view_image refuses an image from another project", async () => {
  const p1 = await seedProject();
  const p2 = await seedProject();
  const imageId = await seedGeneratedImage(p1, "renders/frame.png");
  const res = await executeToolCall("view_image", { image_id: imageId }, p2);
  expect(res.success).toBe(false);
  expect(String(res.result)).toMatch(/not found in this project/i);
});

// --- Loop injection ----------------------------------------------------

beforeEach(() => registry.reset());

function baseCtx(over: Partial<AgentLoopContext> = {}): AgentLoopContext {
  return {
    conversation: [{ role: "system", content: "sys" }, { role: "user", content: "look at frame 1" }],
    allTools: [], toolsJson: "[]", contextWindow: 128000, threshold: 100000,
    visionCapable: true, activePlanContext: null, projectId: null, systemPrompt: "sys",
    latestUserMessage: { id: "u1", content: "look at frame 1", createdAt: new Date().toISOString() },
    clientMessageCount: 1, uploadsDir: getUploadsDir(),
    ...over,
  };
}

test("a successful view_image injects the real image as a vision message in the next LLM call", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });

  // Drop a file the loop can read + (try to) resize.
  const fileName = `test-render-${newId()}.png`;
  writeFileSync(resolve(getUploadsDir(), fileName), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const llm = fakeLLM([
    { toolCalls: [{ id: "tc1", name: "view_image", arguments: { image_id: "img1" } }], finishReason: "tool_calls" },
    { content: "Looks good.", finishReason: "stop" },
  ]);

  await runAgentLoop(run, baseCtx({ projectId, visionCapable: true }), {
    streamChat: llm,
    isExternalTool: () => false,
    callExternalTool: async () => ({ success: true, result: {} }),
    executeToolCall: async () => ({ success: true, result: { file: fileName, image_id: "img1" } }),
  });

  // The second LLM call's conversation must include a vision user message with
  // an image_url part (the injected render).
  expect(llm.calls.length).toBe(2);
  const secondConvo = llm.calls[1] as Array<{ role: string; content: unknown }>;
  const hasInjectedImage = secondConvo.some(
    (m) => m.role === "user" && Array.isArray(m.content) && (m.content as any[]).some((p) => p.type === "image_url"),
  );
  expect(hasInjectedImage).toBe(true);
});
