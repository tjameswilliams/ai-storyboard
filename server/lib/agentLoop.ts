import { readFile, unlink } from "fs/promises";
import { resolve } from "path";
import { streamChat as realStreamChat, summarizeConversation as realSummarize } from "./llm";
import { executeToolCall as realExecuteToolCall } from "./toolExecutor";
import { mcpClientManager } from "./mcp/clientManager";
import { generateGroupId } from "./undoManager";
import { getUploadsDir } from "./config";
import {
  estimateFullContextUsage,
  compactToolResults,
  isPlanStillRunning,
  stripImageContentWithVisionFallback,
  detectToolNarration,
  resizeImageForVision,
} from "./chatHelpers";
import {
  clearConversation,
  beginAssistantMessage,
  persistUserMessage,
  upsertMessage,
} from "./chatPersistence";
import { readAssistantStream, type RawToolCall } from "./agentStream";
import { newId } from "./nanoid";
import type { AgentRun } from "./agentRuns";

/**
 * The agent turn loop, extracted from the /chat route so it can run detached
 * from the HTTP request. It drives an AgentRun: emitting events into the run's
 * replayable buffer and stopping on the run's own abort signal (cancel), NOT on
 * client disconnect. The run owns persistence of the resulting assistant message.
 *
 * `runAgentLoop` is the orchestrator; the turn is broken into named helpers
 * (`maybeSummarize`, `openLlmStream`, `readAssistantStream`, `executeToolTurn`,
 * `appendVisionFollowup`) so each is small and independently testable. All are
 * scope-agnostic, so project, image, and styleguide chats share one loop.
 *
 * Network-touching collaborators are injectable so the loop can be unit-tested
 * with a fake LLM and fake tools.
 */

type ConversationMsg = {
  role: string;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  reasoning_content?: string;
};

interface VisionImage {
  label: string;
  url: string;
}

export interface AgentLoopContext {
  conversation: ConversationMsg[];
  allTools: unknown[];
  toolsJson: string;
  contextWindow: number;
  threshold: number;
  visionCapable: boolean;
  activePlanContext: { id: string; title: string; status: string; steps: unknown[] } | null;
  projectId: string | null;
  systemPrompt: string;
  /** Last user message of this turn (for the mid-stream summarize rebuild). */
  latestUserMessage: { id: string; content: string; createdAt: string } | null;
  /** Count of client-sent messages — gates whether summarization runs. */
  clientMessageCount: number;
  uploadsDir?: string;
}

export interface AgentLoopDeps {
  streamChat: (conversation: unknown[], tools: unknown[]) => Promise<Response>;
  executeToolCall: (
    name: string, args: Record<string, unknown>, projectId: string | null,
    undoCtx?: { groupId: string; seq: number },
  ) => Promise<{ success: boolean; result: unknown }>;
  isExternalTool: (name: string) => boolean;
  callExternalTool: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; result: unknown }>;
  summarizeConversation: (messages: Array<{ role: string; content: unknown }>) => Promise<string>;
  isPlanStillRunning: (planId: string) => Promise<boolean>;
  generateGroupId: () => string;
}

function defaultDeps(): AgentLoopDeps {
  return {
    streamChat: realStreamChat as AgentLoopDeps["streamChat"],
    executeToolCall: realExecuteToolCall as AgentLoopDeps["executeToolCall"],
    isExternalTool: (name) => mcpClientManager.isExternalTool(name),
    callExternalTool: (name, args) => mcpClientManager.callTool(name, args),
    summarizeConversation: realSummarize as AgentLoopDeps["summarizeConversation"],
    isPlanStillRunning,
    generateGroupId,
  };
}

const MAX_TURNS = 500;
const MAX_PLAN_CONTINUATIONS = 5;
const MAX_TOOL_RESULT_CHARS = 20000;
const MAX_CONSECUTIVE_ERRORS = 5;

function hasImageContent(conversation: ConversationMsg[]): boolean {
  return conversation.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
  );
}

/**
 * If the conversation is over the summarization threshold, collapse it to a
 * summary. Only the project main thread is summarized+persisted; image and
 * styleguide side chats are short and keep their full history (matching the
 * pre-run-system behavior). Returns true if a summary was produced.
 */
export async function maybeSummarize(
  run: AgentRun,
  ctx: AgentLoopContext,
  deps: Pick<AgentLoopDeps, "summarizeConversation">,
): Promise<boolean> {
  const { conversation, toolsJson, threshold, contextWindow } = ctx;
  if (run.ref.scope !== "project") return false;
  const totalTokens = estimateFullContextUsage(conversation as Array<{ role: string; content: string }>, toolsJson);
  if (!(totalTokens > threshold && ctx.clientMessageCount > 4)) return false;

  run.emit("summarizing", {});
  const summary = await deps.summarizeConversation(conversation.map((m) => ({ role: m.role, content: m.content })));
  conversation.length = 0;
  conversation.push(
    { role: "system", content: ctx.systemPrompt },
    { role: "system", content: `Previous conversation summary:\n${summary}` },
    ...(ctx.latestUserMessage ? [{ role: "user", content: ctx.latestUserMessage.content }] : []),
  );
  run.resetAccumulators();

  await clearConversation(run.ref);
  await upsertMessage(run.ref, { id: newId(), role: "system", content: summary, status: "complete" });
  if (ctx.latestUserMessage) {
    await persistUserMessage(run.ref, {
      id: ctx.latestUserMessage.id, role: "user", content: ctx.latestUserMessage.content, createdAt: ctx.latestUserMessage.createdAt,
    });
  }
  await beginAssistantMessage(run.ref, run.assistantMsgId); // clearConversation() removed the placeholder
  run.emit("context_summarized", { summary });
  return true;
}

/**
 * Request one streamed completion. If a vision-capable request is rejected with
 * a 400 (many OpenAI-compatible endpoints reject image parts), strip the image
 * content and retry once as text. Throws if the LLM is unreachable or empty.
 */
export async function openLlmStream(
  conversation: ConversationMsg[],
  allTools: unknown[],
  deps: Pick<AgentLoopDeps, "streamChat">,
  uploadsDir: string,
): Promise<Response> {
  let res: Response;
  try {
    res = await deps.streamChat(conversation, allTools);
  } catch (err) {
    const errMsg = (err as Error).message;
    const isVisionRejection = hasImageContent(conversation) && /\b400\b/.test(errMsg) && !/\b404\b/.test(errMsg);
    if (!isVisionRejection) throw new Error(`LLM request failed: ${errMsg}`);
    await stripImageContentWithVisionFallback(conversation, uploadsDir);
    try {
      res = await deps.streamChat(conversation, allTools);
    } catch (retryErr) {
      throw new Error(`LLM request failed: ${(retryErr as Error).message}`);
    }
  }
  if (!res.body) throw new Error("No response from LLM");
  return res;
}

/** Read a wireframe layout preview off disk (base64) then delete it — it's a
 *  throwaway render, unlike a real generated asset. */
async function readLayoutPreview(uploadsDir: string, file: string, label: string): Promise<VisionImage | null> {
  try {
    const path = resolve(uploadsDir, file);
    const buf = await readFile(path);
    unlink(path).catch(() => {});
    return { label, url: `data:image/png;base64,${buf.toString("base64")}` };
  } catch (e) {
    console.warn("[agentLoop] could not read layout preview:", (e as Error).message);
    return null;
  }
}

/** Read a real generated image (resized for vision). Do NOT delete — it's an asset. */
function readViewImage(uploadsDir: string, file: string, label: string): VisionImage | null {
  try {
    const buf = resizeImageForVision(resolve(uploadsDir, file));
    return { label, url: `data:image/jpeg;base64,${buf.toString("base64")}` };
  } catch (e) {
    console.warn("[agentLoop] could not read generated image:", (e as Error).message);
    return null;
  }
}

export interface ToolTurnResult {
  consecutiveErrors: number;
  pendingLayoutImages: VisionImage[];
  pendingViewImages: VisionImage[];
}

/**
 * Execute the tool calls from one assistant turn: route each to the local or
 * external executor, stream its result into the run, append the tool result to
 * the conversation, and (for vision models) collect any layout/view images to
 * feed back afterwards. Stops early on abort or too many consecutive failures.
 */
export async function executeToolTurn(
  run: AgentRun,
  ctx: AgentLoopContext,
  deps: Pick<AgentLoopDeps, "executeToolCall" | "isExternalTool" | "callExternalTool">,
  toolCalls: RawToolCall[],
  undo: { groupId: string; nextSeq: () => number },
  consecutiveErrors: number,
  aborted: () => boolean,
): Promise<ToolTurnResult> {
  const uploadsDir = ctx.uploadsDir ?? getUploadsDir();
  const pendingLayoutImages: VisionImage[] = [];
  const pendingViewImages: VisionImage[] = [];

  for (const tc of toolCalls) {
    if (aborted()) break;
    let args: Record<string, unknown> = {};
    try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* malformed args — treat as empty */ }

    const name = tc.function.name;
    const result = deps.isExternalTool(name)
      ? await deps.callExternalTool(name, args)
      : await deps.executeToolCall(name, args, ctx.projectId, { groupId: undo.groupId, seq: undo.nextSeq() });

    run.pushToolResult({
      id: tc.id, name, arguments: args, result: result.result,
      status: result.success ? "executed" : "rejected",
    });

    if (name === "update_plan" && result.success) {
      run.emit("plan_update", { plan: result.result as Record<string, unknown> });
    }

    let resultJson = JSON.stringify(result);
    if (resultJson.length > MAX_TOOL_RESULT_CHARS) {
      resultJson = JSON.stringify({ success: result.success, result: "(result truncated)" });
    }
    ctx.conversation.push({ role: "tool", content: resultJson, tool_call_id: tc.id });

    if (ctx.visionCapable && result.success) {
      const rr = result.result as { file?: string; image_id?: string; asset_id?: string } | undefined;
      if (name === "render_layout_image" && rr?.file) {
        const im = await readLayoutPreview(uploadsDir, rr.file, (args.image_id as string) || "frame");
        if (im) pendingLayoutImages.push(im);
      } else if (name === "view_image" && rr?.file) {
        const im = readViewImage(uploadsDir, rr.file, rr.image_id || rr.asset_id || (args.image_id as string) || "image");
        if (im) pendingViewImages.push(im);
      }
    }

    if (!result.success) {
      consecutiveErrors++;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break;
    } else {
      consecutiveErrors = 0;
    }
  }

  return { consecutiveErrors, pendingLayoutImages, pendingViewImages };
}

/**
 * After tool results, feed any collected images back as a user message so a
 * vision model can inspect what it just laid out / rendered and self-correct.
 */
export function appendVisionFollowup(
  conversation: ConversationMsg[],
  pendingLayoutImages: VisionImage[],
  pendingViewImages: VisionImage[],
): void {
  if (pendingLayoutImages.length > 0) {
    conversation.push({
      role: "user",
      content: [
        { type: "text", text: "Here is a labeled wireframe of the bounding boxes you just laid out (numbers match the region order). Look at it and verify each box is positioned and proportioned correctly for this canvas — fix any that are stretched, overlapping wrong, or mis-placed using update_region. If it looks right, proceed." },
        ...pendingLayoutImages.map((im) => ({ type: "image_url" as const, image_url: { url: im.url } })),
      ],
    });
  }

  if (pendingViewImages.length > 0) {
    conversation.push({
      role: "user",
      content: [
        { type: "text", text: `Here ${pendingViewImages.length === 1 ? "is the generated image" : "are the generated images"} you asked to view (label = frame/asset id). Look carefully and compare against the intended high-level description, composition, proportions, and any text. If it looks right, say so and continue. If something is wrong, make the needed edits (update_region / set_high_level_description / set_color_palette, etc.) and regenerate.` },
        ...pendingViewImages.map((im) => ({ type: "image_url" as const, image_url: { url: im.url } })),
      ],
    });
  }
}

export async function runAgentLoop(
  run: AgentRun,
  ctx: AgentLoopContext,
  depsOverride?: Partial<AgentLoopDeps>,
): Promise<void> {
  const deps = { ...defaultDeps(), ...depsOverride };
  const uploadsDir = ctx.uploadsDir ?? getUploadsDir();
  const { conversation, allTools, toolsJson, contextWindow, threshold, activePlanContext } = ctx;
  const aborted = () => run.signal.aborted;

  let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  run.signal.addEventListener("abort", () => { activeReader?.cancel().catch(() => {}); }, { once: true });

  let turnCount = 0;
  let consecutiveErrors = 0;

  try {
    run.emit("context_status", {
      used: estimateFullContextUsage(conversation as Array<{ role: string; content: string }>, toolsJson),
      total: contextWindow,
    });

    await maybeSummarize(run, ctx, deps);

    run.emit("assistant_msg_id", { id: run.assistantMsgId });

    const undoGroupId = deps.generateGroupId();
    let undoSeq = 0;
    const undo = { groupId: undoGroupId, nextSeq: () => undoSeq++ };
    let planContinuations = 0;

    while (planContinuations <= MAX_PLAN_CONTINUATIONS) {
      if (aborted()) break;

      while (turnCount < MAX_TURNS) {
        if (aborted()) break;
        turnCount++;

        const midLoopTokens = estimateFullContextUsage(conversation as Array<{ role: string; content: string }>, toolsJson);
        if (midLoopTokens > threshold) {
          compactToolResults(conversation as any);
          const afterCompact = estimateFullContextUsage(conversation as Array<{ role: string; content: string }>, toolsJson);
          if (afterCompact > threshold) {
            conversation.push({ role: "system", content: "CONTEXT NOTICE: You are running low on context space. Finish your current step and provide a summary." });
          }
          run.emit("context_status", { used: afterCompact, total: contextWindow });
        }

        const llmResponse = await openLlmStream(conversation, allTools, deps, uploadsDir);

        const reader = llmResponse.body!.getReader();
        activeReader = reader;
        const { content, thinking, toolCalls, finishReason } = await readAssistantStream(reader, {
          aborted,
          onContent: (t) => run.pushContent(t),
          onThinking: (t) => run.pushThinking(t),
        });
        activeReader = null;

        if (aborted()) break;

        if (finishReason !== "tool_calls" || toolCalls.length === 0) {
          if (activePlanContext && content && turnCount < MAX_TURNS) {
            const planStillRunning = await deps.isPlanStillRunning(activePlanContext.id);
            const isAskingUser = content.trimEnd().endsWith("?");
            if (planStillRunning && !isAskingUser) {
              conversation.push({ role: "assistant", content });
              conversation.push({ role: "user", content: "Continue executing the plan." });
              run.pushContent("\n\n*Continuing plan execution...*\n\n");
              continue;
            }
          }

          const toolNames = allTools.map((t: any) => t.function?.name || t.name).filter(Boolean);
          const nudge = detectToolNarration(content, toolNames);
          if (nudge && turnCount < MAX_TURNS) {
            conversation.push({ role: "assistant", content });
            conversation.push({ role: "user", content: nudge });
            continue;
          }

          break;
        }

        conversation.push({
          role: "assistant",
          content: content || "",
          tool_calls: toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: { name: tc.function.name, arguments: tc.function.arguments },
          })),
          ...(thinking ? { reasoning_content: thinking } : {}),
        });

        const turn = await executeToolTurn(run, ctx, deps, toolCalls, undo, consecutiveErrors, aborted);
        consecutiveErrors = turn.consecutiveErrors;
        appendVisionFollowup(conversation, turn.pendingLayoutImages, turn.pendingViewImages);

        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break;
      }

      if (turnCount >= MAX_TURNS && activePlanContext) {
        const planStillRunning = await deps.isPlanStillRunning(activePlanContext.id);
        if (planStillRunning) {
          planContinuations++;
          compactToolResults(conversation as any, 2);
          conversation.push({ role: "user", content: "Continue executing the plan from where you left off." });
          run.pushContent("\n\n*Continuing plan execution...*\n\n");
          turnCount = 0;
          consecutiveErrors = 0;
          continue;
        }
      }

      if (turnCount >= MAX_TURNS) {
        run.pushContent("\n\n*[Reached tool call limit — send another message to continue]*");
      }
      break;
    }

    await run.complete();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[agentLoop] error:", message, error instanceof Error ? error.stack : "");
    await run.fail(message);
  }
}
