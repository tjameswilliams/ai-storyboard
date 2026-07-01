import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { newId } from "./nanoid";
import {
  makeConversationKey,
  type ConversationKey,
  type ConversationRef,
} from "./conversationKey";
import {
  beginAssistantMessage,
  finalizeAssistantMessage,
} from "./chatPersistence";

/**
 * The agent-run registry. Each run is one streamed assistant turn, decoupled
 * from the HTTP request that started it: the loop runs against the run's own
 * AbortController (not the request signal), the server persists the assistant
 * message, and clients SUBSCRIBE to a replayable event buffer rather than
 * owning the stream. A client can detach (switch away) and reattach (switch
 * back) without killing or losing the run.
 *
 * Invariant: at most one active run per conversation. The map is the lock.
 */

export type RunStatus = "running" | "complete" | "error" | "cancelled";
export type TerminalEvent = "done" | "error";

export interface RunEvent {
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

export interface RunSummary {
  runId: string;
  scope: ConversationRef["scope"];
  conversationId: string;
  key: ConversationKey;
  projectId: string | null;
  status: RunStatus;
  assistantMsgId: string;
}

export class RunConflictError extends Error {
  constructor(public key: ConversationKey, public existingRunId: string) {
    super(`a run is already active for ${key}`);
    this.name = "RunConflictError";
  }
}

type Subscriber = (ev: RunEvent) => void;

interface ToolCallRecord {
  id: string;
  name: string;
  arguments: unknown;
  result: unknown;
  status: "executed" | "rejected";
}

type Segment =
  | { type: "thinking"; content: string }
  | { type: "text"; content: string }
  | { type: "tool_call"; toolCall: ToolCallRecord };

// How long a finalized run's buffer lingers so a reconnecting client can still
// replay the tail before falling back to a DB load.
const DEFAULT_GRACE_MS = 60_000;

export class AgentRun {
  readonly id: string;
  readonly ref: ConversationRef;
  readonly key: ConversationKey;
  readonly projectId: string | null;
  readonly assistantMsgId: string;
  readonly abort = new AbortController();

  status: RunStatus = "running";
  error: string | null = null;

  // Accumulated assistant message, mirrored from emitted events so the server
  // can persist the same shape the client renders.
  content = "";
  thinking = "";
  toolCalls: ToolCallRecord[] = [];
  segments: Segment[] = [];
  private currentSegmentType: "thinking" | "text" | null = null;

  private events: RunEvent[] = [];
  private seq = 0;
  private subscribers = new Set<Subscriber>();
  private graceMs: number;
  private disposeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ref: ConversationRef, opts: { projectId: string | null; assistantMsgId?: string; graceMs?: number }) {
    this.id = newId();
    this.ref = ref;
    this.key = makeConversationKey(ref.scope, ref.id);
    this.projectId = opts.projectId;
    this.assistantMsgId = opts.assistantMsgId ?? newId();
    this.graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
  }

  get signal() {
    return this.abort.signal;
  }

  // --- Event emission ---------------------------------------------------

  /** Low-level: buffer an event and notify live subscribers. */
  emit(type: string, data: Record<string, unknown> = {}): void {
    if (this.status !== "running" && type !== "done" && type !== "error") return;
    const ev: RunEvent = { seq: ++this.seq, type, data };
    this.events.push(ev);
    for (const sub of this.subscribers) {
      try { sub(ev); } catch { /* a dead subscriber must not break the run */ }
    }
  }

  pushContent(text: string): void {
    if (!text) return;
    this.content += text;
    if (this.currentSegmentType === "text") {
      const last = this.segments[this.segments.length - 1] as { type: "text"; content: string };
      last.content += text;
    } else {
      this.segments.push({ type: "text", content: text });
      this.currentSegmentType = "text";
    }
    this.emit("content", { text });
  }

  pushThinking(text: string): void {
    if (!text) return;
    this.thinking += text;
    if (this.currentSegmentType === "thinking") {
      const last = this.segments[this.segments.length - 1] as { type: "thinking"; content: string };
      last.content += text;
    } else {
      this.segments.push({ type: "thinking", content: text });
      this.currentSegmentType = "thinking";
    }
    this.emit("thinking", { text });
  }

  pushToolResult(tc: ToolCallRecord): void {
    this.toolCalls.push(tc);
    this.segments.push({ type: "tool_call", toolCall: tc });
    this.currentSegmentType = null;
    this.emit("tool_call_result", {
      toolCallId: tc.id, name: tc.name, args: tc.arguments, result: tc.result, success: tc.status === "executed",
    });
  }

  /** A mid-stream summarize collapsed the conversation — reset accumulators. */
  resetAccumulators(): void {
    this.content = "";
    this.thinking = "";
    this.toolCalls = [];
    this.segments = [];
    this.currentSegmentType = null;
  }

  // --- Subscription / replay -------------------------------------------

  /**
   * Replay every buffered event with seq > cursor, then receive live events.
   * Returns an unsubscribe fn. A subscriber detaching does NOT stop the run.
   */
  subscribe(cursor: number, send: Subscriber): () => void {
    for (const ev of this.events) {
      if (ev.seq > cursor) send(ev);
    }
    // Already finished? Nothing live will come; caller closes on the terminal
    // event it just replayed (or immediately if it had already seen it).
    if (this.status !== "running") return () => {};
    this.subscribers.add(send);
    return () => { this.subscribers.delete(send); };
  }

  get lastSeq(): number {
    return this.seq;
  }

  isTerminal(): boolean {
    return this.status !== "running";
  }

  summary(): RunSummary {
    return {
      runId: this.id,
      scope: this.ref.scope,
      conversationId: this.ref.id,
      key: this.key,
      projectId: this.projectId,
      status: this.status,
      assistantMsgId: this.assistantMsgId,
    };
  }

  // --- Termination ------------------------------------------------------

  async complete(): Promise<void> { await this.finish("complete"); }
  async fail(error: string): Promise<void> { await this.finish("error", error); }
  cancel(): void {
    if (this.isTerminal()) return;
    this.abort.abort();
    // finish() is driven by the loop unwinding; but if no loop is attached
    // (e.g. cancel before the loop reads the signal), finalize directly.
    void this.finish("cancelled");
  }

  private finishing = false;
  private async finish(status: RunStatus, error?: string): Promise<void> {
    if (this.finishing || this.isTerminal()) return;
    this.finishing = true;
    this.error = error ?? null;

    // Persist whatever was accumulated (partial counts for cancel/error).
    try {
      await finalizeAssistantMessage(this.ref, {
        id: this.assistantMsgId,
        content: this.content,
        thinking: this.thinking || null,
        toolCalls: this.toolCalls.length > 0 ? this.toolCalls : null,
        segments: this.segments.length > 0 ? this.segments : null,
      });
    } catch (e) {
      console.error("[agentRuns] failed to persist assistant message:", (e as Error).message);
    }

    try {
      await db.update(schema.agentRuns)
        .set({ status, error: error ?? null, updatedAt: new Date().toISOString() })
        .where(eq(schema.agentRuns.id, this.id));
    } catch (e) {
      console.error("[agentRuns] failed to update run row:", (e as Error).message);
    }

    // Buffer the terminal event BEFORE flipping status, so it's always in the
    // replay buffer for a late subscriber. Cancellation surfaces as "done" (the
    // client just stops); error carries the message. `status` is still
    // "running" here so emit() lets it through and live subscribers receive it.
    if (status === "error") this.emit("error", { message: error ?? "run failed" });
    else this.emit("done", {});

    this.status = status;

    // Release the conversation lock; keep the buffer for a grace window.
    registry.releaseActive(this);
    this.subscribers.clear();
    this.disposeTimer = setTimeout(() => registry.dispose(this.id), this.graceMs);
    (this.disposeTimer as any)?.unref?.();
  }
}

// --- Registry ----------------------------------------------------------

class Registry {
  private runs = new Map<string, AgentRun>();          // runId -> run
  private activeByKey = new Map<ConversationKey, string>(); // key -> active runId

  /** Create + register a run, persisting its durable row and a streaming msg
   *  placeholder. Throws RunConflictError if the conversation is already busy. */
  async create(ref: ConversationRef, opts: { projectId: string | null; assistantMsgId?: string; graceMs?: number }): Promise<AgentRun> {
    const key = makeConversationKey(ref.scope, ref.id);
    const existingId = this.activeByKey.get(key);
    if (existingId && this.runs.get(existingId)?.status === "running") {
      throw new RunConflictError(key, existingId);
    }

    const run = new AgentRun(ref, opts);
    this.runs.set(run.id, run);
    this.activeByKey.set(key, run.id);

    const now = new Date().toISOString();
    await db.insert(schema.agentRuns).values({
      id: run.id,
      scope: ref.scope,
      conversationId: ref.id,
      projectId: run.projectId,
      status: "running",
      assistantMsgId: run.assistantMsgId,
      error: null,
      createdAt: now,
      updatedAt: now,
    });
    await beginAssistantMessage(ref, run.assistantMsgId);

    return run;
  }

  get(runId: string): AgentRun | undefined {
    return this.runs.get(runId);
  }

  getActiveForKey(key: ConversationKey): AgentRun | undefined {
    const id = this.activeByKey.get(key);
    const run = id ? this.runs.get(id) : undefined;
    return run && run.status === "running" ? run : undefined;
  }

  /** Active (still-running) runs, optionally filtered to one project. */
  listActive(projectId?: string): RunSummary[] {
    const out: RunSummary[] = [];
    for (const run of this.runs.values()) {
      if (run.status !== "running") continue;
      if (projectId !== undefined && run.projectId !== projectId) continue;
      out.push(run.summary());
    }
    return out;
  }

  /** Internal: drop the conversation lock when a run finishes. */
  releaseActive(run: AgentRun): void {
    if (this.activeByKey.get(run.key) === run.id) {
      this.activeByKey.delete(run.key);
    }
  }

  /** Drop a finished run's buffer after the grace window. */
  dispose(runId: string): void {
    const run = this.runs.get(runId);
    if (run && run.status === "running") return; // never drop a live run
    this.runs.delete(runId);
  }

  /** Test/maintenance helper: forget everything in memory. */
  reset(): void {
    this.runs.clear();
    this.activeByKey.clear();
  }
}

export const registry = new Registry();

/**
 * On boot there are no in-memory runs, so any durable row still marked
 * "running" was orphaned by a restart. Mark it "interrupted". Returns count.
 */
export async function reconcileInterruptedRuns(): Promise<number> {
  const res = await db.update(schema.agentRuns)
    .set({ status: "interrupted", updatedAt: new Date().toISOString() })
    .where(eq(schema.agentRuns.status, "running"));
  return (res as any)?.changes ?? (res as any)?.rowsAffected ?? 0;
}
