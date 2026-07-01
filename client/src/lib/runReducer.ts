import type { ChatMessage, MessageSegment, ToolCall, Plan } from "../types";

/**
 * Pure reducer that folds a run's SSE events into a single assistant
 * ChatMessage, driven by the server-owned run stream. It is deliberately free of store /
 * DOM / network so it can be unit-tested, and idempotent on replay: events with
 * seq <= cursor are ignored, so reattaching with a cursor never double-applies.
 */

export interface RunAccumulator {
  assistantMsgId: string;
  content: string;
  thinking: string;
  toolCalls: ToolCall[];
  segments: MessageSegment[];
  currentSegmentType: "thinking" | "text" | null;
  cursor: number;
}

export function newAccumulator(assistantMsgId: string, cursor = 0): RunAccumulator {
  return { assistantMsgId, content: "", thinking: "", toolCalls: [], segments: [], currentSegmentType: null, cursor };
}

export type RunAction =
  | { kind: "assistant_msg_id"; id: string }
  | { kind: "upsert_message"; message: ChatMessage }
  | { kind: "context_status"; used: number; total: number }
  | { kind: "plan_update"; plan: Plan }
  | { kind: "summarizing" }
  | { kind: "context_summarized"; summary: string }
  | { kind: "done" }
  | { kind: "error"; message: string }
  | null;

type RunEvent = Record<string, unknown> & { seq?: number; type?: string };

function text(ev: RunEvent): string {
  return (ev.content as string) || (ev.text as string) || "";
}

function snapshot(acc: RunAccumulator): ChatMessage {
  return {
    id: acc.assistantMsgId,
    role: "assistant",
    content: acc.content,
    thinking: acc.thinking || undefined,
    toolCalls: acc.toolCalls.length > 0 ? [...acc.toolCalls] : undefined,
    segments: acc.segments.length > 0 ? [...acc.segments] : undefined,
    timestamp: new Date().toISOString(),
  };
}

export function applyRunEvent(acc: RunAccumulator, ev: RunEvent): RunAction {
  // Idempotent replay: skip anything we've already folded in.
  if (typeof ev.seq === "number") {
    if (ev.seq <= acc.cursor) return null;
    acc.cursor = ev.seq;
  }

  switch (ev.type) {
    case "assistant_msg_id": {
      acc.assistantMsgId = ev.id as string;
      return { kind: "assistant_msg_id", id: ev.id as string };
    }

    case "thinking": {
      const t = text(ev);
      acc.thinking += t;
      if (acc.currentSegmentType === "thinking") {
        const last = acc.segments[acc.segments.length - 1];
        last.content = (last.content || "") + t;
      } else {
        acc.segments.push({ type: "thinking", content: t });
        acc.currentSegmentType = "thinking";
      }
      return { kind: "upsert_message", message: snapshot(acc) };
    }

    case "content": {
      const t = text(ev);
      acc.content += t;
      if (acc.currentSegmentType === "text") {
        const last = acc.segments[acc.segments.length - 1];
        last.content = (last.content || "") + t;
      } else {
        acc.segments.push({ type: "text", content: t });
        acc.currentSegmentType = "text";
      }
      return { kind: "upsert_message", message: snapshot(acc) };
    }

    case "tool_call_result": {
      const toolCall: ToolCall = {
        id: ev.toolCallId as string,
        name: ev.name as string,
        arguments: ev.args as Record<string, unknown>,
        result: ev.result,
        status: ev.success ? "executed" : "rejected",
      };
      acc.toolCalls.push(toolCall);
      acc.segments.push({ type: "tool_call", toolCall });
      acc.currentSegmentType = null;
      return { kind: "upsert_message", message: snapshot(acc) };
    }

    case "plan_update":
      return { kind: "plan_update", plan: ev.plan as Plan };
    case "context_status":
      return { kind: "context_status", used: ev.used as number, total: ev.total as number };
    case "summarizing":
      return { kind: "summarizing" };
    case "context_summarized":
      return { kind: "context_summarized", summary: ev.summary as string };
    case "done":
      return { kind: "done" };
    case "error":
      return { kind: "error", message: (ev.message as string) || (ev.error as string) || "run failed" };
    default:
      return null;
  }
}
