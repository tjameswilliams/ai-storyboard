import { test, expect } from "bun:test";
import { applyRunEvent, newAccumulator } from "./runReducer";

test("content deltas accumulate into one text segment and the message body", () => {
  const acc = newAccumulator("a1");
  applyRunEvent(acc, { seq: 1, type: "content", text: "Hello " });
  const action = applyRunEvent(acc, { seq: 2, type: "content", text: "world" });
  expect(acc.content).toBe("Hello world");
  expect(acc.segments).toHaveLength(1);
  expect(acc.segments[0]).toEqual({ type: "text", content: "Hello world" });
  expect(action).toMatchObject({ kind: "upsert_message" });
  if (action?.kind === "upsert_message") {
    expect(action.message.id).toBe("a1");
    expect(action.message.content).toBe("Hello world");
  }
});

test("thinking then content then a tool call produce ordered segments", () => {
  const acc = newAccumulator("a1");
  applyRunEvent(acc, { seq: 1, type: "thinking", text: "reasoning" });
  applyRunEvent(acc, { seq: 2, type: "content", text: "answer" });
  applyRunEvent(acc, { seq: 3, type: "tool_call_result", toolCallId: "t1", name: "add_region", args: { x: 1 }, result: { ok: true }, success: true });
  expect(acc.segments.map((s) => s.type)).toEqual(["thinking", "text", "tool_call"]);
  expect(acc.thinking).toBe("reasoning");
  expect(acc.toolCalls).toHaveLength(1);
  expect(acc.toolCalls[0]).toMatchObject({ id: "t1", name: "add_region", status: "executed" });
});

test("a failed tool call is marked rejected", () => {
  const acc = newAccumulator("a1");
  applyRunEvent(acc, { seq: 1, type: "tool_call_result", toolCallId: "t1", name: "x", args: {}, result: { error: "bad" }, success: false });
  expect(acc.toolCalls[0].status).toBe("rejected");
});

test("replayed events (seq <= cursor) are ignored — reattach is idempotent", () => {
  const acc = newAccumulator("a1");
  applyRunEvent(acc, { seq: 1, type: "content", text: "abc" });
  applyRunEvent(acc, { seq: 2, type: "content", text: "def" });
  expect(acc.content).toBe("abcdef");
  // Re-deliver seq 1 and 2 (as happens on a cursor=0 reattach): no double-apply.
  expect(applyRunEvent(acc, { seq: 1, type: "content", text: "abc" })).toBeNull();
  expect(applyRunEvent(acc, { seq: 2, type: "content", text: "def" })).toBeNull();
  expect(acc.content).toBe("abcdef");
  // New event past the cursor still applies.
  applyRunEvent(acc, { seq: 3, type: "content", text: "ghi" });
  expect(acc.content).toBe("abcdefghi");
});

test("control events map to their actions", () => {
  const acc = newAccumulator("a1");
  expect(applyRunEvent(acc, { seq: 1, type: "assistant_msg_id", id: "real-id" })).toEqual({ kind: "assistant_msg_id", id: "real-id" });
  expect(acc.assistantMsgId).toBe("real-id");
  expect(applyRunEvent(acc, { seq: 2, type: "context_status", used: 10, total: 100 })).toEqual({ kind: "context_status", used: 10, total: 100 });
  expect(applyRunEvent(acc, { seq: 3, type: "summarizing" })).toEqual({ kind: "summarizing" });
  expect(applyRunEvent(acc, { seq: 4, type: "context_summarized", summary: "S" })).toEqual({ kind: "context_summarized", summary: "S" });
  expect(applyRunEvent(acc, { seq: 5, type: "plan_update", plan: { id: "p" } as any })).toMatchObject({ kind: "plan_update" });
  expect(applyRunEvent(acc, { seq: 6, type: "error", message: "boom" })).toEqual({ kind: "error", message: "boom" });
  expect(applyRunEvent(acc, { seq: 7, type: "done" })).toEqual({ kind: "done" });
});
