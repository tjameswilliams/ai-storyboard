import { test, expect, beforeEach } from "bun:test";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import {
  registry,
  reconcileInterruptedRuns,
  RunConflictError,
  type RunEvent,
} from "../lib/agentRuns";
import { seedProject } from "./helpers";

beforeEach(() => registry.reset());

test("create registers a run, durable row, and streaming placeholder", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });

  expect(run.status).toBe("running");
  expect(registry.get(run.id)).toBe(run);
  expect(registry.getActiveForKey(run.key)).toBe(run);

  const [durable] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
  expect(durable.status).toBe("running");

  const [msg] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, run.assistantMsgId));
  expect(msg.status).toBe("streaming");
});

test("at most one active run per conversation", async () => {
  const projectId = await seedProject();
  await registry.create({ scope: "project", id: projectId }, { projectId });
  await expect(registry.create({ scope: "project", id: projectId }, { projectId }))
    .rejects.toBeInstanceOf(RunConflictError);
});

test("completing a run releases the lock so a new run can start", async () => {
  const projectId = await seedProject();
  const ref = { scope: "project" as const, id: projectId };
  const run1 = await registry.create(ref, { projectId });
  await run1.complete();
  expect(registry.getActiveForKey(run1.key)).toBeUndefined();
  // now allowed
  const run2 = await registry.create(ref, { projectId });
  expect(run2.id).not.toBe(run1.id);
});

test("accumulators build content/thinking/tool segments like the client", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  run.pushThinking("think ");
  run.pushThinking("more");
  run.pushContent("Hello ");
  run.pushContent("world");
  run.pushToolResult({ id: "t1", name: "add_region", arguments: { x: 1 }, result: { ok: true }, status: "executed" });
  run.pushContent("done");

  expect(run.thinking).toBe("think more");
  expect(run.content).toBe("Hello worlddone");
  expect(run.toolCalls).toHaveLength(1);
  // segments: thinking, text, tool_call, text  (adjacent same-type merged)
  expect(run.segments.map((s) => s.type)).toEqual(["thinking", "text", "tool_call", "text"]);
  expect((run.segments[1] as any).content).toBe("Hello world");
});

test("subscribe replays from cursor, delivers live, and detach does not stop the run", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  run.pushContent("a");   // seq 1
  run.pushContent("b");   // seq 2

  // Late subscriber from cursor 0 replays everything so far.
  const replayed: RunEvent[] = [];
  const unsub = run.subscribe(0, (ev) => replayed.push(ev));
  expect(replayed.map((e) => e.type)).toEqual(["content", "content"]);

  run.pushContent("c");   // live -> seq 3
  expect(replayed).toHaveLength(3);

  // Detach. Run keeps going; events keep buffering.
  unsub();
  run.pushContent("d");   // seq 4, no live subscriber
  expect(replayed).toHaveLength(3);
  expect(run.status).toBe("running");

  // Reattach with a cursor: only newer events replay.
  const tail: RunEvent[] = [];
  run.subscribe(3, (ev) => tail.push(ev));
  expect(tail.map((e) => (e.data as any).text)).toEqual(["d"]);
});

test("complete persists the accumulated assistant message and emits done", async () => {
  const projectId = await seedProject();
  const ref = { scope: "project" as const, id: projectId };
  const run = await registry.create(ref, { projectId });

  const seen: string[] = [];
  run.subscribe(0, (ev) => seen.push(ev.type));

  run.pushContent("final");
  run.pushToolResult({ id: "t1", name: "x", arguments: {}, result: {}, status: "executed" });
  await run.complete();

  expect(run.status).toBe("complete");
  expect(seen).toContain("done");

  const [msg] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, run.assistantMsgId));
  expect(msg.status).toBe("complete");
  expect(msg.content).toBe("final");
  expect(JSON.parse(msg.toolCalls!)).toHaveLength(1);

  const [durable] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, run.id));
  expect(durable.status).toBe("complete");
});

test("cancel aborts the signal, persists partial output, marks cancelled", async () => {
  const projectId = await seedProject();
  const ref = { scope: "project" as const, id: projectId };
  const run = await registry.create(ref, { projectId });
  run.pushContent("partial");

  let aborted = false;
  run.signal.addEventListener("abort", () => { aborted = true; });
  run.cancel();
  // finish() is async inside cancel(); let it settle.
  await new Promise((r) => setTimeout(r, 10));

  expect(aborted).toBe(true);
  expect(run.status).toBe("cancelled");
  const [msg] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, run.assistantMsgId));
  expect(msg.content).toBe("partial");
  expect(msg.status).toBe("complete");
});

test("listActive filters by project and excludes finished runs", async () => {
  const p1 = await seedProject();
  const p2 = await seedProject();
  const r1 = await registry.create({ scope: "project", id: p1 }, { projectId: p1 });
  await registry.create({ scope: "project", id: p2 }, { projectId: p2 });

  expect(registry.listActive().length).toBe(2);
  expect(registry.listActive(p1).map((r) => r.runId)).toEqual([r1.id]);

  await r1.complete();
  expect(registry.listActive(p1)).toHaveLength(0);
});

test("reconcileInterruptedRuns flips orphaned running rows to interrupted", async () => {
  const projectId = await seedProject();
  // Insert a durable running row with no in-memory run (simulates pre-restart).
  const now = new Date().toISOString();
  await db.insert(schema.agentRuns).values({
    id: "orphan-1", scope: "project", conversationId: projectId, projectId,
    status: "running", assistantMsgId: "a1", error: null, createdAt: now, updatedAt: now,
  });

  const n = await reconcileInterruptedRuns();
  expect(n).toBeGreaterThanOrEqual(1);
  const [row] = await db.select().from(schema.agentRuns).where(eq(schema.agentRuns.id, "orphan-1"));
  expect(row.status).toBe("interrupted");
});
