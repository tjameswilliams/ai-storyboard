import { test, expect } from "bun:test";
import { readAssistantStream } from "../lib/agentStream";

/** Build a ReadableStream that emits the given raw string chunks. */
function streamOf(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  }).getReader();
}

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

test("accumulates content and thinking, captures the finish reason", async () => {
  const reader = streamOf([
    sse({ choices: [{ delta: { reasoning_content: "let me think " } }] }),
    sse({ choices: [{ delta: { reasoning_content: "about it" } }] }),
    sse({ choices: [{ delta: { content: "Hello " } }] }),
    sse({ choices: [{ delta: { content: "world" } }] }),
    sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
    "data: [DONE]\n\n",
  ]);

  const onContent: string[] = [];
  const onThinking: string[] = [];
  const turn = await readAssistantStream(reader, {
    onContent: (t) => onContent.push(t),
    onThinking: (t) => onThinking.push(t),
  });

  expect(turn.content).toBe("Hello world");
  expect(turn.thinking).toBe("let me think about it");
  expect(turn.finishReason).toBe("stop");
  expect(turn.toolCalls).toHaveLength(0);
  // Deltas are forwarded live, in order.
  expect(onContent).toEqual(["Hello ", "world"]);
  expect(onThinking).toEqual(["let me think ", "about it"]);
});

test("assembles a streamed tool call whose name/arguments arrive in fragments", async () => {
  const reader = streamOf([
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "tc1", type: "function", function: { name: "add_", arguments: "" } }] } }] }),
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "region", arguments: '{"x":' } }] } }] }),
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "1}" } }] } }] }),
    sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
  ]);

  const turn = await readAssistantStream(reader);
  expect(turn.finishReason).toBe("tool_calls");
  expect(turn.toolCalls).toHaveLength(1);
  expect(turn.toolCalls[0].id).toBe("tc1");
  expect(turn.toolCalls[0].function.name).toBe("add_region");
  expect(JSON.parse(turn.toolCalls[0].function.arguments)).toEqual({ x: 1 });
});

test("handles two parallel tool calls addressed by index", async () => {
  const reader = streamOf([
    sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "a", function: { name: "one", arguments: "{}" } }] } }] }),
    sse({ choices: [{ delta: { tool_calls: [{ index: 1, id: "b", function: { name: "two", arguments: "{}" } }] } }] }),
    sse({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
  ]);

  const turn = await readAssistantStream(reader);
  expect(turn.toolCalls.map((t) => `${t.id}:${t.function.name}`)).toEqual(["a:one", "b:two"]);
});

test("tolerates a data line split across chunk boundaries", async () => {
  const line = sse({ choices: [{ delta: { content: "spanned" } }] });
  const mid = Math.floor(line.length / 2);
  const reader = streamOf([
    line.slice(0, mid),
    line.slice(mid),
    sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
  ]);

  const turn = await readAssistantStream(reader);
  expect(turn.content).toBe("spanned");
});

test("skips malformed JSON chunks without throwing", async () => {
  const reader = streamOf([
    "data: {not json}\n\n",
    sse({ choices: [{ delta: { content: "ok" } }] }),
    sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
  ]);

  const turn = await readAssistantStream(reader);
  expect(turn.content).toBe("ok");
});

test("reads nothing when already aborted before the first read", async () => {
  const reader = streamOf([
    sse({ choices: [{ delta: { content: "first" } }] }),
    sse({ choices: [{ delta: {}, finish_reason: "stop" }] }),
  ]);

  const seen: string[] = [];
  const turn = await readAssistantStream(reader, {
    aborted: () => true, // abort check is at the top of the read loop
    onContent: (t) => seen.push(t),
  });

  expect(seen).toEqual([]);
  expect(turn.content).toBe("");
  expect(turn.finishReason).toBe("");
});
