import type { StateCreator } from "zustand";
import { api } from "../api/client";
import type { AppState } from "./index";
import type { ConversationKey } from "../lib/conversationKey";

/**
 * Lightweight, app-wide view of which conversations have an agent run in
 * flight. This is independent of which conversation is currently on screen, so
 * it drives status badges on background frames and other projects too. The
 * full event stream is only attached to the focused conversation (see
 * agentRunClient); everything else is tracked here via a periodic poll of
 * GET /runs/active.
 */
export interface ActiveRun {
  runId: string;
  status: "running" | "complete" | "error" | "cancelled" | "interrupted";
  projectId: string | null;
  scope: "project" | "image" | "styleguide";
  conversationId: string;
}

export interface RunsSlice {
  activeRuns: Record<ConversationKey, ActiveRun>;
  // The run whose full event stream is currently being rendered into messages[].
  focusedRunId: string | null;
  focusedConvKey: ConversationKey | null;

  refreshActiveRuns: () => Promise<void>;
  setActiveRun: (key: ConversationKey, run: ActiveRun) => void;
  clearActiveRun: (key: ConversationKey) => void;
  startRunStatusPolling: () => void;
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export const createRunsSlice: StateCreator<AppState, [], [], RunsSlice> = (set, get) => ({
  activeRuns: {},
  focusedRunId: null,
  focusedConvKey: null,

  refreshActiveRuns: async () => {
    try {
      const { runs } = await api.listActiveRuns();
      const map: Record<ConversationKey, ActiveRun> = {};
      for (const r of runs) {
        map[r.key] = { runId: r.runId, status: r.status, projectId: r.projectId, scope: r.scope, conversationId: r.conversationId };
      }
      // Preserve the focused conversation's optimistic entry: a run we just
      // started may not be in the poll snapshot yet.
      const focusedKey = get().focusedConvKey;
      if (focusedKey && get().activeRuns[focusedKey] && !map[focusedKey] && get().isStreaming) {
        map[focusedKey] = get().activeRuns[focusedKey];
      }
      set({ activeRuns: map });
    } catch {
      /* transient — keep the last snapshot */
    }
  },

  setActiveRun: (key, run) => set({ activeRuns: { ...get().activeRuns, [key]: run } }),

  clearActiveRun: (key) => {
    const next = { ...get().activeRuns };
    delete next[key];
    set({ activeRuns: next });
  },

  startRunStatusPolling: () => {
    if (pollTimer) return;
    void get().refreshActiveRuns();
    pollTimer = setInterval(() => { void get().refreshActiveRuns(); }, 2000);
  },
});
