import { test, expect, beforeEach } from "bun:test";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { registry, type RunEvent } from "../lib/agentRuns";
import {
  runAgentLoop,
  executeToolTurn,
  appendVisionFollowup,
  maybeSummarize,
  type AgentLoopContext,
  type AgentLoopDeps,
} from "../lib/agentLoop";
import type { RawToolCall } from "../lib/agentStream";
import { fakeLLM } from "./fakeLLM";
import { seedProject, seedStyleguide } from "./helpers";

beforeEach(() => registry.reset());

function baseCtx(over: Partial<AgentLoopContext> = {}): AgentLoopContext {
  return {
    conversation: [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
    allTools: [],
    toolsJson: "[]",
    contextWindow: 128000,
    threshold: 100000,
    visionCapable: false,
    activePlanContext: null,
    projectId: null,
    systemPrompt: "sys",
    latestUserMessage: { id: "u1", content: "hi", createdAt: new Date().toISOString() },
    clientMessageCount: 1,
    ...over,
  };
}

function noTools(): Pick<AgentLoopDeps, "executeToolCall" | "isExternalTool" | "callExternalTool"> {
  return {
    isExternalTool: () => false,
    callExternalTool: async () => ({ success: true, result: {} }),
    executeToolCall: async () => ({ success: true, result: {} }),
  };
}

test("a plain text answer streams, completes, and persists one assistant message", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  const events: RunEvent[] = [];
  run.subscribe(0, (e) => events.push(e));

  const llm = fakeLLM([{ content: "Hello world", finishReason: "stop" }]);
  await runAgentLoop(run, baseCtx({ projectId }), { streamChat: llm, ...noTools() });

  expect(run.status).toBe("complete");
  expect(run.content).toBe("Hello world");
  const types = events.map((e) => e.type);
  expect(types).toContain("assistant_msg_id");
  expect(types).toContain("content");
  expect(types[types.length - 1]).toBe("done");

  const [msg] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, run.assistantMsgId));
  expect(msg.status).toBe("complete");
  expect(msg.content).toBe("Hello world");
});

test("a tool call executes, emits a result, then the final answer is produced", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });

  const llm = fakeLLM([
    { toolCalls: [{ id: "tc1", name: "add_region", arguments: { x_min: 0 } }], finishReason: "tool_calls" },
    { content: "Added the region.", finishReason: "stop" },
  ]);
  const executed: string[] = [];
  await runAgentLoop(run, baseCtx({ projectId }), {
    streamChat: llm,
    isExternalTool: () => false,
    callExternalTool: async () => ({ success: true, result: {} }),
    executeToolCall: async (name) => { executed.push(name); return { success: true, result: { ok: true } }; },
  });

  expect(executed).toEqual(["add_region"]);
  expect(llm.calls.length).toBe(2); // tool turn + answer turn
  expect(run.toolCalls).toHaveLength(1);
  expect(run.toolCalls[0].name).toBe("add_region");
  expect(run.content).toBe("Added the region.");

  const [msg] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, run.assistantMsgId));
  expect(JSON.parse(msg.toolCalls!)[0].name).toBe("add_region");
  expect(JSON.parse(msg.segments!).some((s: any) => s.type === "tool_call")).toBe(true);
});

test("an LLM error fails the run and persists the partial", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  const events: RunEvent[] = [];
  run.subscribe(0, (e) => events.push(e));

  const boom: AgentLoopDeps["streamChat"] = async () => { throw new Error("network down"); };
  await runAgentLoop(run, baseCtx({ projectId }), { streamChat: boom, ...noTools() });

  expect(run.status).toBe("error");
  expect(events.some((e) => e.type === "error" && /network down/.test(String((e.data as any).message)))).toBe(true);
});

test("detaching a subscriber mid-run does NOT stop the run (background continues)", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });

  const received: RunEvent[] = [];
  const unsub = run.subscribe(0, (e) => { received.push(e); if (e.type === "content") unsub(); });

  const llm = fakeLLM([{ content: "abc", finishReason: "stop" }]);
  await runAgentLoop(run, baseCtx({ projectId }), { streamChat: llm, ...noTools() });

  // Subscriber bailed after the first content event, but the run still finished
  // and persisted its full output.
  expect(run.status).toBe("complete");
  const [msg] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, run.assistantMsgId));
  expect(msg.content).toBe("abc");
});

test("a pre-cancelled run never calls the LLM and ends cancelled", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  run.cancel();
  await new Promise((r) => setTimeout(r, 5));

  const llm = fakeLLM([{ content: "should not run", finishReason: "stop" }]);
  await runAgentLoop(run, baseCtx({ projectId }), { streamChat: llm, ...noTools() });

  expect(llm.calls.length).toBe(0);
  expect(run.status).toBe("cancelled");
});

test("two conversations run concurrently and persist independently", async () => {
  const p1 = await seedProject();
  const p2 = await seedProject();
  const r1 = await registry.create({ scope: "project", id: p1 }, { projectId: p1 });
  const r2 = await registry.create({ scope: "project", id: p2 }, { projectId: p2 });

  await Promise.all([
    runAgentLoop(r1, baseCtx({ projectId: p1 }), { streamChat: fakeLLM([{ content: "one" }]), ...noTools() }),
    runAgentLoop(r2, baseCtx({ projectId: p2 }), { streamChat: fakeLLM([{ content: "two" }]), ...noTools() }),
  ]);

  expect(r1.status).toBe("complete");
  expect(r2.status).toBe("complete");
  const [m1] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, r1.assistantMsgId));
  const [m2] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, r2.assistantMsgId));
  expect(m1.content).toBe("one");
  expect(m2.content).toBe("two");
});

// --- Unit tests for the extracted turn helpers -------------------------------

function rawToolCall(id: string, name: string, args: unknown): RawToolCall {
  return { id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } };
}

const passthroughAborted = () => false;
const oneGroup = { groupId: "g1", nextSeq: (() => { let n = 0; return () => n++; })() };

test("executeToolTurn routes internal vs external tools and records results", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  const ctx = baseCtx({ projectId });

  const internal: string[] = [];
  const external: string[] = [];
  const deps = {
    isExternalTool: (name: string) => name === "mcp_tool",
    callExternalTool: async (name: string) => { external.push(name); return { success: true, result: { via: "mcp" } }; },
    executeToolCall: async (name: string) => { internal.push(name); return { success: true, result: { via: "local" } }; },
  };

  const res = await executeToolTurn(
    run, ctx, deps,
    [rawToolCall("t1", "add_region", { x: 0 }), rawToolCall("t2", "mcp_tool", {})],
    oneGroup, 0, passthroughAborted,
  );

  expect(internal).toEqual(["add_region"]);
  expect(external).toEqual(["mcp_tool"]);
  expect(res.consecutiveErrors).toBe(0);
  // Both tool results streamed into the run and appended to the conversation.
  expect(run.toolCalls.map((t) => t.name)).toEqual(["add_region", "mcp_tool"]);
  expect(ctx.conversation.filter((m) => m.role === "tool")).toHaveLength(2);
});

test("executeToolTurn counts consecutive failures and stops at the cap", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  const ctx = baseCtx({ projectId });

  const attempted: string[] = [];
  const deps = {
    isExternalTool: () => false,
    callExternalTool: async () => ({ success: true, result: {} }),
    executeToolCall: async (name: string) => { attempted.push(name); return { success: false, result: { error: "nope" } }; },
  };

  const calls = Array.from({ length: 8 }, (_, i) => rawToolCall(`t${i}`, `fail_${i}`, {}));
  const res = await executeToolTurn(run, ctx, deps, calls, oneGroup, 0, passthroughAborted);

  // Bails once 5 consecutive failures accumulate rather than running all 8.
  expect(res.consecutiveErrors).toBe(5);
  expect(attempted).toHaveLength(5);
});

test("executeToolTurn truncates oversized tool results in the conversation", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  const ctx = baseCtx({ projectId });

  const huge = "x".repeat(30000);
  const deps = {
    isExternalTool: () => false,
    callExternalTool: async () => ({ success: true, result: {} }),
    executeToolCall: async () => ({ success: true, result: { blob: huge } }),
  };

  await executeToolTurn(run, ctx, deps, [rawToolCall("t1", "big", {})], oneGroup, 0, passthroughAborted);
  const toolMsg = ctx.conversation.find((m) => m.role === "tool")!;
  expect(String(toolMsg.content)).toContain("(result truncated)");
  expect(String(toolMsg.content).length).toBeLessThan(1000);
  // The full result still streamed to the client (only the LLM context is trimmed).
  expect((run.toolCalls[0].result as { blob: string }).blob).toBe(huge);
});

test("executeToolTurn emits plan_update when update_plan succeeds", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  const events: RunEvent[] = [];
  run.subscribe(0, (e) => events.push(e));
  const ctx = baseCtx({ projectId });

  const deps = {
    isExternalTool: () => false,
    callExternalTool: async () => ({ success: true, result: {} }),
    executeToolCall: async () => ({ success: true, result: { id: "plan1", steps: [] } }),
  };

  await executeToolTurn(run, ctx, deps, [rawToolCall("t1", "update_plan", {})], oneGroup, 0, passthroughAborted);
  expect(events.some((e) => e.type === "plan_update")).toBe(true);
});

test("appendVisionFollowup pushes image messages only when there are images", () => {
  const conv: AgentLoopContext["conversation"] = [];
  appendVisionFollowup(conv, [], []);
  expect(conv).toHaveLength(0);

  appendVisionFollowup(conv, [{ label: "frame", url: "data:image/png;base64,AAA" }], []);
  expect(conv).toHaveLength(1);
  const content = conv[0].content as Array<{ type: string }>;
  expect(content.some((p) => p.type === "image_url")).toBe(true);
  expect(content[0].type).toBe("text");
});

test("maybeSummarize collapses an over-threshold project conversation", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  const events: RunEvent[] = [];
  run.subscribe(0, (e) => events.push(e));

  const ctx = baseCtx({
    projectId,
    threshold: 0, // force over-threshold
    clientMessageCount: 10,
    conversation: [
      { role: "system", content: "sys" },
      { role: "user", content: "old 1" },
      { role: "assistant", content: "old 2" },
      { role: "user", content: "latest" },
    ],
    latestUserMessage: { id: "u-latest", content: "latest", createdAt: new Date().toISOString() },
  });

  const did = await maybeSummarize(run, ctx, { summarizeConversation: async () => "THE SUMMARY" });
  expect(did).toBe(true);
  // Conversation rebuilt as: system prompt, summary, latest user turn.
  expect(ctx.conversation.map((m) => m.role)).toEqual(["system", "system", "user"]);
  expect(String(ctx.conversation[1].content)).toContain("THE SUMMARY");
  expect(events.map((e) => e.type)).toEqual(["summarizing", "context_summarized"]);

  const sys = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.projectId, projectId));
  expect(sys.some((r: typeof sys[number]) => r.role === "system" && r.content === "THE SUMMARY")).toBe(true);
});

test("maybeSummarize is a no-op for styleguide scope even over threshold", async () => {
  const styleguideId = await seedStyleguide();
  const run = await registry.create({ scope: "styleguide", id: styleguideId }, { projectId: null });

  const ctx = baseCtx({
    threshold: 0,
    clientMessageCount: 10,
    conversation: [
      { role: "system", content: "sys" },
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
    ],
  });

  let summarizeCalled = false;
  const did = await maybeSummarize(run, ctx, { summarizeConversation: async () => { summarizeCalled = true; return "x"; } });
  expect(did).toBe(false);
  expect(summarizeCalled).toBe(false);
  expect(ctx.conversation).toHaveLength(3); // untouched
});
