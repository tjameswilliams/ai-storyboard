import { db, schema } from "../db/client";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import {
  detectProvider,
  anthropicChat,
  anthropicStream,
  type OAIMessage,
  type OAITool,
} from "./llmAnthropic";

type MessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image_url"; image_url: { url: string } }
    >;

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: MessageContent;
  tool_calls?: ToolCallRequest[];
  tool_call_id?: string;
}

interface ToolCallRequest {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface LLMConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  /** "auto" | "anthropic" | "openai" — auto routes by base URL. */
  provider: string;
}

export async function getLLMConfig(): Promise<LLMConfig> {
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return {
    apiBaseUrl: map.apiBaseUrl || "http://localhost:11434/v1",
    apiKey: map.apiKey || "ollama",
    model: map.model || "llama3.2",
    temperature: parseFloat(map.temperature || "0.7"),
    maxOutputTokens: parseInt(map.maxOutputTokens || "16384"),
    provider: map.provider || "auto",
  };
}

/**
 * Optional override for code-generation tasks (currently the custom-
 * infographic authoring loop). Mirrors the vision config: setting only
 * `authoringModel` swaps the model on the same provider; setting URL/key
 * too lets you point authoring at a totally different provider — useful
 * because thinking-tuned models like Kimi-k2.6 are great at the planning
 * agent layer but burn minutes of CoT when asked to generate code.
 *
 * Falls through to the main LLM config when fields are blank, so leaving
 * everything empty preserves existing behavior.
 */
export async function getAuthoringLLMConfig(): Promise<{
  model: string;
  apiBaseUrl?: string;
  apiKey?: string;
}> {
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;
  return {
    model: map.authoringModel || map.model || "llama3.2",
    apiBaseUrl: map.authoringApiBaseUrl || undefined,
    apiKey: map.authoringApiKey || undefined,
  };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * OpenAI's newer models (o1, o3, GPT-5, …) rejected `max_tokens` in favor of
 * `max_completion_tokens`. Other OpenAI-compat providers (Ollama, OpenRouter,
 * LiteLLM, vLLM, LMStudio) still accept `max_tokens`, so the switch only fires
 * for api.openai.com.
 */
function isOpenAIEndpoint(apiBaseUrl: string): boolean {
  return /(^|\/\/)([^/]*\.)?openai\.com(\/|$)/i.test(apiBaseUrl);
}

/**
 * Build the full /chat/completions URL from a user-supplied base. If the base
 * is a bare host (no path beyond `/`), inject `/v1` — LMStudio rejects
 * `POST /chat/completions` with "Unexpected endpoint or method" and only
 * answers on `/v1/chat/completions`. Other OpenAI-compatible servers (Ollama,
 * OpenAI, DeepSeek, vLLM) all accept the `/v1`-prefixed path too, so this is
 * safe to apply uniformly.
 */
function buildChatCompletionsUrl(apiBaseUrl: string): string {
  const trimmed = apiBaseUrl.replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.pathname === "" || u.pathname === "/") {
      return `${trimmed}/v1/chat/completions`;
    }
  } catch {
    // Fall through to the naive concat if URL parsing fails.
  }
  return `${trimmed}/chat/completions`;
}

export async function getContextWindowSize(): Promise<number> {
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  if (map.contextWindow) {
    const val = parseInt(map.contextWindow);
    if (val > 0) return val;
  }

  if (map.maxTokens) {
    const val = parseInt(map.maxTokens);
    if (val > 8192) return val;
  }

  return 128000;
}

export async function summarizeConversation(
  messages: Array<{ role: string; content: string }>
): Promise<string> {
  const conversationText = messages
    .map((m) => `[${m.role}]: ${m.content}`)
    .join("\n\n");

  const result = await chatCompletion([
    {
      role: "system",
      content: `You are a conversation summarizer. Produce a concise summary of the following conversation that captures:
- Key video editing operations performed (clips added, tracks created, effects applied, etc.)
- Tracks and clips created or modified with their names and IDs if mentioned
- User preferences for video processing and workflow
- Current project state and what was being worked on
- Any planned next steps

Format as a brief but complete summary that would let someone continue the conversation seamlessly. Keep it under 500 words.`,
    },
    {
      role: "user",
      content: conversationText,
    },
  ]);

  return (
    result?.choices?.[0]?.message?.content ||
    "Previous conversation was summarized but details could not be extracted."
  );
}

export function getToolDefinitions() {
  const fn = (name: string, description: string, parameters: object) => ({
    type: "function" as const,
    function: { name, description, parameters },
  });

  const imageId = { type: "string", description: "The storyboard image (frame) id." };
  // Named coordinates (0–1000) so the agent never has to remember Ideogram's
  // unusual y-first array order — the tools assemble the array internally.
  const X_MIN = { type: "number", description: "Left edge (x_min), 0–1000 horizontally: 0 = far left, 1000 = far right." };
  const X_MAX = { type: "number", description: "Right edge (x_max), 0–1000 horizontally (must be > x_min)." };
  const Y_MIN = { type: "number", description: "Top edge (y_min), 0–1000 vertically: 0 = top, 1000 = bottom." };
  const Y_MAX = { type: "number", description: "Bottom edge (y_max), 0–1000 vertically (must be > y_min)." };
  const hexArray = { type: "array", items: { type: "string" }, description: "Array of hex colors, e.g. [\"#1a2b3c\"]." };

  return [
    // --- Core inspection & planning ---
    fn("get_project_status", "Get the project's image size config and a summary of all storyboard frames (order, status, description, region count).", {
      type: "object", properties: {},
    }),
    fn("list_images", "List all storyboard frames in order with a short summary of each.", {
      type: "object", properties: {},
    }),
    fn("describe_image", "Get the full Ideogram layout JSON and generation metadata for one frame.", {
      type: "object", properties: { image_id: imageId }, required: ["image_id"],
    }),
    fn("render_layout", "See an ASCII schematic of a frame's bounding boxes drawn to scale on an aspect-correct grid (plus each box's pixel size and on-screen aspect). Use it to visually check positions, sizes, overlaps, and proportions after composing or editing a layout and before generating.", {
      type: "object", properties: { image_id: imageId }, required: ["image_id"],
    }),
    fn("render_layout_image", "Render an actual labeled WIREFRAME IMAGE of a frame's bounding boxes (no generated picture) and attach it for you to look at. Call this after composing or editing a layout to visually confirm the boxes are positioned and proportioned correctly for the canvas, then fix anything that looks stretched or misplaced. Preferred over render_layout when you can see images.", {
      type: "object", properties: { image_id: imageId }, required: ["image_id"],
    }),

    // --- Layout editing ---
    fn("create_image", "Add a new storyboard frame. Optionally insert it right after an existing frame; otherwise it is appended to the end.", {
      type: "object",
      properties: {
        after_image_id: { type: "string", description: "Optional: insert the new frame immediately after this frame id." },
        name: { type: "string", description: "Optional short label for the frame." },
        layout: { type: "object", description: "Optional initial Ideogram layout (high_level_description, style_description, color_palette, compositional_deconstruction)." },
      },
    }),
    fn("delete_image", "Delete a storyboard frame and re-pack the sequence order.", {
      type: "object", properties: { image_id: imageId }, required: ["image_id"],
    }),
    fn("reorder_image", "Move a frame to a new position in the sequence (0-based index).", {
      type: "object",
      properties: { image_id: imageId, new_index: { type: "number", description: "New 0-based position in the sequence." } },
      required: ["image_id", "new_index"],
    }),
    fn("update_image_layout", "Replace a frame's entire Ideogram layout with a new one. Use for big rewrites; prefer the granular tools for small edits.", {
      type: "object",
      properties: { image_id: imageId, layout: { type: "object", description: "Full Ideogram layout object." } },
      required: ["image_id", "layout"],
    }),
    fn("patch_image_layout", "Shallow-merge top-level fields into a frame's layout (high_level_description, style_description, color_palette, compositional_deconstruction).", {
      type: "object",
      properties: { image_id: imageId, patch: { type: "object", description: "Partial layout to merge." } },
      required: ["image_id", "patch"],
    }),
    fn("set_high_level_description", "Set the frame's high_level_description (overall scene).", {
      type: "object", properties: { image_id: imageId, text: { type: "string" } }, required: ["image_id", "text"],
    }),
    fn("set_style_description", "Set the frame's style_description (aesthetic, lighting, medium, mood, palette).", {
      type: "object", properties: { image_id: imageId, text: { type: "string" } }, required: ["image_id", "text"],
    }),
    fn("set_color_palette", "Set the frame's top-level color_palette (array of hex colors).", {
      type: "object", properties: { image_id: imageId, palette: hexArray }, required: ["image_id", "palette"],
    }),
    fn("add_region", "Add a region (a subject, object, or text element) to the frame. Give its rectangle with the four named edges x_min/y_min/x_max/y_max (0–1000; x is horizontal left→right, y is vertical top→bottom). Returns the new region id.", {
      type: "object",
      properties: {
        image_id: imageId,
        x_min: X_MIN,
        y_min: Y_MIN,
        x_max: X_MAX,
        y_max: Y_MAX,
        description: { type: "string", description: "What this region contains (subject, pose, materials, lighting). For a text element, the styling/placement of the text." },
        color_palette: hexArray,
        text: { type: "string", description: "Optional literal text Ideogram should render in this region (words only)." },
      },
      required: ["image_id", "x_min", "y_min", "x_max", "y_max", "description"],
    }),
    fn("update_region", "Update fields of an existing region (by region id). Only provided fields change. To move/resize, pass any of the named edges x_min/y_min/x_max/y_max (0–1000; x horizontal, y vertical); omitted edges keep their current value.", {
      type: "object",
      properties: {
        image_id: imageId,
        region_id: { type: "string", description: "The region's id (from describe_image / add_region)." },
        x_min: X_MIN,
        y_min: Y_MIN,
        x_max: X_MAX,
        y_max: Y_MAX,
        description: { type: "string" },
        color_palette: hexArray,
        text: { type: "string" },
      },
      required: ["image_id", "region_id"],
    }),
    fn("delete_region", "Remove a region from a frame by region id.", {
      type: "object",
      properties: { image_id: imageId, region_id: { type: "string" } },
      required: ["image_id", "region_id"],
    }),
    fn("set_plain_prompt", "For plaintext-format projects: set the frame's plain text prompt (and optional negative prompt).", {
      type: "object",
      properties: { image_id: imageId, prompt: { type: "string" }, negative_prompt: { type: "string" } },
      required: ["image_id", "prompt"],
    }),

    // --- Generation ---
    fn("generate_image", "Render a frame's current layout into an image via ComfyUI. Sets the frame's status and links the generated asset.", {
      type: "object",
      properties: {
        image_id: imageId,
        seed: { type: "number", description: "Optional fixed seed for reproducibility." },
        workflow_id: { type: "string", description: "Optional ComfyUI workflow id to use instead of the project default." },
      },
      required: ["image_id"],
    }),
    fn("regenerate_image", "Re-render a frame (fresh random seed by default) to get a variation of the same layout.", {
      type: "object",
      properties: {
        image_id: imageId,
        seed: { type: "number", description: "Optional fixed seed; omit for a new random variation." },
        workflow_id: { type: "string", description: "Optional ComfyUI workflow id." },
      },
      required: ["image_id"],
    }),

    // --- Asset library ---
    fn("list_assets", "List generated image assets for the project (most recent first).", {
      type: "object",
      properties: {
        type: { type: "string", description: "Filter by asset type (e.g. 'image')." },
        limit: { type: "number" },
        offset: { type: "number" },
        favorite_only: { type: "boolean" },
      },
    }),
    fn("search_assets", "Keyword-search generated assets by prompt/filename/tags.", {
      type: "object",
      properties: { query: { type: "string" }, type: { type: "string" } },
      required: ["query"],
    }),
    fn("search_assets_semantic", "Semantic search across asset prompts using embeddings.", {
      type: "object",
      properties: { query: { type: "string" }, type: { type: "string" }, top_k: { type: "number" } },
      required: ["query"],
    }),
    fn("get_asset_info", "Get full metadata for one asset by id.", {
      type: "object", properties: { asset_id: { type: "string" } }, required: ["asset_id"],
    }),
    fn("tag_asset", "Set the tags array on an asset.", {
      type: "object",
      properties: { asset_id: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
      required: ["asset_id", "tags"],
    }),

    // --- Web ---
    fn("web_search", "Search the web and return result titles, URLs, and snippets.", {
      type: "object",
      properties: { query: { type: "string" }, num_results: { type: "number" } },
      required: ["query"],
    }),
    fn("fetch_webpage", "Fetch and extract the main readable content of a web page.", {
      type: "object",
      properties: { url: { type: "string" }, max_length: { type: "number" } },
      required: ["url"],
    }),
    fn("download_image", "Download an image from a URL (or local path) and register it as a project asset for reference.", {
      type: "object",
      properties: {
        url: { type: "string" },
        description: { type: "string", description: "Short description, stored as the asset prompt for search." },
        source_page_url: { type: "string" },
      },
      required: ["url"],
    }),

    // --- Planning ---
    fn("update_plan", "Create or manage an execution plan for building a whole storyboard. Use 'create' to propose a plan (one step per intended frame; starts as draft for user review), 'update_step' to mark progress, 'set_status' to change plan status.", {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "update_step", "set_status", "add_steps", "revise"], description: "Action to perform" },
        title: { type: "string", description: "Plan title (for create/revise)" },
        steps: { type: "array", items: { type: "object", properties: { label: { type: "string" } }, required: ["label"] }, description: "Steps (for create/add_steps/revise)" },
        step_id: { type: "string", description: "Step ID to update (for update_step)" },
        step_status: { type: "string", enum: ["pending", "in_progress", "completed", "skipped", "failed"], description: "New step status (for update_step)" },
        step_notes: { type: "string", description: "Optional note for the step (for update_step)" },
        plan_status: { type: "string", enum: ["draft", "approved", "executing", "completed", "cancelled"], description: "New plan status (for set_status)" },
      },
      required: ["action"],
    }),
  ];
}

export async function streamChat(
  messages: ChatMessage[],
  tools?: ReturnType<typeof getToolDefinitions>
): Promise<Response> {
  const config = await getLLMConfig();

  if (detectProvider(config.apiBaseUrl, config.provider) === "anthropic") {
    return anthropicStream({
      apiBaseUrl: config.apiBaseUrl,
      apiKey: config.apiKey,
      model: config.model,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      messages: messages as unknown as OAIMessage[],
      tools: tools as unknown as OAITool[] | undefined,
    });
  }

  const tokenLimitKey = isOpenAIEndpoint(config.apiBaseUrl)
    ? "max_completion_tokens"
    : "max_tokens";
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature,
    [tokenLimitKey]: config.maxOutputTokens,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const hasVision = messages.some((m) => Array.isArray(m.content) && m.content.some((p) => "image_url" in p));
  if (hasVision) {
    console.log(`[llm] Vision request to ${config.apiBaseUrl} model=${config.model}, payload size=${JSON.stringify(body).length} bytes`);
  }

  const payload = JSON.stringify(body);
  const url = new URL(buildChatCompletionsUrl(config.apiBaseUrl));
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  // Use a fresh agent per request to avoid stale pooled connections,
  // and set generous timeouts for long-running LLM inference
  const agent = isHttps
    ? new HttpsAgent({ keepAlive: false })
    : new HttpAgent({ keepAlive: false });

  return new Promise<Response>((resolve, reject) => {
    const req = requestFn(
      url,
      {
        method: "POST",
        agent,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.socket?.setTimeout(0);
        res.socket?.setKeepAlive(true, 5000);

        if (res.statusCode && (res.statusCode < 200 || res.statusCode >= 300)) {
          let errorBody = "";
          res.on("data", (chunk: Buffer) => (errorBody += chunk));
          res.on("end", () =>
            reject(new Error(`LLM API error ${res.statusCode}: ${errorBody}`))
          );
          return;
        }

        const webStream = Readable.toWeb(res as unknown as Readable);
        resolve(
          new Response(webStream as ReadableStream, {
            status: res.statusCode || 200,
          })
        );
      }
    );

    // 5 minute timeout — LLM inference with vision can take a long time
    req.setTimeout(300_000, () => {
      req.destroy(new Error("LLM request timed out (5 min)"));
    });

    req.on("error", reject);
    req.on("socket", (socket) => {
      socket.setTimeout(0);
      socket.setKeepAlive(true, 5000);
    });

    req.write(payload);
    req.end();
  });
}

export async function chatCompletion(
  messages: ChatMessage[],
  tools?: ReturnType<typeof getToolDefinitions> | Array<Record<string, unknown>>,
  overrides?: {
    model?: string;
    apiBaseUrl?: string;
    apiKey?: string;
    provider?: string;
    /**
     * Skip the model's internal chain-of-thought when the caller has a
     * tight retry loop of its own. Used by custom-infographic authoring
     * because Kimi-k2.6 with thinking enabled burns its entire output
     * budget on reasoning tokens before emitting any code. Translates to
     * provider-specific fields; other providers ignore the extras.
     */
    disableThinking?: boolean;
    /**
     * Per-call override of `max_tokens`. Defaults to the user's config
     * value (typically 16384). Authoring sets a tighter cap so a runaway
     * thinking-model can't chew up the entire budget before surfacing.
     */
    maxOutputTokens?: number;
    /**
     * OpenAI-compatible `tool_choice`. Use an object like
     * `{ type: "function", function: { name: "submit_x" } }` to force
     * the model into a specific function call — shuts down preamble and
     * (on most providers) the reasoning_content block too.
     */
    toolChoice?: "auto" | "required" | "none" | { type: "function"; function: { name: string } };
    /**
     * Override the mid-stream idle timeout. Default 90s. Bump this for
     * workloads where the model legitimately pauses between chunks for
     * long stretches — e.g. local LMStudio serving a thinking-heavy
     * model can go quiet for minutes between phases of generation.
     */
    idleTimeoutMs?: number;
  },
) {
  const config = await getLLMConfig();
  const model = overrides?.model || config.model;
  const apiBaseUrl = overrides?.apiBaseUrl || config.apiBaseUrl;
  const apiKey = overrides?.apiKey || config.apiKey;
  const provider = detectProvider(apiBaseUrl, overrides?.provider || config.provider);

  if (provider === "anthropic") {
    return anthropicChat({
      apiBaseUrl,
      apiKey,
      model,
      temperature: config.temperature,
      maxOutputTokens: config.maxOutputTokens,
      messages: messages as unknown as OAIMessage[],
      tools: tools as unknown as OAITool[] | undefined,
      // Anthropic has thinking off by default and we never opt in here,
      // so there's nothing to disable — left as a no-op.
    });
  }

  const tokenLimitKey = isOpenAIEndpoint(apiBaseUrl)
    ? "max_completion_tokens"
    : "max_tokens";
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: config.temperature,
    [tokenLimitKey]: overrides?.maxOutputTokens ?? config.maxOutputTokens,
    // Streaming is an internal implementation detail here — we assemble the
    // full response and return the same OAIChatResponse-shaped object that
    // the old non-streaming path did. The reason to stream: a non-streaming
    // request blocks on the full generation before any bytes come back, and
    // Kimi-style providers with thinking enabled commonly take 5+ minutes
    // to emit a multi-thousand-token component. We don't know in advance
    // whether the provider has stalled or is just working, so a single
    // wall-clock ceiling is a bad bet. Instead we stream, accumulate, and
    // enforce a per-token idle timeout below.
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
  }

  if (overrides?.toolChoice !== undefined) {
    body.tool_choice = overrides.toolChoice;
  }

  if (overrides?.disableThinking) {
    // Per-provider flags to minimize server-side chain-of-thought. The
    // providers use overlapping-but-not-identical enums for `reasoning_effort`,
    // so we pick the lowest value that's safe across all of them:
    //   OpenAI  (gpt-5.x): `none|low|medium|high|xhigh` — use "none", but
    //   /v1/chat/completions rejects the key whenever function tools are
    //   attached ("Function tools with reasoning_effort are not supported
    //   … Please use /v1/responses instead"), so we skip it in that case
    //   and accept the model's default reasoning behavior.
    //   Moonshot/Kimi: `minimal|low|medium|high` — accepts "low".
    //   vLLM (Qwen, etc.): `none|low|medium|high` — 400s on "minimal"
    //   ("Input should be 'none', 'low', 'medium' or 'high'").
    //   "low" is the lowest value the Moonshot/vLLM branch can both accept;
    //   for Moonshot the reduction below "minimal" doesn't matter in
    //   practice since `enable_thinking=false` is the hard off switch.
    //   OpenAI 400s on `enable_thinking`, so it only goes to non-OpenAI.
    // We intentionally skip `thinking: false` — Moonshot/Anthropic both
    // require `thinking` to be an object when present (Moonshot 400s with
    // "bool is not acceptable").
    const hasTools = Array.isArray(tools) && tools.length > 0;
    if (isOpenAIEndpoint(apiBaseUrl)) {
      if (!hasTools) body.reasoning_effort = "none";
    } else {
      body.enable_thinking = false;
      body.reasoning_effort = "low";
    }
  }

  // Idle timeout: abort if no bytes arrive within this window. An active
  // generation resets this on every chunk, so arbitrarily long outputs are
  // fine as long as the provider is still producing. A truly stalled
  // connection gets killed quickly. Callers with legitimately bursty output
  // (local thinking models that pause minutes between phases) can bump it
  // via overrides.idleTimeoutMs.
  const IDLE_MS = overrides?.idleTimeoutMs ?? 90_000;
  const HEARTBEAT_MS = 10_000;
  const abort = new AbortController();
  let idleTimedOut = false;
  const scheduleIdle = () => setTimeout(() => {
    idleTimedOut = true;
    abort.abort();
  }, IDLE_MS);
  let idleTimer = scheduleIdle();
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = scheduleIdle();
  };

  const tag = `[llm/stream ${model}]`;
  const t0 = Date.now();
  const payloadBytes = JSON.stringify(body).length;
  const messageCount = Array.isArray(messages) ? messages.length : 0;
  console.log(
    `${tag} → ${apiBaseUrl} messages=${messageCount} payload=${payloadBytes}b tools=${tools?.length ?? 0}`,
  );

  let res: Response;
  try {
    res = await fetch(buildChatCompletionsUrl(apiBaseUrl), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: abort.signal,
    });
  } catch (err) {
    clearTimeout(idleTimer);
    const msg = idleTimedOut
      ? `chatCompletion idle ${IDLE_MS}ms without headers`
      : (err as Error).message;
    console.error(`${tag} ✗ connect failed after ${Date.now() - t0}ms: ${msg}`);
    throw new Error(msg);
  }

  const headersMs = Date.now() - t0;
  console.log(`${tag} headers status=${res.status} at ${headersMs}ms`);

  if (!res.ok) {
    clearTimeout(idleTimer);
    const errorText = await res.text();
    throw new Error(`LLM API error ${res.status}: ${errorText}`);
  }
  if (!res.body) {
    clearTimeout(idleTimer);
    throw new Error("LLM API: no response body");
  }

  // Heartbeat: log progress every HEARTBEAT_MS so a human watching the log
  // can tell the difference between "still generating" and "dead". Shows
  // chunk count, elapsed, and an estimate of content so far.
  const progress = { chunks: 0, bytes: 0, firstByteMs: -1 };
  const heartbeat = setInterval(() => {
    const elapsed = Date.now() - t0;
    console.log(
      `${tag} ⏱ ${elapsed}ms chunks=${progress.chunks} bytes=${progress.bytes}` +
      (progress.firstByteMs >= 0 ? ` ttfb=${progress.firstByteMs}ms` : " (no bytes yet)"),
    );
  }, HEARTBEAT_MS);

  try {
    const result = await assembleStreamedCompletion(res.body, (ev) => {
      resetIdle();
      progress.chunks++;
      progress.bytes += ev.bytes;
      if (progress.firstByteMs < 0) progress.firstByteMs = Date.now() - t0;
    });
    const totalMs = Date.now() - t0;
    const content = result.choices[0]?.message?.content ?? "";
    const reasoning = result.choices[0]?.message?.reasoning_content ?? "";
    const toolCalls = result.choices[0]?.message?.tool_calls?.length ?? 0;
    console.log(
      `${tag} ✓ ${totalMs}ms chunks=${progress.chunks} content=${content.length}ch reasoning=${reasoning.length}ch toolCalls=${toolCalls} finish=${result.choices[0]?.finish_reason}`,
    );
    return result;
  } catch (err) {
    const totalMs = Date.now() - t0;
    const msg = idleTimedOut
      ? `chatCompletion idle ${IDLE_MS}ms mid-stream (chunks=${progress.chunks}, bytes=${progress.bytes}, ttfb=${progress.firstByteMs}ms)`
      : (err as Error).message;
    console.error(`${tag} ✗ ${totalMs}ms ${msg}`);
    throw new Error(msg);
  } finally {
    clearTimeout(idleTimer);
    clearInterval(heartbeat);
  }
}

/**
 * Read an OpenAI-compatible `stream: true` chat.completions SSE and fold
 * the deltas into a single response object with the same shape callers
 * expect from a non-streamed completion: `choices[0].message.{content,
 * reasoning_content, tool_calls}` plus `choices[0].finish_reason`.
 *
 * `onTick` is called every time a chunk is consumed — used by the caller
 * to reset its idle-timeout watchdog.
 */
async function assembleStreamedCompletion(
  body: ReadableStream<Uint8Array>,
  onTick: (ev: { bytes: number }) => void,
): Promise<{
  choices: Array<{
    message: {
      role: "assistant";
      content: string;
      reasoning_content?: string;
      tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    };
    finish_reason: string;
  }>;
}> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let reasoning = "";
  let finishReason = "";
  const toolCalls: Array<{ id: string; type: string; function: { name: string; arguments: string } }> = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    onTick({ bytes: value?.byteLength ?? 0 });
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        const delta = choice?.delta;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (delta?.content) content += delta.content;
        if (delta?.reasoning_content) reasoning += delta.reasoning_content;
        if (delta?.thinking) reasoning += delta.thinking;
        if (Array.isArray(delta?.tool_calls)) {
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
      } catch {
        // Malformed chunk — ignore and keep reading. Providers occasionally
        // emit partial JSON mid-chunk that the next chunk completes.
      }
    }
  }

  return {
    choices: [
      {
        message: {
          role: "assistant",
          content,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason || "stop",
      },
    ],
  };
}
