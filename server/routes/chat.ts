import { Hono } from "hono";
import { streamChat, getToolDefinitions, getContextWindowSize, summarizeConversation } from "../lib/llm";
import { db, schema } from "../db/client";
import { eq, and, asc, notInArray } from "drizzle-orm";
import { newId } from "../lib/nanoid";
import { getSystemPrompt } from "../lib/systemPrompt";
import { loadAttachedStyleguides } from "../lib/styleguideContext";
import { executeToolCall } from "../lib/toolExecutor";
import { generateGroupId } from "../lib/undoManager";
import { mcpClientManager } from "../lib/mcp/clientManager";
import { getUploadsDir } from "../lib/config";
import {
  processAttachments,
  estimateFullContextUsage,
  compactToolResults,
  isPlanStillRunning,
  stripImageContentWithVisionFallback,
  detectToolNarration,
} from "../lib/chatHelpers";
import { getComfyDisabledWorkflowIds } from "../lib/comfyuiClient";
import { getDisabledToolBuckets, filterToolsByBuckets } from "../lib/toolBuckets";
import { parseLayout } from "../lib/layout";
import { readFile, unlink } from "fs/promises";
import { resolve } from "path";

const app = new Hono();

app.post("/chat", async (c) => {
  const body = await c.req.json();
  const { messages: clientMessages, projectId, selectedImageId } = body;

  const [project] = projectId
    ? await db.select().from(schema.projects).where(eq(schema.projects.id, projectId))
    : [null];

  // Storyboard images, ordered.
  const imageRows = projectId
    ? await db.select().from(schema.images).where(eq(schema.images.projectId, projectId)).orderBy(asc(schema.images.order))
    : [];
  const images = imageRows.map((img) => {
    let highLevel = "";
    let regionCount = 0;
    try {
      const layout = parseLayout(img.layout);
      highLevel = layout.high_level_description;
      regionCount = layout.compositional_deconstruction.length;
    } catch { /* ignore */ }
    return { id: img.id, order: img.order, name: img.name ?? "", status: img.status, highLevelDescription: highLevel, regionCount };
  });

  // Selected image (full layout for focused editing).
  let selectedImageDetails: Record<string, unknown> | undefined;
  if (selectedImageId) {
    const [img] = await db.select().from(schema.images).where(eq(schema.images.id, selectedImageId));
    if (img) {
      selectedImageDetails = {
        id: img.id, order: img.order, name: img.name, status: img.status,
        layout: parseLayout(img.layout), plainPrompt: img.plainPrompt, negativePrompt: img.negativePrompt,
      };
    }
  }

  // Available generation workflows.
  const disabledWorkflowIds = await getComfyDisabledWorkflowIds();
  const workflowRows = await db.select().from(schema.workflows);
  const availableWorkflows = workflowRows
    .filter((workflow) => !disabledWorkflowIds.has(workflow.id))
    .map((w) => ({ id: w.id, name: w.name, description: w.description || "", type: w.workflowType, isDefault: w.isDefault === 1 }));

  // Active plan.
  let activePlanContext: { id: string; title: string; status: string; steps: Array<{ id: string; label: string; status: string; notes?: string }> } | null = null;
  if (projectId) {
    const [planRow] = await db.select().from(schema.plans)
      .where(and(eq(schema.plans.projectId, projectId), notInArray(schema.plans.status, ["completed", "cancelled"])))
      .limit(1);
    if (planRow) {
      activePlanContext = { id: planRow.id, title: planRow.title, status: planRow.status, steps: JSON.parse(planRow.steps) };
    }
  }

  // Recent assets.
  let recentAssets: Array<{ id: string; type: string; prompt: string | null; description: string | null; createdAt: string }> | undefined;
  if (projectId) {
    const assetRows = await db.select().from(schema.assets)
      .where(eq(schema.assets.projectId, projectId))
      .orderBy(schema.assets.createdAt)
      .limit(10);
    if (assetRows.length > 0) {
      recentAssets = assetRows.reverse().map((a) => ({ id: a.id, type: a.type, prompt: a.prompt, description: a.description || null, createdAt: a.createdAt }));
    }
  }

  const attachedStyleguides = project?.id ? await loadAttachedStyleguides(project.id) : [];

  const systemPrompt = getSystemPrompt({
    projectName: project?.name,
    aspectRatio: project?.aspectRatio,
    megapixels: project?.megapixels ?? undefined,
    width: project?.width,
    height: project?.height,
    promptFormat: project?.promptFormat,
    activePlan: activePlanContext,
    images,
    selectedImageId,
    selectedImageDetails,
    availableWorkflows: availableWorkflows.length > 0 ? availableWorkflows : undefined,
    recentAssets,
    attachedStyleguides: attachedStyleguides.length > 0 ? attachedStyleguides : undefined,
  });

  const baseTools = getToolDefinitions();
  const disabledBuckets = projectId ? await getDisabledToolBuckets(projectId) : new Set<string>();
  const tools = filterToolsByBuckets(baseTools, disabledBuckets);
  const externalTools = mcpClientManager.getAllToolDefinitions();
  const allTools = [...tools, ...externalTools];
  const toolsJson = JSON.stringify(allTools);
  const maxTurns = 500;
  let turnCount = 0;
  let consecutiveErrors = 0;

  const processedMessages = (
    await Promise.all(clientMessages.map(processAttachments))
  ).filter((m: { role: string; content: unknown }) => {
    if (m.role !== "assistant") return true;
    if (Array.isArray(m.content)) return m.content.length > 0;
    return typeof m.content === "string" && m.content.trim().length > 0;
  });

  const conversation: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
    reasoning_content?: string;
  }> = [
    { role: "system", content: systemPrompt },
    ...processedMessages,
  ];

  const contextWindow = await getContextWindowSize();
  const totalTokens = estimateFullContextUsage(conversation as Array<{ role: string; content: string }>, toolsJson);
  const threshold = Math.floor(contextWindow * 0.8);

  const encoder = new TextEncoder();
  const abortSignal = c.req.raw.signal;
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      let activeReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      function send(event: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: event, ...data as object })}\n\n`));
        } catch {
          closed = true;
        }
      }

      const onAbort = () => {
        closed = true;
        activeReader?.cancel().catch(() => {});
      };
      if (abortSignal.aborted) closed = true;
      else abortSignal.addEventListener("abort", onAbort, { once: true });

      try {
        send("context_status", { used: totalTokens, total: contextWindow });

        if (totalTokens > threshold && clientMessages.length > 4) {
          send("summarizing", {});
          const summary = await summarizeConversation(conversation.map((m) => ({ role: m.role, content: m.content })));
          const latestUser = clientMessages[clientMessages.length - 1];
          conversation.length = 0;
          conversation.push(
            { role: "system", content: systemPrompt },
            { role: "system", content: `Previous conversation summary:\n${summary}` },
            { role: "user", content: latestUser.content }
          );
          send("context_summarized", { summary });
        }

        const assistantMsgId = newId();
        send("assistant_msg_id", { id: assistantMsgId });

        const undoGroupId = generateGroupId();
        let undoSeq = 0;
        const MAX_PLAN_CONTINUATIONS = 5;
        let planContinuations = 0;

        while (planContinuations <= MAX_PLAN_CONTINUATIONS) {
        if (closed) break;

        while (turnCount < maxTurns) {
          if (closed) break;
          turnCount++;

          const midLoopTokens = estimateFullContextUsage(conversation as Array<{ role: string; content: string }>, toolsJson);
          if (midLoopTokens > threshold) {
            compactToolResults(conversation);
            const afterCompact = estimateFullContextUsage(conversation as Array<{ role: string; content: string }>, toolsJson);
            if (afterCompact > threshold) {
              conversation.push({ role: "system", content: "CONTEXT NOTICE: You are running low on context space. Finish your current step and provide a summary." });
            }
            send("context_status", { used: afterCompact, total: contextWindow });
          }

          let llmResponse: Response;
          try {
            llmResponse = await streamChat(conversation as any, allTools as any);
          } catch (err) {
            const errMsg = (err as Error).message;
            console.error("[chat] LLM request failed:", errMsg);
            const hasImageContent = (conversation as any[]).some((m: any) =>
              Array.isArray(m.content) && m.content.some((p: any) => p.type === "image_url"));
            const isVisionRejection = hasImageContent && turnCount === 1 && /\b400\b/.test(errMsg) && !/\b404\b/.test(errMsg);
            if (isVisionRejection) {
              await stripImageContentWithVisionFallback(conversation, getUploadsDir());
              try {
                llmResponse = await streamChat(conversation as any, allTools as any);
              } catch (retryErr) {
                send("error", { message: `LLM request failed: ${(retryErr as Error).message}` });
                break;
              }
            } else {
              send("error", { message: `LLM request failed: ${errMsg}` });
              break;
            }
          }
          if (!llmResponse.body) {
            send("error", { message: "No response from LLM" });
            break;
          }

          const reader = llmResponse.body.getReader();
          activeReader = reader;
          const decoder = new TextDecoder();
          let buffer = "";
          let content = "";
          let thinking = "";
          // Layout-wireframe PNGs produced by render_layout_image this turn; injected
          // as a vision user-message after the tool results so the model sees them.
          const pendingLayoutImages: Array<{ label: string; url: string }> = [];
          let toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> = [];
          let finishReason = "";

          while (true) {
            if (closed) break;
            let done: boolean | undefined;
            let value: Uint8Array | undefined;
            try {
              ({ done, value } = await reader.read());
            } catch {
              break;
            }
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const data = line.slice(6).trim();
              if (data === "[DONE]") continue;
              try {
                const parsed = JSON.parse(data);
                const delta = parsed.choices?.[0]?.delta;
                const reason = parsed.choices?.[0]?.finish_reason;
                if (reason) finishReason = reason;
                if (delta?.content) {
                  content += delta.content;
                  send("content", { text: delta.content });
                }
                if (delta?.reasoning_content || delta?.thinking) {
                  const t = delta.reasoning_content || delta.thinking;
                  thinking += t;
                  send("thinking", { text: t });
                }
                if (delta?.tool_calls) {
                  for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    while (toolCalls.length <= idx) {
                      toolCalls.push({ id: "", type: "function", function: { name: "", arguments: "" } });
                    }
                    if (tc.id) toolCalls[idx].id = tc.id;
                    if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
                    if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
                  }
                }
              } catch {}
            }
          }
          activeReader = null;

          if (closed) break;

          if (finishReason !== "tool_calls" || toolCalls.length === 0) {
            if (activePlanContext && content && turnCount < maxTurns) {
              const planStillRunning = await isPlanStillRunning(activePlanContext.id);
              const isAskingUser = content.trimEnd().endsWith("?");
              if (planStillRunning && !isAskingUser) {
                conversation.push({ role: "assistant", content });
                conversation.push({ role: "user", content: "Continue executing the plan." });
                send("content", { text: "\n\n*Continuing plan execution...*\n\n" });
                content = ""; thinking = ""; toolCalls = [];
                continue;
              }
            }

            const toolNames = allTools.map((t: any) => t.function?.name || t.name).filter(Boolean);
            const nudge = detectToolNarration(content, toolNames);
            if (nudge && turnCount < maxTurns) {
              conversation.push({ role: "assistant", content });
              conversation.push({ role: "user", content: nudge });
              content = ""; thinking = ""; toolCalls = [];
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

          for (const tc of toolCalls) {
            if (closed) break;
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(tc.function.arguments || "{}"); } catch {}

            let result;
            if (mcpClientManager.isExternalTool(tc.function.name)) {
              result = await mcpClientManager.callTool(tc.function.name, args);
            } else {
              result = await executeToolCall(tc.function.name, args, projectId, { groupId: undoGroupId, seq: undoSeq++ });
            }

            send("tool_call_result", {
              toolCallId: tc.id,
              name: tc.function.name,
              args,
              result: result.result,
              success: result.success,
            });

            if (tc.function.name === "update_plan" && result.success) {
              send("plan_update", { plan: result.result });
            }

            let resultJson = JSON.stringify(result);
            if (resultJson.length > 20000) {
              resultJson = JSON.stringify({ success: result.success, result: "(result truncated)" });
            }

            conversation.push({ role: "tool", content: resultJson, tool_call_id: tc.id });

            // render_layout_image wrote a wireframe PNG — queue it to show the model.
            if (tc.function.name === "render_layout_image" && result.success) {
              const rr = result.result as { file?: string } | undefined;
              if (rr?.file) {
                try {
                  const path = resolve(getUploadsDir(), rr.file);
                  const buf = await readFile(path);
                  pendingLayoutImages.push({
                    label: (args.image_id as string) || "frame",
                    url: `data:image/png;base64,${buf.toString("base64")}`,
                  });
                  unlink(path).catch(() => {}); // transient preview — drop after embedding
                } catch (e) {
                  console.warn("[chat] could not read layout preview:", (e as Error).message);
                }
              }
            }

            if (!result.success) {
              consecutiveErrors++;
              if (consecutiveErrors >= 5) break;
            } else {
              consecutiveErrors = 0;
            }
          }

          // Inject any layout wireframes as a vision message (after all tool
          // results, so the assistant/tool message pairing stays valid).
          if (pendingLayoutImages.length > 0) {
            conversation.push({
              role: "user",
              content: [
                { type: "text", text: "Here is a labeled wireframe of the bounding boxes you just laid out (numbers match the region order). Look at it and verify each box is positioned and proportioned correctly for this canvas — fix any that are stretched, overlapping wrong, or mis-placed using update_region. If it looks right, proceed." },
                ...pendingLayoutImages.map((im) => ({ type: "image_url" as const, image_url: { url: im.url } })),
              ],
            });
          }

          if (consecutiveErrors >= 5) break;
          content = ""; thinking = ""; toolCalls = [];
        }

        if (turnCount >= maxTurns && activePlanContext) {
          const planStillRunning = await isPlanStillRunning(activePlanContext.id);
          if (planStillRunning) {
            planContinuations++;
            compactToolResults(conversation, 2);
            conversation.push({ role: "user", content: "Continue executing the plan from where you left off." });
            send("content", { text: "\n\n*Continuing plan execution...*\n\n" });
            turnCount = 0;
            consecutiveErrors = 0;
            continue;
          }
        }

        if (turnCount >= maxTurns) {
          send("content", { text: "\n\n*[Reached tool call limit — send another message to continue]*" });
        }
        break;
        }
        send("done", {});
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[chat] Stream error:", message, error instanceof Error ? error.stack : "");
        send("error", { message });
      } finally {
        abortSignal.removeEventListener("abort", onAbort);
        if (!closed) {
          closed = true;
          try { controller.close(); } catch {}
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

app.post("/chat/summarize", async (c) => {
  const body = await c.req.json();
  const { projectId } = body;
  const rows = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.projectId, projectId));
  const messages = rows.map((r) => ({ role: r.role, content: r.content }));
  const summary = await summarizeConversation(messages);
  const messageId = newId();
  await db.delete(schema.chatMessages).where(eq(schema.chatMessages.projectId, projectId));
  await db.insert(schema.chatMessages).values({
    id: messageId, projectId, role: "system", content: summary, thinking: null, toolCalls: null, segments: null, createdAt: new Date().toISOString(),
  });
  return c.json({ summary, messageId });
});

export default app;
