import { sqliteTable, text, integer, real, primaryKey, index } from "drizzle-orm/sqlite-core";

export const folders = sqliteTable("folders", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  parentId: text("parent_id"),
  order: integer("order").default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  folderId: text("folder_id").references(() => folders.id, { onDelete: "set null" }),

  // --- Image size config (Ideogram-style: aspect ratio + megapixels) ---
  aspectRatio: text("aspect_ratio").notNull().default("1:1"), // see server/lib/imageSize.ts
  megapixels: real("megapixels").notNull().default(1),         // 1 | 2
  width: integer("width").notNull().default(1024),             // derived from aspect+MP, persisted
  height: integer("height").notNull().default(1024),

  // --- Model / workflow selection ---
  defaultWorkflowId: text("default_workflow_id"),                  // null => resolve the isDefault t2i
  promptFormat: text("prompt_format").notNull().default("ideogram"), // "ideogram" | "plaintext"

  // JSON array of tool-bucket ids the agent should NOT see for this project.
  disabledToolBuckets: text("disabled_tool_buckets").notNull().default("[]"),

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * A single storyboard frame. Holds an Ideogram-style structured layout as a
 * validated JSON blob (see server/lib/layout.ts). The serialized layout is what
 * gets injected as the ComfyUI prompt. Images are ordered into a sequence.
 */
export const images = sqliteTable("images", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").default(""),       // optional frame label e.g. "Opening shot"
  order: integer("order").notNull().default(0),

  // Ideogram structured layout JSON:
  //   { high_level_description, style_description, color_palette: string[],
  //     compositional_deconstruction: Region[] }
  // Region: { id, bounding_box:[y_min,x_min,y_max,x_max](0-1000), description,
  //           color_palette?: string[], text?: string }
  layout: text("layout").notNull().default("{}"),

  // Fallback plain-text prompt for non-Ideogram (plaintext) workflows.
  plainPrompt: text("plain_prompt").default(""),
  negativePrompt: text("negative_prompt").default(""),

  // --- Generation state ---
  status: text("status").notNull().default("draft"), // draft | generating | generated | failed
  assetId: text("asset_id"),     // generated result asset id (no hard FK)
  filePath: text("file_path"),   // convenience copy of the generated file (uploads-relative)
  seed: integer("seed"),
  genWidth: integer("gen_width"),
  genHeight: integer("gen_height"),
  workflowId: text("workflow_id"),
  lastError: text("last_error"),
  executedWorkflowJson: text("executed_workflow_json"),

  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (t) => [index("ix_images_project_order").on(t.projectId, t.order)]);

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  thinking: text("thinking"),
  toolCalls: text("tool_calls"),
  segments: text("segments"),
  createdAt: text("created_at").notNull(),
});

/**
 * Chat history scoped to a single storyboard image — a side conversation for
 * focused work on one frame that does NOT pollute the project-level chat.
 */
export const imageChatMessages = sqliteTable("image_chat_messages", {
  id: text("id").primaryKey(),
  imageId: text("image_id").notNull().references(() => images.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  thinking: text("thinking"),
  toolCalls: text("tool_calls"),
  segments: text("segments"),
  createdAt: text("created_at").notNull(),
}, (t) => [index("ix_image_chat_messages_image").on(t.imageId)]);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const undoActions = sqliteTable("undo_actions", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  groupId: text("group_id").notNull(),
  groupLabel: text("group_label").notNull(),
  seq: integer("seq").notNull(),
  toolName: text("tool_name").notNull(),
  source: text("source").notNull(),
  beforeState: text("before_state").notNull(),
  afterState: text("after_state").notNull(),
  fileBackups: text("file_backups"),
  filesCreated: text("files_created"),
  undone: integer("undone").default(0),
  createdAt: text("created_at").notNull(),
});

export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  pluginId: text("plugin_id").notNull().default("comfyui"),
  name: text("name").notNull(),
  description: text("description").default(""), // human-readable description for the AI agent
  workflowType: text("workflow_type").notNull(), // t2i | i2i (others unused in storyboard)
  workflowJson: text("workflow_json"),
  promptNodeId: text("prompt_node_id"),
  outputNodeId: text("output_node_id"),
  imageInputNodeId: text("image_input_node_id"),
  endImageInputNodeId: text("end_image_input_node_id"),
  audioInputNodeId: text("audio_input_node_id"),
  voiceInputNodeId: text("voice_input_node_id"),
  defaultVoiceFile: text("default_voice_file"),
  defaultCfg: real("default_cfg"),
  postfix: text("postfix").default(""),
  overrideBaseUrl: text("override_base_url"),
  trimEndFrames: integer("trim_end_frames").default(0),
  isDefault: integer("is_default").default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const pluginConfigs = sqliteTable("plugin_configs", {
  id: text("id").primaryKey(),
  pluginId: text("plugin_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: text("status").notNull().default("draft"), // draft | approved | executing | completed | cancelled
  steps: text("steps").notNull().default("[]"), // JSON: PlanStep[]
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const assets = sqliteTable("assets", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  type: text("type").notNull(), // "image"
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  description: text("description").default(""),
  prompt: text("prompt"),
  negativePrompt: text("negative_prompt"),
  seed: integer("seed"),
  workflowId: text("workflow_id"),
  workflowName: text("workflow_name"),
  generationTool: text("generation_tool").notNull(), // generate_image
  generationParams: text("generation_params"), // JSON blob of all params
  executedWorkflowJson: text("executed_workflow_json"),
  sourceAssetIds: text("source_asset_ids"), // JSON array of parent asset IDs
  sourceClipId: text("source_clip_id"),
  duration: real("duration"),
  width: integer("width"),
  height: integer("height"),
  fileSize: integer("file_size"),
  tags: text("tags").default("[]"),
  favorite: integer("favorite").default(0),
  onTimeline: integer("on_timeline").default(0),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const assetEmbeddings = sqliteTable("asset_embeddings", {
  id: text("id").primaryKey(),
  assetId: text("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  embedding: text("embedding").notNull(),
  createdAt: text("created_at").notNull(),
});

export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  command: text("command").notNull(),
  args: text("args").default("[]"),
  env: text("env").default("{}"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * A named brand bundle: markdown doc + tagged brand assets. Can be attached to
 * 0..N projects to inject brand context into that project's LLM system prompt.
 */
export const styleguides = sqliteTable("styleguides", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").default(""),
  markdown: text("markdown").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const styleguideAssets = sqliteTable("styleguide_assets", {
  id: text("id").primaryKey(),
  styleguideId: text("styleguide_id").notNull()
    .references(() => styleguides.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  role: text("role").notNull(),
  label: text("label").default(""),
  order: integer("order").default(0),
  createdAt: text("created_at").notNull(),
});

/**
 * Many-to-many attachment of styleguides to projects. When attached, a
 * styleguide's markdown + asset refs are injected into the project system prompt.
 */
export const projectStyleguides = sqliteTable("project_styleguides", {
  projectId: text("project_id").notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  styleguideId: text("styleguide_id").notNull()
    .references(() => styleguides.id, { onDelete: "cascade" }),
  attachedAt: text("attached_at").notNull(),
}, (t) => [
  primaryKey({ columns: [t.projectId, t.styleguideId] }),
]);

/**
 * Chat message history for the styleguide-editing conversation. Separate from
 * `chatMessages` (project-scoped) so the two contexts don't bleed.
 */
export const styleguideChatMessages = sqliteTable("styleguide_chat_messages", {
  id: text("id").primaryKey(),
  styleguideId: text("styleguide_id").notNull()
    .references(() => styleguides.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  thinking: text("thinking"),
  toolCalls: text("tool_calls"),
  segments: text("segments"),
  createdAt: text("created_at").notNull(),
});
