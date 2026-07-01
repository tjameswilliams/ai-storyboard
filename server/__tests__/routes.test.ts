import { test, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import { Hono } from "hono";
import { registry } from "../lib/agentRuns";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { seedProject, seedStyleguide } from "./helpers";
import chat from "../routes/chat";
import runs from "../routes/runs";
import messages from "../routes/messages";

const app = new Hono().route("/api", chat).route("/api", runs).route("/api", messages);

// A throwaway OpenAI-compatible streaming endpoint so the REAL agent loop runs
// end-to-end without a network LLM and without module mocks (which leak across
// bun test files).
let fake: { stop: () => void; port: number };

beforeAll(async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "mocked answer" } }] })}\n\n`));
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }] })}\n\n`));
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
        },
      });
      return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
    },
  });
  fake = { stop: () => server.stop(true), port: server.port ?? 0 };

  // Point the LLM config at the fake server.
  const now = new Date().toISOString();
  const settings: Array<[string, string]> = [
    ["apiBaseUrl", `http://localhost:${fake.port}/v1`],
    ["apiKey", "test"],
    ["model", "test-model"],
    ["provider", "openai"],
  ];
  for (const [key, value] of settings) {
    await db.insert(schema.settings).values({ key, value }).onConflictDoUpdate({ target: schema.settings.key, set: { value } });
  }
});

afterAll(() => fake?.stop());

beforeEach(() => registry.reset());

async function readSSE(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
  }
  return out;
}

test("POST /chat starts a run, persists the user message, returns runId", async () => {
  const projectId = await seedProject();
  const res = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "draw a cat" }],
      projectId, chatScope: "project", userMessageId: "u-1",
    }),
  });
  expect(res.status).toBe(200);
  const json = await res.json();
  expect(json.runId).toBeTruthy();
  expect(json.assistantMsgId).toBeTruthy();

  // User message persisted server-side under the project conversation.
  const rows = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.projectId, projectId));
  expect(rows.some((r: typeof rows[number]) => r.role === "user" && r.content === "draw a cat")).toBe(true);
});

test("GET /runs/:id/stream replays the run's events including the assistant content", async () => {
  const projectId = await seedProject();
  const start = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], projectId, chatScope: "project" }),
  });
  const { runId } = await start.json();

  const streamRes = await app.request(`/api/runs/${runId}/stream?cursor=0`);
  expect(streamRes.headers.get("Content-Type")).toContain("text/event-stream");
  const body = await readSSE(streamRes);
  expect(body).toContain("mocked answer");
  expect(body).toContain('"type":"done"');
});

test("messages persist in user→assistant order (switch-back reload isn't scrambled)", async () => {
  const projectId = await seedProject();
  const start = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "draw" }], projectId, chatScope: "project", userMessageId: "u-ord" }),
  });
  const { runId } = await start.json();
  await readSSE(await app.request(`/api/runs/${runId}/stream?cursor=0`)); // wait for completion

  const rows = await (await app.request(`/api/projects/${projectId}/messages`)).json();
  expect(rows.map((r: any) => r.role)).toEqual(["user", "assistant"]);
  expect(rows[1].status).toBe("complete");
});

test("POST /chat returns 409 when the conversation already has an active run", async () => {
  const projectId = await seedProject();
  // Hold an active run open via the registry so the conflict is observable.
  await registry.create({ scope: "project", id: projectId }, { projectId });

  const res = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "again" }], projectId, chatScope: "project" }),
  });
  expect(res.status).toBe(409);
});

test("GET /runs/active lists active runs, optionally filtered by project", async () => {
  const p1 = await seedProject();
  const p2 = await seedProject();
  const r1 = await registry.create({ scope: "project", id: p1 }, { projectId: p1 });
  await registry.create({ scope: "project", id: p2 }, { projectId: p2 });

  const all = await (await app.request("/api/runs/active")).json();
  expect(all.runs).toHaveLength(2);

  const justP1 = await (await app.request(`/api/runs/active?projectId=${p1}`)).json();
  expect(justP1.runs).toHaveLength(1);
  expect(justP1.runs[0].runId).toBe(r1.id);
});

test("POST /runs/:id/cancel cancels the run", async () => {
  const projectId = await seedProject();
  const run = await registry.create({ scope: "project", id: projectId }, { projectId });
  const res = await app.request(`/api/runs/${run.id}/cancel`, { method: "POST" });
  expect(res.status).toBe(200);
  await new Promise((r) => setTimeout(r, 10));
  expect(run.status).toBe("cancelled");
});

test("POST /chat with a styleguideId runs a styleguide-scoped run and persists there", async () => {
  const styleguideId = await seedStyleguide();
  const res = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "tighten the brand voice" }],
      styleguideId, userMessageId: "sg-u1",
    }),
  });
  expect(res.status).toBe(200);
  const { runId } = await res.json();
  await readSSE(await app.request(`/api/runs/${runId}/stream?cursor=0`)); // drive to completion

  // Both messages land in the styleguide table, in order — not the project table.
  const rows = await db.select().from(schema.styleguideChatMessages)
    .where(eq(schema.styleguideChatMessages.styleguideId, styleguideId));
  expect(rows.map((r: typeof rows[number]) => r.role)).toEqual(["user", "assistant"]);
  expect(rows.find((r: typeof rows[number]) => r.role === "assistant")?.content).toBe("mocked answer");
});

test("POST /chat 404s for a styleguide that doesn't exist", async () => {
  const res = await app.request("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "hi" }], styleguideId: "nope" }),
  });
  expect(res.status).toBe(404);
});

test("GET /runs/:id/stream 404s for an unknown run so the client can fall back to DB", async () => {
  const res = await app.request("/api/runs/does-not-exist/stream");
  expect(res.status).toBe(404);
  const json = await res.json();
  expect(json.disposed).toBe(true);
});
