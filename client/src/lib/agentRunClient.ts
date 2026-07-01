import { useStore } from "../store";
import { api } from "../api/client";
import type { ChatMessage, ChatAttachment, Plan } from "../types";
import { nanoid } from "nanoid";
import { parseSSEStream } from "./sseParser";
import { applyRunEvent, newAccumulator, type RunAccumulator } from "./runReducer";
import { conversationKeyFor, type ConversationKey } from "./conversationKey";

/**
 * Client side of the decoupled agent runs. The client does NOT own the agent
 * loop: POST /chat starts a detached server run and returns a
 * runId; we then SUBSCRIBE to that run's replayable event stream. Switching
 * conversations detaches the stream (the run keeps going server-side) and
 * reattaching replays from the buffer. All three scopes (project, image,
 * styleguide) go through here — the server picks the right tools/prompt.
 */

// Styleguide tools that change the brand doc/assets, so the editor pane needs a
// refresh when one of them succeeds.
const STYLEGUIDE_MUTATING_TOOLS = ["update_styleguide_markdown", "patch_styleguide_markdown", "tag_brand_asset"];

// Access the store lazily (NOT destructured at module load): store/index and
// this module form an import cycle, so `useStore` is still undefined while this
// module is first evaluated. Reading it inside functions defers access until
// after the store has finished initializing.
const getState = () => useStore.getState();
type AppStateType = ReturnType<typeof useStore.getState>;
const setState = (partial: Partial<AppStateType> | ((s: AppStateType) => Partial<AppStateType>)) =>
  useStore.setState(partial);

// Focused-stream state: the one run whose events we render into messages[].
let focusedAbort: AbortController | null = null;
let focusedRunId: string | null = null;
let focusedConvKey: ConversationKey | null = null;
let focusedAcc: RunAccumulator | null = null;

function currentConvKey(): ConversationKey | null {
  return conversationKeyFor({
    styleguideId: getState().activeStyleguideId,
    projectId: getState().project?.id ?? null,
    selectedImageId: getState().selectedImageId,
    chatScope: getState().chatScope,
  });
}

function scopeAndIdOf(key: ConversationKey): { scope: "project" | "image" | "styleguide"; id: string } {
  const sep = key.indexOf(":");
  return { scope: key.slice(0, sep) as any, id: key.slice(sep + 1) };
}

/** Reflect a successful tool's side effects in the UI, per conversation scope. */
async function refreshAfterTool(convKey: ConversationKey, toolName: string) {
  const { scope } = scopeAndIdOf(convKey);
  if (scope === "styleguide") {
    if (STYLEGUIDE_MUTATING_TOOLS.includes(toolName)) await getState().refreshActiveStyleguide();
    return;
  }
  // Project/image: the agent may have changed frames or generated assets. Refresh
  // the storyboard LIVE so the canvas updates as the agent works.
  await getState().loadImages();
  if (toolName === "generate_image" || toolName === "regenerate_image") getState().loadAssets();
}

function upsertMessage(message: ChatMessage) {
  setState((s) => {
    const exists = s.messages.some((m) => m.id === message.id);
    return exists
      ? { messages: s.messages.map((m) => (m.id === message.id ? { ...m, ...message } : m)) }
      : { messages: [...s.messages, message] };
  });
}

/** Detach the focused stream WITHOUT cancelling the run (it keeps working). */
function detachFocused() {
  if (focusedAbort) { focusedAbort.abort(); focusedAbort = null; }
  focusedRunId = null;
  focusedConvKey = null;
  focusedAcc = null;
}

/**
 * Stop rendering the currently-focused run's events. MUST be called BEFORE
 * loadMessages() when switching conversations, otherwise the previous (still
 * running) conversation's stream keeps writing its assistant message into the
 * newly-loaded messages[]. The run itself keeps going server-side.
 */
export function detachFocusedStream() {
  detachFocused();
  setState({ isStreaming: false, focusedRunId: null });
}

async function handleEvent(convKey: ConversationKey, ev: Record<string, unknown>) {
  // If the user switched away mid-event, stop rendering into the (now wrong)
  // messages[]. The stream will have been aborted, but guard anyway.
  if (focusedConvKey !== convKey || !focusedAcc) return;
  const action = applyRunEvent(focusedAcc, ev);
  if (!action) return;

  switch (action.kind) {
    case "upsert_message":
      upsertMessage(action.message);
      // A successful tool call may have changed frames/assets/styleguide — reflect
      // it LIVE so the UI updates as the agent works, not only when the run ends.
      if (ev.type === "tool_call_result" && ev.success) {
        await refreshAfterTool(convKey, ev.name as string);
      }
      break;
    case "context_status":
      setState({ contextStatus: { used: action.used, total: action.total } });
      break;
    case "plan_update":
      setState({ activePlan: action.plan as Plan });
      break;
    case "summarizing":
      setState({ isSummarizing: true });
      break;
    case "context_summarized": {
      const summaryMsg: ChatMessage = { id: nanoid(), role: "system", content: action.summary, timestamp: new Date().toISOString() };
      const msgs = getState().messages;
      const latestUser = [...msgs].reverse().find((m) => m.role === "user");
      setState({ messages: latestUser ? [summaryMsg, latestUser] : [summaryMsg], isSummarizing: false });
      break;
    }
    case "done":
      await finishFocused(convKey);
      break;
    case "error":
      setState({ messages: [...getState().messages, { id: nanoid(), role: "assistant", content: `Error: ${action.message}`, timestamp: new Date().toISOString() }] });
      await finishFocused(convKey);
      break;
  }
}

async function finishFocused(convKey: ConversationKey) {
  const ranTools = (focusedAcc?.toolCalls.length ?? 0) > 0;
  const usedGen = focusedAcc?.toolCalls.some((t) => t.name === "generate_image" || t.name === "regenerate_image") ?? false;
  getState().clearActiveRun(convKey);
  setState({ isStreaming: false, focusedRunId: null });
  detachFocused();
  // Final catch-up refresh for any tool-driven changes, by scope.
  if (!ranTools) return;
  if (scopeAndIdOf(convKey).scope === "styleguide") {
    await getState().refreshActiveStyleguide();
  } else {
    await getState().loadImages();
    if (usedGen) getState().loadAssets();
  }
}

/**
 * Subscribe to a run and render its events into messages[]. Replays from
 * `cursor` then live-tails. A 404 means the run was already disposed, so we
 * fall back to a fresh DB load.
 */
async function attachToRun(convKey: ConversationKey, runId: string, cursor: number, assistantMsgId?: string) {
  detachFocused();
  const abort = new AbortController();
  focusedAbort = abort;
  focusedRunId = runId;
  focusedConvKey = convKey;
  focusedAcc = newAccumulator(assistantMsgId ?? nanoid(), cursor);
  setState({ focusedRunId: runId, focusedConvKey: convKey, isStreaming: true });

  try {
    const res = await api.openRunStream(runId, cursor, abort.signal);
    if (res.status === 404) {
      getState().clearActiveRun(convKey);
      setState({ isStreaming: false, focusedRunId: null });
      await getState().loadMessages();
      return;
    }
    if (!res.ok || !res.body) throw new Error(`run stream error: ${res.status}`);
    await parseSSEStream(res.body.getReader(), { onEvent: (ev) => handleEvent(convKey, ev) });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      // Detached by a conversation switch — leave the run alone.
    } else {
      console.error("[agentRunClient] stream error", e);
      if (focusedConvKey === convKey) setState({ isStreaming: false });
    }
  } finally {
    if (focusedRunId === runId) focusedAbort = null;
  }
}

export async function sendChatMessage(content: string, attachments?: ChatAttachment[]) {
  if (getState().isStreaming) return;

  // Auto-summarize before sending if we're near the context limit (preserved).
  const ctx = getState().contextStatus;
  if (ctx && ctx.used / ctx.total >= 0.8 && getState().messages.length >= 3) {
    await getState().summarizeChat();
  }

  const convKey = currentConvKey();
  if (!convKey) return;

  const userMsg: ChatMessage = {
    id: nanoid(),
    role: "user",
    content,
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
    timestamp: new Date().toISOString(),
  };
  setState({ messages: [...getState().messages, userMsg], isStreaming: true });

  const allMessages = getState().messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.attachments && m.attachments.length > 0 ? { attachments: m.attachments } : {}),
  }));

  try {
    const { runId, assistantMsgId } = await api.startChatRun({
      messages: allMessages,
      projectId: getState().project?.id ?? null,
      selectedImageId: getState().selectedImageId,
      chatScope: getState().chatScope,
      styleguideId: getState().activeStyleguideId ?? null,
      userMessageId: userMsg.id,
    });
    const { scope, id } = scopeAndIdOf(convKey);
    getState().setActiveRun(convKey, { runId, status: "running", projectId: getState().project?.id ?? null, scope, conversationId: id });
    await attachToRun(convKey, runId, 0, assistantMsgId);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    setState({
      isStreaming: false,
      messages: [...getState().messages, { id: nanoid(), role: "assistant", content: `Error: ${err.message}`, timestamp: new Date().toISOString() }],
    });
  }
}

/** The chat "Stop" button — cancel the focused run server-side. */
export function stopStreaming() {
  const runId = focusedRunId ?? getState().focusedRunId;
  if (runId) api.cancelRun(runId).catch((e) => console.error("[agentRunClient] cancel failed", e));
  setState({ isStreaming: false });
}

export function retryLastMessage() {
  if (getState().isStreaming) return;
  const msgs = getState().messages;
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") { lastUserIdx = i; break; }
  }
  if (lastUserIdx === -1) return;
  const userContent = msgs[lastUserIdx].content;
  setState({ messages: msgs.slice(0, lastUserIdx) });
  void sendChatMessage(userContent);
}

/**
 * Called after a conversation switch (frame/scope/project) once messages are
 * loaded from the DB. Detaches the previous focused stream (its run keeps
 * running) and, if the newly-focused conversation has a run in flight, attaches
 * and replays it so it "continues as it was".
 */
export async function onConversationFocused() {
  detachFocused();
  setState({ focusedRunId: null, isStreaming: false });
  const convKey = currentConvKey();
  if (!convKey) return;

  await getState().refreshActiveRuns();
  const active = getState().activeRuns[convKey];
  if (active && active.status === "running") {
    await attachToRun(convKey, active.runId, 0);
  }
}
