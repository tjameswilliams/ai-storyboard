import type {
  Project,
  Folder,
  StoryboardImage,
  Layout,
  ChatMessage,
  HistoryState,
  UndoRedoResult,
  Plan,
  ComfyWorkflowSummary,
  Asset,
  AssetProvenance,
  Styleguide,
  StyleguideAnimation,
  StyleguideBrandAsset,
  AttachedStyleguideSummary,
  RunSummary,
} from "../types";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    // Try to surface the server's { error } message when present.
    let message = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.error === "string") message = parsed.error;
    } catch {
      /* not JSON — use raw text */
    }
    throw new Error(message || `API error ${res.status}`);
  }
  return res.json();
}

export const api = {
  // Folders
  listFolders: () => request<Folder[]>("/folders"),
  createFolder: (data: { name: string; parentId?: string }) =>
    request<Folder>("/folders", { method: "POST", body: JSON.stringify(data) }),
  updateFolder: (id: string, data: Record<string, unknown>) =>
    request<Folder>(`/folders/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteFolder: (id: string) =>
    request<{ success: boolean }>(`/folders/${id}`, { method: "DELETE" }),

  // Projects
  listProjects: () => request<Project[]>("/projects"),
  getProject: (id: string) => request<Project>(`/projects/${id}`),
  createProject: (data: {
    name: string;
    description?: string;
    aspectRatio?: string;
    megapixels?: number;
    workflowId?: string;
    promptFormat?: string;
  }) => request<Project>("/projects", { method: "POST", body: JSON.stringify(data) }),
  updateProject: (id: string, data: Record<string, unknown>) =>
    request<Project>(`/projects/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteProject: (id: string) =>
    request<{ success: boolean }>(`/projects/${id}`, { method: "DELETE" }),
  cloneProject: (id: string, newName?: string) =>
    request<{ success: boolean; project: Project; counts: Record<string, number> }>(
      `/projects/${id}/clone`,
      { method: "POST", body: JSON.stringify({ newName }) },
    ),
  getProjectToolsets: (projectId: string) =>
    request<{
      buckets: Array<{ id: string; label: string; description: string; alwaysOn: boolean; toolCount: number; enabled: boolean }>;
      alwaysOnIds: string[];
    }>(`/projects/${projectId}/toolsets`),
  setProjectToolsets: (projectId: string, disabledBucketIds: string[]) =>
    request<{ success: boolean; disabledBucketIds: string[] }>(
      `/projects/${projectId}/toolsets`,
      { method: "PUT", body: JSON.stringify({ disabledBucketIds }) },
    ),

  // Images (the storyboard frames)
  listImages: (projectId: string) =>
    request<StoryboardImage[]>(`/projects/${projectId}/images`),
  getImage: (id: string) => request<StoryboardImage>(`/images/${id}`),
  createImage: (projectId: string, data: { afterImageId?: string; name?: string; layout?: Layout }) =>
    request<StoryboardImage>(`/projects/${projectId}/images`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateImage: (
    id: string,
    data: { name?: string; layout?: Layout; plainPrompt?: string; negativePrompt?: string },
  ) => request<StoryboardImage>(`/images/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  deleteImage: (id: string) =>
    request<{ success: boolean }>(`/images/${id}`, { method: "DELETE" }),
  reorderImages: (projectId: string, imageIds: string[]) =>
    request<StoryboardImage[]>(`/projects/${projectId}/images/reorder`, {
      method: "PUT",
      body: JSON.stringify({ imageIds }),
    }),
  generateImage: (id: string, data?: { seed?: number; workflowId?: string }) =>
    request<StoryboardImage>(`/images/${id}/generate`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  regenerateImage: (id: string, data?: { seed?: number; workflowId?: string }) =>
    request<StoryboardImage>(`/images/${id}/regenerate`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),

  // Messages
  listMessages: (projectId: string) => request<ChatMessage[]>(`/projects/${projectId}/messages`),
  clearMessages: (projectId: string) =>
    request<{ success: boolean }>(`/projects/${projectId}/messages`, { method: "DELETE" }),
  // Image-scoped chat (a side conversation focused on one frame)
  listImageMessages: (imageId: string) => request<ChatMessage[]>(`/images/${imageId}/messages`),
  clearImageMessages: (imageId: string) =>
    request<{ success: boolean }>(`/images/${imageId}/messages`, { method: "DELETE" }),
  summarizeMessages: (projectId: string) =>
    request<{ summary: string; messageId: string }>("/chat/summarize", {
      method: "POST", body: JSON.stringify({ projectId }),
    }),

  // Agent runs — start a detached background run, subscribe to its event
  // stream, list active runs (for status badges), and cancel.
  startChatRun: (body: Record<string, unknown>) =>
    request<{ runId: string; assistantMsgId: string }>("/chat", {
      method: "POST", body: JSON.stringify(body),
    }),
  /** Raw SSE Response for a run; caller drives the reader. */
  openRunStream: (runId: string, cursor: number, signal?: AbortSignal) =>
    fetch(`/api/runs/${runId}/stream?cursor=${cursor}`, { signal }),
  listActiveRuns: (projectId?: string) =>
    request<{ runs: RunSummary[] }>(`/runs/active${projectId ? `?projectId=${projectId}` : ""}`),
  cancelRun: (runId: string) =>
    request<{ ok: boolean }>(`/runs/${runId}/cancel`, { method: "POST" }),

  // File uploads
  upload: async (file: File, projectId?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    if (projectId) formData.append("projectId", projectId);
    const res = await fetch("/api/uploads", { method: "POST", body: formData });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json() as Promise<{ url: string; name: string }>;
  },

  describeImage: async (storedFilename: string, displayName?: string) => {
    const res = await fetch(`/api/uploads/${storedFilename}/describe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: displayName }),
    });
    if (!res.ok) throw new Error(`Describe failed: ${res.status}`);
    return res.json() as Promise<{ description: string }>;
  },

  // Settings
  getSettings: () => request<Record<string, string>>("/settings"),
  updateSettings: (data: Record<string, string>) =>
    request<Record<string, string>>("/settings", { method: "PUT", body: JSON.stringify(data) }),

  // ComfyUI workflows
  listComfyWorkflows: () => request<ComfyWorkflowSummary[]>("/plugins/comfyui/workflows"),
  updateComfyWorkflow: (id: string, data: Record<string, unknown>) =>
    request<ComfyWorkflowSummary>(`/plugins/comfyui/workflows/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Undo/Redo
  undo: (projectId: string) => request<UndoRedoResult>(`/projects/${projectId}/undo`, { method: "POST" }),
  redo: (projectId: string) => request<UndoRedoResult>(`/projects/${projectId}/redo`, { method: "POST" }),
  getHistory: (projectId: string) => request<HistoryState>(`/projects/${projectId}/history`),

  // Plans
  getActivePlan: (projectId: string) => request<Plan | null>(`/projects/${projectId}/plan`),
  cancelActivePlan: (projectId: string) => request<{ success: boolean }>(`/projects/${projectId}/plan`, { method: "DELETE" }),

  // Assets
  listAssets: (projectId: string, opts?: { type?: string; limit?: number; offset?: number }) => {
    const params = new URLSearchParams({ projectId });
    if (opts?.type) params.set("type", opts.type);
    if (opts?.limit) params.set("limit", String(opts.limit));
    if (opts?.offset) params.set("offset", String(opts.offset));
    return request<Asset[]>(`/assets?${params}`);
  },
  getAsset: (id: string) => request<Asset>(`/assets/${id}`),
  searchAssets: (projectId: string, q: string, type?: string) => {
    const params = new URLSearchParams({ projectId, q });
    if (type) params.set("type", type);
    return request<Asset[]>(`/assets/search?${params}`);
  },
  updateAsset: (id: string, data: { tags?: string[]; favorite?: boolean; fileName?: string; description?: string }) =>
    request<Asset>(`/assets/${id}`, { method: "PUT", body: JSON.stringify(data) }),
  regenerateAssetDescription: (id: string, prompt?: string) =>
    request<Asset>(`/assets/${id}/describe`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    }),
  deleteAsset: (id: string, deleteFile?: boolean) =>
    request<{ success: boolean }>(`/assets/${id}${deleteFile ? "?deleteFile=true" : ""}`, { method: "DELETE" }),

  getAssetProvenance: (
    projectId: string,
    target: { clipId?: string; overlayId?: string },
  ) => {
    const params = new URLSearchParams({ projectId });
    if (target.clipId) params.set("clipId", target.clipId);
    if (target.overlayId) params.set("overlayId", target.overlayId);
    return request<{ provenance: AssetProvenance | null }>(`/assets/provenance?${params}`);
  },
  regenerateAsset: (
    assetId: string,
    data: {
      projectId: string;
      prompt?: string;
      negativePrompt?: string;
      seed?: number;
      workflowId?: string;
      params?: Record<string, unknown>;
    },
  ) =>
    request<{ success: boolean; asset: Asset }>(`/assets/${assetId}/regenerate`, {
      method: "POST", body: JSON.stringify(data),
    }),

  // Media file URL
  mediaUrl: (filePath: string) => `/api/uploads/${filePath}`,

  // Export (file downloads)
  exportZipUrl: (projectId: string) => `/api/projects/${projectId}/export/zip`,
  exportPdfUrl: (projectId: string, columns: number, captions: boolean) =>
    `/api/projects/${projectId}/export/pdf?columns=${columns}&captions=${captions ? 1 : 0}`,

  // Styleguides
  listStyleguides: () => request<Styleguide[]>("/styleguides"),
  getStyleguide: (id: string) => request<Styleguide>(`/styleguides/${id}`),
  createStyleguide: (data: { name?: string; description?: string; markdown?: string }) =>
    request<Styleguide>("/styleguides", { method: "POST", body: JSON.stringify(data) }),
  updateStyleguide: (id: string, data: { name?: string; description?: string; markdown?: string }) =>
    request<Styleguide>(`/styleguides/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteStyleguide: (id: string) =>
    request<{ success: boolean }>(`/styleguides/${id}`, { method: "DELETE" }),

  // Styleguide brand assets
  uploadStyleguideAsset: async (styleguideId: string, file: File, role: string, label?: string) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("role", role);
    if (label) formData.append("label", label);
    const res = await fetch(`/api/styleguides/${styleguideId}/assets`, { method: "POST", body: formData });
    if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
    return res.json() as Promise<StyleguideBrandAsset>;
  },
  updateStyleguideAsset: (styleguideId: string, assetId: string, data: { role?: string; label?: string; order?: number }) =>
    request<StyleguideBrandAsset>(`/styleguides/${styleguideId}/assets/${assetId}`, {
      method: "PATCH", body: JSON.stringify(data),
    }),
  deleteStyleguideAsset: (styleguideId: string, assetId: string) =>
    request<{ success: boolean }>(`/styleguides/${styleguideId}/assets/${assetId}`, { method: "DELETE" }),

  // Styleguide animations (legacy; kept for store compatibility)
  listStyleguideAnimations: (styleguideId: string) =>
    request<StyleguideAnimation[]>(`/styleguides/${styleguideId}/animations`),
  updateStyleguideAnimation: (styleguideId: string, animId: string, data: Record<string, unknown>) =>
    request<StyleguideAnimation>(`/styleguides/${styleguideId}/animations/${animId}`, {
      method: "PATCH", body: JSON.stringify(data),
    }),
  deleteStyleguideAnimation: (styleguideId: string, animId: string) =>
    request<{ success: boolean }>(`/styleguides/${styleguideId}/animations/${animId}`, { method: "DELETE" }),

  // Styleguide chat messages
  listStyleguideMessages: (styleguideId: string) =>
    request<ChatMessage[]>(`/styleguides/${styleguideId}/messages`),
  clearStyleguideMessages: (styleguideId: string) =>
    request<{ success: boolean }>(`/styleguides/${styleguideId}/messages`, { method: "DELETE" }),

  // Project ↔ styleguide attachment
  listProjectStyleguides: (projectId: string) =>
    request<AttachedStyleguideSummary[]>(`/projects/${projectId}/styleguides`),
  attachStyleguide: (projectId: string, styleguideId: string) =>
    request<{ success: boolean }>(`/projects/${projectId}/styleguides`, {
      method: "POST", body: JSON.stringify({ styleguideId }),
    }),
  detachStyleguide: (projectId: string, styleguideId: string) =>
    request<{ success: boolean }>(`/projects/${projectId}/styleguides/${styleguideId}`, { method: "DELETE" }),
};
