import type { StateCreator } from "zustand";
import { api } from "../api/client";
import type { ChatMessage, ChatAttachment, Plan } from "../types";
import {
  sendChatMessage as runSend,
  stopStreaming as runStop,
  retryLastMessage as runRetry,
  onConversationFocused,
  detachFocusedStream as runDetach,
} from "../lib/agentRunClient";
import type { AppState } from "./index";

export type ChatScope = "project" | "image";

export interface ChatSlice {
  messages: ChatMessage[];
  isStreaming: boolean;
  isSummarizing: boolean;
  messagesLoaded: boolean;
  contextStatus: { used: number; total: number } | null;
  activePlan: Plan | null;
  // "project" = the shared session conversation; "image" = a side conversation
  // scoped to the currently selected frame (its own persisted history).
  chatScope: ChatScope;
  setChatScope: (scope: ChatScope) => Promise<void>;
  loadMessages: () => Promise<void>;
  // Detach the focused run stream and attach/replay the run for whatever
  // conversation is now in view (called after a frame/scope/project switch).
  focusConversation: () => Promise<void>;
  // Stop rendering the current run's events — call BEFORE loadMessages on a switch.
  detachFocusedStream: () => void;
  sendChatMessage: (content: string, attachments?: ChatAttachment[]) => Promise<void>;
  stopStreaming: () => void;
  clearMessages: () => Promise<void>;
  summarizeChat: () => Promise<void>;
  retryLastMessage: () => void;
  loadActivePlan: () => Promise<void>;
  cancelActivePlan: () => Promise<void>;
}

export const createChatSlice: StateCreator<AppState, [], [], ChatSlice> = (set, get) => ({
  messages: [],
  isStreaming: false,
  isSummarizing: false,
  messagesLoaded: false,
  contextStatus: null,
  activePlan: null,
  chatScope: "project",

  setChatScope: async (scope) => {
    if (get().chatScope === scope) return;
    // Detach BEFORE loading so the old conversation's run can't write into the
    // new conversation's messages while it loads.
    get().detachFocusedStream();
    set({ chatScope: scope, contextStatus: null });
    await get().loadMessages();
    await get().focusConversation();
  },

  focusConversation: () => onConversationFocused(),
  detachFocusedStream: () => runDetach(),

  loadMessages: async () => {
    // Mode precedence: styleguide > image-scoped side chat > project.
    const styleguideId = get().activeStyleguideId;
    const imageId = get().chatScope === "image" ? get().selectedImageId : null;
    const project = get().project;
    const fetcher = styleguideId
      ? () => api.listStyleguideMessages(styleguideId)
      : imageId
        ? () => api.listImageMessages(imageId)
        : project
          ? () => api.listMessages(project.id)
          : null;
    if (!fetcher) { set({ messages: [], messagesLoaded: true }); return; }
    try {
      const rows = await fetcher();
      const messages: ChatMessage[] = rows.map((r) => ({
        id: r.id, role: r.role, content: r.content,
        thinking: r.thinking || undefined,
        segments: typeof r.segments === "string" ? JSON.parse(r.segments) : r.segments,
        toolCalls: typeof r.toolCalls === "string" ? JSON.parse(r.toolCalls) : r.toolCalls,
        timestamp: r.createdAt,
      }));
      set({ messages, messagesLoaded: true });
    } catch { set({ messagesLoaded: true }); }
  },

  // Every scope (project, image, styleguide) runs through the decoupled
  // background-run client; the server selects the right tools/prompt by scope.
  sendChatMessage: (content, attachments) => runSend(content, attachments),
  stopStreaming: () => runStop(),
  retryLastMessage: () => runRetry(),

  clearMessages: async () => {
    const styleguideId = get().activeStyleguideId;
    const imageId = get().chatScope === "image" ? get().selectedImageId : null;
    const p = get().project;
    if (styleguideId) {
      api.clearStyleguideMessages(styleguideId).catch((e) => console.error("[store] clear styleguide messages failed", e));
    } else if (imageId) {
      api.clearImageMessages(imageId).catch((e) => console.error("[store] clear image messages failed", e));
      set({ messages: [], messagesLoaded: true, contextStatus: null });
      return;
    } else if (p) {
      api.clearMessages(p.id).catch((e) => console.error("[store] clear messages failed", e));
      if (get().activePlan) {
        api.cancelActivePlan(p.id).catch((e) => console.error("[store] cancel plan failed", e));
      }
    }
    set({ messages: [], messagesLoaded: true, contextStatus: null, activePlan: null });
  },

  summarizeChat: async () => {
    const pid = get().project?.id;
    if (!pid || get().isSummarizing || get().isStreaming) return;
    set({ isSummarizing: true });
    try {
      const { summary, messageId } = await api.summarizeMessages(pid);
      set({ messages: [{ id: messageId, role: "system", content: summary, timestamp: new Date().toISOString() }] });
    } finally { set({ isSummarizing: false }); }
  },

  loadActivePlan: async () => {
    const project = get().project;
    if (!project) { set({ activePlan: null }); return; }
    try {
      const plan = await api.getActivePlan(project.id);
      set({ activePlan: plan });
    } catch {
      set({ activePlan: null });
    }
  },

  cancelActivePlan: async () => {
    const project = get().project;
    if (!project) return;
    api.cancelActivePlan(project.id).catch((e) => console.error("[store] cancel plan failed", e));
    set({ activePlan: null });
  },
});
