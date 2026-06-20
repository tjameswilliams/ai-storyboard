import { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "../../store";
import { api } from "../../api/client";
import type { ChatMessage, ChatAttachment, MessageSegment, ToolCall } from "../../types";
import { PlanChecklist } from "./PlanChecklist";
import { WorkflowCheckboxDropdown } from "../comfy/WorkflowCheckboxDropdown";
import { ToolChip } from "../ui/ToolChip";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { Icon } from "../ui/Icon";
import { AutoTextarea } from "../ui/AutoTextarea";

const mdComponents = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc ml-4 mb-2">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal ml-4 mb-2">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-0.5">{children}</li>,
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-bold mb-1">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-bold mb-1">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-semibold mb-1">{children}</h3>,
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = className?.includes("language-");
    return isBlock ? (
      <code className="block bg-zinc-900 rounded p-2 my-2 text-xs overflow-x-auto whitespace-pre">{children}</code>
    ) : (
      <code className="bg-zinc-900 rounded px-1 py-0.5 text-xs">{children}</code>
    );
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-zinc-600 pl-2 my-2 text-zinc-400 italic">{children}</blockquote>
  ),
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">{children}</a>
  ),
};

function ThinkingSegment({ content, isActive, defaultOpen }: { content: string; isActive: boolean; defaultOpen: boolean }) {
  const [manualToggle, setManualToggle] = useState<boolean | null>(null);
  const expanded = manualToggle !== null ? manualToggle : (isActive || defaultOpen);
  const containerRef = useRef<HTMLDivElement>(null);
  const userScrolledRef = useRef(false);

  useEffect(() => {
    if (!isActive || !expanded) return;
    const el = containerRef.current;
    if (!el || userScrolledRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [content, isActive, expanded]);

  useEffect(() => {
    if (!isActive || !expanded) { userScrolledRef.current = false; return; }
    const el = containerRef.current;
    if (!el) return;
    const handleScroll = () => {
      userScrolledRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 30;
    };
    el.addEventListener("scroll", handleScroll);
    return () => el.removeEventListener("scroll", handleScroll);
  }, [isActive, expanded]);

  useEffect(() => { if (!isActive) userScrolledRef.current = false; }, [isActive]);

  return (
    <div className="my-1.5">
      <button
        onClick={() => setManualToggle(expanded ? false : true)}
        className="flex items-center gap-1.5 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <svg className={`w-3 h-3 transition-transform ${expanded ? "rotate-90" : ""}`} fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" />
        </svg>
        {isActive ? (
          <span className="flex items-center gap-1">
            Thinking
            <span className="inline-flex gap-0.5">
              <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
              <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
            </span>
          </span>
        ) : (
          <span>Thought process</span>
        )}
      </button>
      {expanded && (
        <div
          ref={containerRef}
          className="mt-1 ml-1 border-l-2 border-zinc-700 pl-2 text-xs text-zinc-500 italic whitespace-pre-wrap max-h-[300px] overflow-y-auto"
        >
          {content}
        </div>
      )}
    </div>
  );
}

function ToolCallSegment({ toolCall }: { toolCall: ToolCall }) {
  const status: "executed" | "rejected" | "pending" =
    toolCall.status === "executed"
      ? "executed"
      : toolCall.status === "rejected"
      ? "rejected"
      : "pending";
  const args = toolCall.arguments as Record<string, unknown> | undefined;
  const labelRaw = args
    ? (args.label ?? args.description ?? args.name ?? args.text)
    : undefined;
  const label = labelRaw != null ? String(labelRaw).slice(0, 60) : undefined;

  return (
    <div className="my-1 flex items-center gap-2 flex-wrap">
      <ToolChip status={status} name={toolCall.name} label={label} />
    </div>
  );
}

function parseThinkTags(text: string): Array<{ type: "thinking" | "text"; content: string }> {
  const result: Array<{ type: "thinking" | "text"; content: string }> = [];
  let remaining = text;
  while (remaining.length > 0) {
    const openIdx = remaining.indexOf("<think>");
    if (openIdx === -1) {
      if (remaining.trim()) result.push({ type: "text", content: remaining });
      break;
    }
    const before = remaining.slice(0, openIdx);
    if (before.trim()) result.push({ type: "text", content: before });
    remaining = remaining.slice(openIdx + "<think>".length);
    const closeIdx = remaining.indexOf("</think>");
    if (closeIdx === -1) {
      if (remaining.trim()) result.push({ type: "thinking", content: remaining });
      break;
    }
    result.push({ type: "thinking", content: remaining.slice(0, closeIdx) });
    remaining = remaining.slice(closeIdx + "</think>".length);
  }
  return result;
}

function TextSegment({ content }: { content: string }) {
  if (!content) return null;
  return (
    <div className="my-0.5">
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
        {content}
      </Markdown>
    </div>
  );
}

function MixedContent({ content }: { content: string }) {
  if (content.includes("<think>")) {
    const parts = parseThinkTags(content);
    return (
      <>
        {parts.map((part, i) =>
          part.type === "thinking" ? (
            <ThinkingSegment key={i} content={part.content} isActive={false} defaultOpen={false} />
          ) : (
            <TextSegment key={i} content={part.content} />
          )
        )}
      </>
    );
  }
  return <TextSegment content={content} />;
}

function AssistantMessage({ msg, isLast, isStreaming: streaming }: { msg: ChatMessage; isLast: boolean; isStreaming: boolean }) {
  const segments = msg.segments;
  const isActiveMsg = isLast && streaming;

  if (segments && segments.length > 0) {
    return (
      <div
        className="px-3 py-2 text-xs text-fg-2 border border-border-subtle bg-gradient-to-b from-zinc-800 to-zinc-850 max-w-[92%]"
        style={{ borderRadius: "12px 12px 12px 3px" }}
      >
        {segments.map((seg: MessageSegment, i: number) => {
          const isLastSegment = i === segments.length - 1;
          if (seg.type === "thinking") {
            const isActiveThinking = isActiveMsg && isLastSegment;
            return <ThinkingSegment key={i} content={seg.content || ""} isActive={isActiveThinking} defaultOpen={isActiveThinking} />;
          }
          if (seg.type === "text") {
            if (seg.content?.includes("<think>")) return <MixedContent key={i} content={seg.content} />;
            return <TextSegment key={i} content={seg.content || ""} />;
          }
          if (seg.type === "tool_call" && seg.toolCall) {
            return <ToolCallSegment key={i} toolCall={seg.toolCall} />;
          }
          return null;
        })}
      </div>
    );
  }

  return (
    <div className="rounded-lg px-3 py-2 text-xs bg-zinc-800 text-zinc-200">
      {msg.thinking && <ThinkingSegment content={msg.thinking} isActive={isActiveMsg && !msg.content} defaultOpen={false} />}
      {msg.content && <MixedContent content={msg.content} />}
      {msg.toolCalls && msg.toolCalls.length > 0 && (
        <div className="mt-1 space-y-1">
          {msg.toolCalls.map((tc) => <ToolCallSegment key={tc.id} toolCall={tc} />)}
        </div>
      )}
    </div>
  );
}

/**
 * Compact context-usage strip: progress bar + manual "Summarize" button.
 * Renders below the chat header once the backend has reported tokens used
 * (happens on the first assistant turn). Colors shift to amber at 60%, red
 * at 80% — the same thresholds the server uses to auto-summarize.
 */
function ContextUsageBar() {
  const contextStatus = useStore((s) => s.contextStatus);
  const isSummarizing = useStore((s) => s.isSummarizing);
  const isStreaming = useStore((s) => s.isStreaming);
  const summarizeChat = useStore((s) => s.summarizeChat);
  const messages = useStore((s) => s.messages);

  // Hide entirely only when the chat is empty. The bar needs to be visible
  // after reload too — contextStatus is only populated after a live chat
  // turn, so we render the Summarize button without a progress fill until
  // the server reports back.
  if (messages.length === 0) return null;

  const hasLiveStatus = !!contextStatus;
  const pct = hasLiveStatus
    ? Math.min((contextStatus!.used / contextStatus!.total) * 100, 100)
    : 0;
  const barColor = pct >= 80 ? "bg-red-500" : pct >= 60 ? "bg-amber-500" : "bg-blue-500";
  const textColor = pct >= 80 ? "text-red-400" : pct >= 60 ? "text-amber-400" : "text-zinc-500";

  return (
    <div className="px-3 py-1.5 border-b border-zinc-800/50 flex items-center gap-2 shrink-0">
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
          {hasLiveStatus && (
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <span className={`text-[10px] tabular-nums shrink-0 ${textColor}`}>
          {hasLiveStatus ? `${Math.round(pct)}%` : "—"}
        </span>
      </div>
      <button
        onClick={summarizeChat}
        disabled={isSummarizing || isStreaming || messages.length < 3}
        className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        title={
          messages.length < 3
            ? "Send a few messages before you can summarize"
            : "Summarize conversation to free up context"
        }
      >
        {isSummarizing ? "Summarizing..." : "Summarize"}
      </button>
    </div>
  );
}

export function ChatPane() {
  const messages = useStore((s) => s.messages);
  const isStreaming = useStore((s) => s.isStreaming);
  const isSummarizing = useStore((s) => s.isSummarizing);
  const sendChatMessage = useStore((s) => s.sendChatMessage);
  const stopStreaming = useStore((s) => s.stopStreaming);
  const clearMessages = useStore((s) => s.clearMessages);
  const retryLastMessage = useStore((s) => s.retryLastMessage);
  const project = useStore((s) => s.project);
  const activeStyleguide = useStore((s) => s.activeStyleguide);
  const projectStyleguides = useStore((s) => s.projectStyleguides);
  const activePlan = useStore((s) => s.activePlan);
  const dismissPlan = useStore((s) => s.cancelActivePlan);
  const selectedImageId = useStore((s) => s.selectedImageId);
  const chatScope = useStore((s) => s.chatScope);
  const setChatScope = useStore((s) => s.setChatScope);
  const selectedImage = useStore((s) => s.images.find((i) => i.id === s.selectedImageId));
  const [input, setInput] = useState("");
  const workflows = useStore((s) => s.workflows);
  const loadingWorkflows = useStore((s) => s.loadingWorkflows);
  const loadWorkflows = useStore((s) => s.loadWorkflows);
  const toggleWorkflow = useStore((s) => s.toggleWorkflow);
  const [planningMode, setPlanningMode] = useState(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const lastMsg = messages[messages.length - 1];
  const showRetry = !isStreaming && messages.length > 0 && lastMsg &&
    (lastMsg.content.startsWith("Error:") || lastMsg.role === "user");

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isStreaming, isSummarizing]);

  useEffect(() => {
    loadWorkflows();
  }, [loadWorkflows]);

  // Auto-switch out of planning mode once a plan is created
  useEffect(() => {
    if (activePlan && planningMode) setPlanningMode(false);
  }, [activePlan, planningMode]);

  const handleToggleWorkflow = useCallback(async (id: string, enabled: boolean) => {
    await toggleWorkflow(id, enabled);
  }, [toggleWorkflow]);

  const handleFiles = useCallback(async (files: File[]) => {
    setUploading(true);
    try {
      for (const file of files) {
        const result = await api.upload(file, project?.id);
        const type = file.type || (file.name.match(/\.(png|jpg|jpeg|gif|webp|svg)$/i) ? "image/" + file.name.split(".").pop() : "application/octet-stream");
        setAttachments((prev) => [...prev, { url: result.url, name: file.name, type }]);

        // Kick off the vision describe immediately so the chat request can
        // pick the cached result up instead of blocking on it. Fire-and-forget
        // — chatHelpers falls back to inline describe if this hasn't completed.
        if (type.startsWith("image/")) {
          const storedFilename = result.url.replace(/^\/api\/uploads\//, "");
          api.describeImage(storedFilename, file.name)
            .then(() => {
              // The describe writes to assets.description on the server; reload
              // so the asset browser picks up the new text without a manual refresh.
              if (project) useStore.getState().loadAssets();
            })
            .catch((err) => {
              console.warn("Image describe pre-fetch failed:", err);
            });
        }
      }
      // Refresh asset browser
      if (project) useStore.getState().loadAssets();
    } catch (err) {
      console.error("Upload failed:", err);
    } finally {
      setUploading(false);
    }
  }, [project]);

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || isStreaming) return;
    let content = input.trim() || "(attached files)";
    // In planning mode, instruct the AI to create a plan instead of executing directly
    if (planningMode && !activePlan) {
      content = `[PLAN MODE] Create a detailed step-by-step plan for this task. Do NOT execute yet — just present the plan for my review.\n\n${content}`;
    }
    sendChatMessage(content, attachments.length > 0 ? attachments : undefined);
    setInput("");
    setAttachments([]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) handleFiles(files);
  }, [handleFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      handleFiles(files);
    }
  }, [handleFiles]);

  if (!project && !activeStyleguide) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm p-4 text-center">
        Select a storyboard or styleguide to start chatting with the AI
      </div>
    );
  }

  // Mode: styleguide > project.
  const inStyleguideMode = !!activeStyleguide;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-11 flex items-center justify-between px-3 border-b border-border-subtle shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="relative w-[22px] h-[22px] rounded-[5px] shrink-0 flex items-center justify-center"
            style={{ background: "var(--brand-gradient)" }}
            aria-hidden="true"
          >
            <div className="absolute inset-[2px] rounded-[3px] bg-white/5 border border-white/10" />
            <Icon name="sparkle" size={11} className="relative text-white" />
          </div>
          <span className="text-[12px] font-medium text-fg-2 shrink-0">
            {inStyleguideMode ? "Styleguide Chat" : "AI Storyboard"}
          </span>
          <span
            className="text-[9.5px] px-1.5 py-0.5 rounded-sm bg-bg-elevated border border-border-subtle text-fg-muted shrink-0"
            style={{ fontFamily: "var(--font-mono)" }}
            title={
              inStyleguideMode && activeStyleguide
                ? activeStyleguide.name
                : "claude-sonnet-4"
            }
          >
            {inStyleguideMode && activeStyleguide
              ? activeStyleguide.name.length > 18
                ? activeStyleguide.name.slice(0, 18) + "…"
                : activeStyleguide.name
              : "claude-sonnet-4"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {!inStyleguideMode && (
            <WorkflowCheckboxDropdown
              workflows={workflows}
              loading={loadingWorkflows}
              onToggle={handleToggleWorkflow}
              buttonClassName="flex items-center gap-1.5 rounded-[5px] bg-bg-input px-2 py-1 text-[10px] text-fg-3 hover:bg-zinc-700"
            />
          )}
          <Button variant="ghost" size="xs" onClick={clearMessages}>
            Clear
          </Button>
        </div>
      </div>

      {/* Chat scope toggle — only when a frame is open. "Project" keeps the
          shared session conversation (the selected frame is still sent as
          context); "This frame" is a separate side conversation scoped to it. */}
      {!inStyleguideMode && selectedImageId && (
        <div className="px-3 py-1.5 border-b border-zinc-800 shrink-0 flex items-center gap-1.5">
          <div className="flex rounded-[5px] bg-bg-input p-0.5 text-[10px]">
            <button
              type="button"
              onClick={() => setChatScope("project")}
              className={`px-2 py-0.5 rounded-[3px] transition-colors ${chatScope === "project" ? "bg-zinc-700 text-fg-1" : "text-fg-muted hover:text-fg-2"}`}
            >
              Project
            </button>
            <button
              type="button"
              onClick={() => setChatScope("image")}
              className={`px-2 py-0.5 rounded-[3px] transition-colors ${chatScope === "image" ? "bg-zinc-700 text-fg-1" : "text-fg-muted hover:text-fg-2"}`}
            >
              This frame
            </button>
          </div>
          <span className="text-[10px] text-fg-muted truncate min-w-0">
            {chatScope === "image"
              ? `Scoped to ${selectedImage?.name || "this frame"}`
              : "Frame sent as context"}
          </span>
        </div>
      )}

      {/* Attached-styleguides chip row (project mode only) */}
      {!inStyleguideMode && chatScope === "project" && projectStyleguides.length > 0 && (
        <div className="px-3 py-1 border-b border-zinc-800 shrink-0 flex flex-wrap items-center gap-1">
          <span className="text-[10px] text-zinc-500">Styleguides in context:</span>
          {projectStyleguides.map((sg) => (
            <span key={sg.id} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-900/30 text-blue-300">
              {sg.name}
            </span>
          ))}
        </div>
      )}

      {/* Context usage + manual summarize (project chat only — no auto-summarization in scoped chats) */}
      {!inStyleguideMode && chatScope === "project" && <ContextUsageBar />}

      {/* Active Plan (project mode only — no plans in scoped chats) */}
      {!inStyleguideMode && chatScope === "project" && activePlan && activePlan.status !== "completed" && activePlan.status !== "cancelled" && (
        <div className="px-3 pt-2 shrink-0">
          <PlanChecklist
            plan={activePlan}
            onApprove={() => sendChatMessage("Looks good — go ahead and execute the plan.")}
            onCancel={() => sendChatMessage("Cancel the plan.")}
            onDismiss={dismissPlan}
          />
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-zinc-600 text-xs text-center mt-8">
            <p className="mb-2">AI storyboard assistant</p>
            <p className="text-[10px]">Describe the frames you want, then ask me to design and generate them</p>
          </div>
        )}
        {messages.map((msg, msgIndex) => (
          <div
            key={msg.id}
            className={`flex ${
              msg.role === "system" ? "justify-center" : msg.role === "user" ? "justify-end" : "justify-start"
            }`}
          >
            {msg.role === "system" ? (
              <div className="max-w-[90%] rounded-lg px-3 py-2 text-[10px] bg-amber-900/30 border border-amber-800/50 text-amber-200">
                <div className="font-semibold mb-1 text-amber-300">Conversation summarized</div>
                <Markdown remarkPlugins={[remarkGfm]} components={{
                  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-1 last:mb-0">{children}</p>,
                  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc ml-4 mb-1">{children}</ul>,
                  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-0.5">{children}</li>,
                } as never}>
                  {msg.content}
                </Markdown>
              </div>
            ) : msg.role === "assistant" ? (
              <AssistantMessage msg={msg} isLast={msgIndex === messages.length - 1} isStreaming={isStreaming} />
            ) : (
              <div
                className="max-w-[85%] px-3 py-2 text-xs text-blue-100 border border-blue-500/20 bg-gradient-to-b from-blue-500/[0.18] to-blue-600/[0.22]"
                style={{ borderRadius: "12px 12px 3px 12px" }}
              >
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {msg.attachments.map((att: ChatAttachment, i: number) =>
                      att.type.startsWith("image/") ? (
                        <img key={i} src={att.url} alt={att.name} className="max-w-[140px] max-h-[100px] rounded border border-blue-800/50 object-cover" />
                      ) : (
                        <div key={i} className="flex items-center gap-1 bg-blue-900/40 border border-blue-800/40 rounded px-1.5 py-0.5">
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-300 shrink-0">
                            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          <span className="text-[10px] text-blue-300 max-w-[80px] truncate">{att.name}</span>
                        </div>
                      )
                    )}
                  </div>
                )}
                {msg.content && msg.content !== "(attached files)" && (
                  <Markdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
                    {msg.content}
                  </Markdown>
                )}
              </div>
            )}
          </div>
        ))}
        {isSummarizing && (
          <div className="flex justify-center">
            <div className="rounded-lg px-3 py-2 text-[10px] bg-amber-900/30 border border-amber-800/50 text-amber-200 flex items-center gap-2">
              Summarizing conversation...
            </div>
          </div>
        )}
        {isStreaming && !isSummarizing && lastMsg?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-400">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
              </span>
            </div>
          </div>
        )}
        {showRetry && (
          <div className="flex justify-start">
            <button
              onClick={retryLastMessage}
              className="text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 rounded px-2 py-1"
            >
              Retry
            </button>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div
        className="p-3 border-t border-zinc-800 shrink-0"
        onDrop={handleDrop}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      >
        {/* Attachment previews */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((att, i) =>
              att.type.startsWith("image/") ? (
                <div key={i} className="relative group">
                  <img src={att.url} alt={att.name} className="w-14 h-14 rounded border border-zinc-700 object-cover" />
                  <button
                    onClick={() => removeAttachment(i)}
                    className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-zinc-700 text-zinc-300 text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100"
                  >x</button>
                </div>
              ) : (
                <div key={i} className="flex items-center gap-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 group">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-400 shrink-0">
                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="text-[10px] text-zinc-400 max-w-[80px] truncate">{att.name}</span>
                  <button onClick={() => removeAttachment(i)} className="text-[10px] text-zinc-500 hover:text-zinc-300 ml-0.5">x</button>
                </div>
              )
            )}
            {uploading && <span className="text-[10px] text-zinc-500 self-center">Uploading...</span>}
          </div>
        )}

        {/* Mode indicator + status bar */}
        <div className="flex items-center gap-2 mb-2">
          {/* Mode toggle */}
          <div className="flex bg-zinc-800 rounded border border-zinc-700 p-0.5">
            <button
              onClick={() => setPlanningMode(false)}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors ${!planningMode ? "bg-zinc-700 text-zinc-200 font-medium" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              Chat
            </button>
            <button
              onClick={() => setPlanningMode(true)}
              className={`text-[10px] px-2 py-0.5 rounded transition-colors flex items-center gap-1 ${planningMode ? "bg-amber-800/60 text-amber-200 font-medium" : "text-zinc-500 hover:text-zinc-300"}`}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="shrink-0">
                <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
                <rect x="9" y="2" width="6" height="4" rx="1" />
                <path d="M9 14l2 2 4-4" />
              </svg>
              Plan
            </button>
          </div>

          {/* Active status */}
          {activePlan && activePlan.status === "executing" && (
            <div className="flex items-center gap-1.5 text-[10px] text-blue-400">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" className="animate-spin shrink-0">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="31.4 31.4" strokeLinecap="round" />
              </svg>
              Executing plan ({activePlan.steps.filter(s => s.status === "completed").length}/{activePlan.steps.length})
            </div>
          )}
          {activePlan && activePlan.status === "draft" && (
            <span className="text-[10px] text-amber-400">Plan awaiting approval</span>
          )}

          <span className="flex-1" />
          <span className="text-[9px] text-zinc-600">Shift+Tab to toggle mode</span>
        </div>

        <div className="flex gap-1.5">
          <IconButton
            icon="attach"
            tooltip="Attach file"
            size="md"
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 border-border-subtle bg-bg-input"
          />
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files) handleFiles(Array.from(e.target.files));
              e.target.value = "";
            }}
          />
          <AutoTextarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              // Shift+Tab toggles planning mode
              if (e.key === "Tab" && e.shiftKey) {
                e.preventDefault();
                setPlanningMode((prev) => !prev);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onPaste={handlePaste}
            placeholder={planningMode ? "Describe what you want to build..." : "Ask the AI editor..."}
            rows={1}
            maxHeight={200}
            className={`flex-1 text-zinc-200 text-xs px-3 py-2 rounded border focus:outline-none ${
              planningMode
                ? "bg-amber-950/20 border-amber-800/50 focus:border-amber-600 placeholder-amber-700/60"
                : "bg-zinc-800 border-zinc-700 focus:border-blue-500"
            }`}
          />
        </div>
        <div className="flex justify-end mt-2 gap-2">
          {isStreaming ? (
            <Button variant="destructive" size="sm" icon="stop" onClick={stopStreaming}>
              Stop
            </Button>
          ) : (
            <Button
              variant={planningMode ? "plan" : "primary"}
              size="sm"
              iconRight="send"
              kbd="↵"
              onClick={handleSend}
              disabled={!input.trim() && attachments.length === 0}
            >
              {planningMode ? "Create Plan" : "Send"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
