import { useStore } from "../store";
import { api } from "../api/client";
import type { ChatMessage, ChatAttachment, MessageSegment, ToolCall, Plan } from "../types";
import { nanoid } from "nanoid";
import { parseSSEStream } from "./sseParser";

let abortController: AbortController | null = null;

export async function sendChatMessage(content: string, attachments?: ChatAttachment[]) {
  const { getState, setState } = useStore;

  if (getState().isStreaming) return;

  const ctx = getState().contextStatus;
  if (ctx && ctx.used / ctx.total >= 0.8 && getState().messages.length >= 3) {
    await getState().summarizeChat();
  }

  const userMsg: ChatMessage = {
    id: nanoid(),
    role: "user",
    content,
    attachments: attachments && attachments.length > 0 ? attachments : undefined,
    timestamp: new Date().toISOString(),
  };
  setState({ messages: [...getState().messages, userMsg], isStreaming: true });

  // Snapshot scope at the start of the turn so a Done click mid-stream doesn't
  // redirect saves or post-tool side effects to the wrong target.
  const pid = getState().project?.id;
  const styleguideId = getState().activeStyleguideId;
  // Image-scoped side conversation: persist to the image's own history instead
  // of the shared project conversation.
  const imageScopeId = (!styleguideId && getState().chatScope === "image") ? getState().selectedImageId : null;
  if (styleguideId) {
    api.saveStyleguideMessage(styleguideId, {
      id: userMsg.id, role: userMsg.role, content: userMsg.content, createdAt: userMsg.timestamp,
    }).catch((e) => console.error("[chatStream] save styleguide user message failed", e));
  } else if (imageScopeId) {
    api.saveImageMessage(imageScopeId, {
      id: userMsg.id, role: userMsg.role, content: userMsg.content, createdAt: userMsg.timestamp,
    }).catch((e) => console.error("[chatStream] save image user message failed", e));
  } else if (pid) {
    api.saveMessage(pid, {
      id: userMsg.id, role: userMsg.role, content: userMsg.content, createdAt: userMsg.timestamp,
    }).catch((e) => console.error("[chatStream] save user message failed", e));
  }

  const allMessages = [...getState().messages].map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.attachments && m.attachments.length > 0 ? { attachments: m.attachments } : {}),
  }));

  abortController = new AbortController();

  try {
    const endpoint = styleguideId
      ? `/api/styleguides/${styleguideId}/chat`
      : "/api/chat";
    const reqBody: Record<string, unknown> = styleguideId
      ? { messages: allMessages }
      : {
          messages: allMessages,
          projectId: getState().project?.id ?? null,
          selectedImageId: getState().selectedImageId,
        };
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reqBody),
      signal: abortController.signal,
    });

    if (!res.ok) throw new Error(`Chat error: ${res.statusText}`);

    const reader = res.body!.getReader();
    let assistantContent = "";
    let assistantThinking = "";
    const toolCalls: ToolCall[] = [];
    const segments: MessageSegment[] = [];
    let currentSegmentType: "thinking" | "text" | null = null;
    let assistantMsgId = nanoid();

    await parseSSEStream(reader, {
      onEvent: async (parsed) => {
        if (parsed.type === "assistant_msg_id") {
          assistantMsgId = parsed.id as string;
        }

        if (parsed.type === "thinking") {
          assistantThinking += (parsed.content || parsed.text || "");
          if (currentSegmentType === "thinking") {
            segments[segments.length - 1] = { type: "thinking", content: (segments[segments.length - 1] as { content: string }).content + (parsed.content || parsed.text || "") };
          } else {
            segments.push({ type: "thinking", content: (parsed.content || parsed.text || "") as string });
            currentSegmentType = "thinking";
          }
          setState((state) => {
            const existing = state.messages.find((m) => m.id === assistantMsgId);
            const msgData = { thinking: assistantThinking, segments: [...segments] };
            if (existing) {
              return { messages: state.messages.map((m) => m.id === assistantMsgId ? { ...m, ...msgData } : m) };
            }
            return {
              messages: [...state.messages, { id: assistantMsgId, role: "assistant" as const, content: "", ...msgData, timestamp: new Date().toISOString() }],
            };
          });
        }

        if (parsed.type === "content") {
          assistantContent += (parsed.content || parsed.text || "");
          if (currentSegmentType === "text") {
            segments[segments.length - 1] = { type: "text", content: (segments[segments.length - 1] as { content: string }).content + (parsed.content || parsed.text || "") };
          } else {
            segments.push({ type: "text", content: (parsed.content || parsed.text || "") as string });
            currentSegmentType = "text";
          }
          setState((state) => {
            const existing = state.messages.find((m) => m.id === assistantMsgId);
            const msgData = { content: assistantContent, thinking: assistantThinking || undefined, segments: [...segments] };
            if (existing) {
              return { messages: state.messages.map((m) => m.id === assistantMsgId ? { ...m, ...msgData } : m) };
            }
            return {
              messages: [...state.messages, { id: assistantMsgId, role: "assistant" as const, ...msgData, timestamp: new Date().toISOString() }],
            };
          });
        }

        if (parsed.type === "tool_call_result") {
          const tc = parsed;
          const toolCall: ToolCall = {
            id: tc.toolCallId as string,
            name: tc.name as string,
            arguments: tc.args as Record<string, unknown>,
            result: tc.result,
            status: tc.success ? "executed" : "rejected",
          };
          toolCalls.push(toolCall);
          segments.push({ type: "tool_call", toolCall });
          currentSegmentType = null;
          setState((state) => ({
            messages: state.messages.map((m) =>
              m.id === assistantMsgId ? { ...m, toolCalls: [...toolCalls], segments: [...segments] } : m
            ),
          }));

          if (tc.success) {
            if (styleguideId) {
              // Tool changed styleguide content — refresh the active styleguide
              // so the UI reflects LLM edits (markdown/assets).
              const mutatingTools = ["update_styleguide_markdown", "patch_styleguide_markdown", "tag_brand_asset"];
              if (mutatingTools.includes(tc.name as string)) {
                await getState().loadStyleguide(styleguideId);
              }
            } else {
              // Project chat — refresh the storyboard frames so LLM layout/
              // image edits show up, and refresh assets after generation.
              await getState().loadImages();
              const genTools = ["generate_image", "regenerate_image"];
              if (genTools.includes(tc.name as string)) {
                getState().loadAssets();
              }
            }
          }
        }

        if (parsed.type === "plan_update") {
          setState({ activePlan: parsed.plan as Plan });
        }

        if (parsed.type === "context_status") {
          setState({ contextStatus: { used: parsed.used as number, total: parsed.total as number } });
        }

        if (parsed.type === "summarizing") {
          setState({ isSummarizing: true });
        }

        if (parsed.type === "context_summarized") {
          const summary = parsed.summary as string;
          const pid2 = getState().project?.id;
          const summaryMsg: ChatMessage = { id: nanoid(), role: "system", content: summary, timestamp: new Date().toISOString() };
          const currentMessages = getState().messages;
          const latestUserMsg = currentMessages[currentMessages.length - 1];
          setState({ messages: [summaryMsg, latestUserMsg], isSummarizing: false });
          if (pid2 && !imageScopeId) {
            api.clearMessages(pid2)
              .then(() => Promise.all([
                api.saveMessage(pid2, { id: summaryMsg.id, role: summaryMsg.role, content: summaryMsg.content, createdAt: summaryMsg.timestamp }),
                api.saveMessage(pid2, { id: latestUserMsg.id, role: latestUserMsg.role, content: latestUserMsg.content, createdAt: latestUserMsg.timestamp }),
              ]))
              .catch((e) => console.error("[chatStream] save summary failed", e));
          }
        }

        if (parsed.type === "done") {
          setState((state) => {
            const existing = state.messages.find((m) => m.id === assistantMsgId);
            if (!existing && (assistantContent || assistantThinking || toolCalls.length > 0)) {
              return {
                messages: [...state.messages, {
                  id: assistantMsgId, role: "assistant" as const, content: assistantContent,
                  thinking: assistantThinking || undefined,
                  toolCalls: toolCalls.length > 0 ? [...toolCalls] : undefined,
                  segments: segments.length > 0 ? [...segments] : undefined,
                  timestamp: new Date().toISOString(),
                }],
              };
            }
            return {};
          });

          const projId = getState().project?.id;
          const sgId = getState().activeStyleguideId;
          if ((assistantContent || assistantThinking || toolCalls.length > 0)) {
            const assistantMsg = getState().messages.find((m) => m.id === assistantMsgId);
            if (assistantMsg) {
              if (sgId) {
                api.saveStyleguideMessage(sgId, {
                  id: assistantMsg.id, role: assistantMsg.role, content: assistantMsg.content,
                  thinking: assistantMsg.thinking, toolCalls: assistantMsg.toolCalls,
                  segments: assistantMsg.segments, createdAt: assistantMsg.timestamp,
                }).catch((e) => console.error("[chatStream] save styleguide assistant message failed", e));
              } else if (imageScopeId) {
                api.saveImageMessage(imageScopeId, {
                  id: assistantMsg.id, role: assistantMsg.role, content: assistantMsg.content,
                  thinking: assistantMsg.thinking, toolCalls: assistantMsg.toolCalls,
                  segments: assistantMsg.segments, createdAt: assistantMsg.timestamp,
                }).catch((e) => console.error("[chatStream] save image assistant message failed", e));
              } else if (projId) {
                api.saveMessage(projId, {
                  id: assistantMsg.id, role: assistantMsg.role, content: assistantMsg.content,
                  thinking: assistantMsg.thinking, toolCalls: assistantMsg.toolCalls,
                  segments: assistantMsg.segments, createdAt: assistantMsg.timestamp,
                }).catch((e) => console.error("[chatStream] save assistant message failed", e));
              }
            }
          }

          // Refresh storyboard frames after a project-chat turn that ran tools.
          if (toolCalls.length > 0 && !sgId) {
            await getState().loadImages();
          }
        }

        if (parsed.type === "error") {
          console.error("[chat] Server error:", parsed.error || parsed.message);
          setState({
            messages: [...getState().messages, { id: nanoid(), role: "assistant", content: `Error: ${parsed.error || parsed.message}`, timestamp: new Date().toISOString() }],
          });
        }
      },
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      // User stopped
    } else {
      const err = e instanceof Error ? e : new Error(String(e));
      setState({
        messages: [...getState().messages, { id: nanoid(), role: "assistant", content: `Error: ${err.message}`, timestamp: new Date().toISOString() }],
      });
    }
  } finally {
    abortController = null;
    setState({ isStreaming: false });
  }
}

export function stopStreaming() {
  if (abortController) {
    abortController.abort();
    abortController = null;
  }
  useStore.setState({ isStreaming: false });
}

export function retryLastMessage() {
  const { getState, setState } = useStore;
  if (getState().isStreaming) return;
  const msgs = getState().messages;
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") { lastUserIdx = i; break; }
  }
  if (lastUserIdx === -1) return;
  const userContent = msgs[lastUserIdx].content;
  setState({ messages: msgs.slice(0, lastUserIdx) });
  sendChatMessage(userContent);
}
