export interface Folder {
  id: string;
  name: string;
  parentId: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Asset {
  id: string;
  projectId: string;
  type: string; // "image" | "tts" | "audio"
  filePath: string;
  fileName: string;
  description: string | null;
  prompt: string | null;
  negativePrompt: string | null;
  seed: number | null;
  workflowId: string | null;
  workflowName: string | null;
  generationTool: string;
  generationParams: string | null;
  executedWorkflowJson?: string | null;
  sourceAssetIds: string | null;
  sourceClipId: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  fileSize: number | null;
  tags: string;
  favorite: number;
  onTimeline: number;
  createdAt: string;
  updatedAt: string;
}

export interface AssetProvenance {
  assetId: string;
  generationTool: string;
  prompt: string | null;
  negativePrompt: string | null;
  seed: number | null;
  workflowId: string | null;
  workflowName: string | null;
  generationParams: Record<string, unknown> | null;
  sourceClipId: string | null;
  sourceAssetIds: string[];
  filePath: string;
  type: string;
  updatedAt: string;
}

export type AspectRatio = string; // e.g. "1:1","16:9",...
export type PromptFormat = "ideogram" | "plaintext";

export interface Project {
  id: string;
  name: string;
  description: string;
  folderId: string | null;
  aspectRatio: string;
  megapixels: number;
  width: number;
  height: number;
  defaultWorkflowId: string | null;
  promptFormat: PromptFormat;
  disabledToolBuckets: string;
  createdAt: string;
  updatedAt: string;
}

/** Bounding box on a 0..1000 grid, top-left origin: [y_min, x_min, y_max, x_max]. */
export type BoundingBox = [number, number, number, number];

export interface Region {
  id: string;
  bounding_box: BoundingBox;
  description: string;
  color_palette?: string[];
  text?: string;
}

// Ideogram 4 style_description is a structured object (photo XOR art_style).
export interface StyleDescription {
  aesthetics?: string;
  lighting?: string;
  medium?: string;
  photo?: string;
  art_style?: string;
  color_palette?: string[];
}

export interface Layout {
  high_level_description: string;
  style_description: StyleDescription;
  color_palette: string[];
  compositional_deconstruction: Region[];
}

export type ImageStatus = "draft" | "generating" | "generated" | "failed";

export interface StoryboardImage {
  id: string;
  projectId: string;
  name: string;
  order: number;
  layout: Layout;
  plainPrompt: string;
  negativePrompt: string;
  status: ImageStatus;
  assetId: string | null;
  filePath: string | null;
  seed: number | null;
  genWidth: number | null;
  genHeight: number | null;
  workflowId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  segments?: MessageSegment[];
  attachments?: ChatAttachment[];
  timestamp?: string;
  createdAt?: string;
}

export interface MessageSegment {
  type: "text" | "thinking" | "tool_call";
  content?: string;
  toolCall?: ToolCall;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments?: Record<string, unknown>;
  result?: unknown;
  status: "pending" | "executed" | "rejected";
}

export interface ChatAttachment {
  url: string;
  name: string;
  type: string;
}

/** Summary of an active agent run, returned by GET /runs/active. */
export interface RunSummary {
  runId: string;
  scope: "project" | "image" | "styleguide";
  conversationId: string;
  key: string; // `${scope}:${id}`
  projectId: string | null;
  status: "running" | "complete" | "error" | "cancelled" | "interrupted";
  assistantMsgId: string;
}

export interface PlanStep {
  id: string;
  label: string;
  status: "pending" | "in_progress" | "completed" | "skipped" | "failed";
  notes?: string;
}

export interface Plan {
  id: string;
  projectId: string;
  title: string;
  status: "draft" | "approved" | "executing" | "completed" | "cancelled";
  steps: PlanStep[];
  createdAt: string;
  updatedAt: string;
}

export interface ComfyWorkflowSummary {
  id: string;
  pluginId: string;
  name: string;
  description: string | null;
  workflowType: string;
  postfix: string | null;
  overrideBaseUrl: string | null;
  isDefault: number | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryState {
  undoStack: Array<{ groupId: string; label: string; createdAt: string }>;
  redoStack: Array<{ groupId: string; label: string; createdAt: string }>;
  canUndo: boolean;
  canRedo: boolean;
}

export interface UndoRedoResult {
  success: boolean;
  label?: string;
  canUndo: boolean;
  canRedo: boolean;
}

export type StyleguideAssetRole =
  | "primary-logo"
  | "secondary-logo"
  | "wordmark"
  | "icon"
  | "accent-image"
  | "color-swatch"
  | "reference";

export interface StyleguideBrandAsset {
  id: string;
  styleguideId: string;
  filePath: string;
  fileName: string;
  mimeType: string | null;
  fileSize: number | null;
  role: StyleguideAssetRole | string;
  label: string | null;
  order: number | null;
  createdAt: string;
}

export interface StyleguideAnimation {
  id: string;
  styleguideId: string;
  componentHash: string;
  slug: string;
  name: string;
  description: string | null;
  brief: string;
  defaultDurationSeconds: number | null;
  previewPath: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StyleguideAttachedProject {
  projectId: string;
  projectName: string;
  attachedAt: string;
}

export interface Styleguide {
  id: string;
  name: string;
  description: string | null;
  markdown: string;
  createdAt: string;
  updatedAt: string;
  attachedProjectCount?: number;
  assets?: StyleguideBrandAsset[];
  animations?: StyleguideAnimation[];
  attachedProjects?: StyleguideAttachedProject[];
}

export interface AttachedStyleguideSummary {
  id: string;
  name: string;
  description: string | null;
  updatedAt: string;
  attachedAt: string;
}
