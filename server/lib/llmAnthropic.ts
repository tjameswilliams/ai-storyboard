/**
 * Anthropic-native adapter for chat + streaming. Lets us point at
 * api.anthropic.com directly so we get prompt caching and per-tier rate-limit
 * headers without losing OpenAI-compat support for Ollama / OpenRouter / etc.
 *
 * Translation only — call sites continue to speak OpenAI's chat-completions
 * shape; this file converts to/from Anthropic's /v1/messages shape.
 */

type OAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface OAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OAIContentPart[];
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export interface OAITool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

interface AnthropicTextBlock {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

interface AnthropicImageBlock {
  type: "image";
  source: { type: "base64"; media_type: string; data: string };
}

interface AnthropicToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: AnthropicContentBlock[];
}

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  temperature?: number;
  system?: AnthropicTextBlock[];
  messages: AnthropicMessage[];
  tools?: Array<{
    name: string;
    description?: string;
    input_schema: Record<string, unknown>;
    cache_control?: { type: "ephemeral" };
  }>;
  stream?: boolean;
}

// ─── Provider detection ───────────────────────────────────────────────

export type Provider = "anthropic" | "openai";

/**
 * Pick a provider based on settings. `auto` (default) routes to anthropic
 * when the base URL is api.anthropic.com — every other URL (Ollama,
 * OpenRouter, LiteLLM, vLLM, …) goes through the OpenAI-compat path even if
 * the model name starts with "claude-".
 */
export function detectProvider(
  apiBaseUrl: string,
  providerSetting?: string,
): Provider {
  const setting = (providerSetting || "auto").toLowerCase();
  if (setting === "anthropic" || setting === "openai") return setting;
  return apiBaseUrl.includes("api.anthropic.com") ? "anthropic" : "openai";
}

// ─── Image data-url helpers ───────────────────────────────────────────

function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = url.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m) return null;
  return { mediaType: m[1], data: m[2] };
}

// ─── OpenAI → Anthropic message translation ───────────────────────────

function oaiContentToAnthropicBlocks(
  content: string | OAIContentPart[],
): Array<AnthropicTextBlock | AnthropicImageBlock> {
  if (typeof content === "string") {
    return content ? [{ type: "text", text: content }] : [];
  }
  const out: Array<AnthropicTextBlock | AnthropicImageBlock> = [];
  for (const part of content) {
    if (part.type === "text") {
      if (part.text) out.push({ type: "text", text: part.text });
    } else if (part.type === "image_url") {
      const parsed = parseDataUrl(part.image_url.url);
      if (parsed) {
        out.push({
          type: "image",
          source: { type: "base64", media_type: parsed.mediaType, data: parsed.data },
        });
      } else {
        // Anthropic only accepts base64 inline; describe URL as text fallback.
        out.push({ type: "text", text: `[image: ${part.image_url.url}]` });
      }
    }
  }
  return out;
}

export interface TranslatedRequest {
  system?: AnthropicTextBlock[];
  messages: AnthropicMessage[];
  tools?: AnthropicRequest["tools"];
}

/**
 * Convert OpenAI-shape messages + tools to Anthropic /v1/messages shape.
 * Applies cache_control to the last system block and the last tool — those
 * are the two stable prefixes that benefit most from caching.
 */
export function translateToAnthropic(
  messages: OAIMessage[],
  tools?: OAITool[],
  opts: { cache?: boolean } = { cache: true },
): TranslatedRequest {
  // 1. Pull all system messages into a single system[] array.
  const systemBlocks: AnthropicTextBlock[] = [];
  const nonSystem: OAIMessage[] = [];
  for (const m of messages) {
    if (m.role === "system") {
      const text = typeof m.content === "string"
        ? m.content
        : m.content.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
      if (text) systemBlocks.push({ type: "text", text });
    } else {
      nonSystem.push(m);
    }
  }
  if (opts.cache && systemBlocks.length > 0) {
    systemBlocks[systemBlocks.length - 1].cache_control = { type: "ephemeral" };
  }

  // 2. Translate each user/assistant/tool message.
  const out: AnthropicMessage[] = [];
  for (const m of nonSystem) {
    if (m.role === "tool") {
      const block: AnthropicToolResultBlock = {
        type: "tool_result",
        tool_use_id: m.tool_call_id || "",
        content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      };
      // Coalesce consecutive tool results into one user message — Anthropic
      // requires alternating user/assistant turns.
      const last = out[out.length - 1];
      if (last && last.role === "user") {
        last.content.push(block);
      } else {
        out.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (m.role === "assistant") {
      const blocks: AnthropicContentBlock[] = [];
      const text = oaiContentToAnthropicBlocks(m.content);
      blocks.push(...text);
      if (m.tool_calls) {
        for (const tc of m.tool_calls) {
          let input: Record<string, unknown> = {};
          try { input = tc.function.arguments ? JSON.parse(tc.function.arguments) : {}; } catch {}
          blocks.push({
            type: "tool_use",
            id: tc.id,
            name: tc.function.name,
            input,
          });
        }
      }
      out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
      continue;
    }

    // role === "user"
    const blocks = oaiContentToAnthropicBlocks(m.content);
    out.push({ role: "user", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
  }

  // 3. Translate tools and stamp cache_control on the last one.
  let translatedTools: AnthropicRequest["tools"] | undefined;
  if (tools && tools.length > 0) {
    translatedTools = tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      input_schema: t.function.parameters,
    }));
    if (opts.cache) {
      translatedTools[translatedTools.length - 1].cache_control = { type: "ephemeral" };
    }
  }

  return {
    system: systemBlocks.length ? systemBlocks : undefined,
    messages: out,
    tools: translatedTools,
  };
}

// ─── Anthropic → OpenAI response translation ──────────────────────────

interface AnthropicResponse {
  id: string;
  model: string;
  content: Array<
    | { type: "text"; text: string }
    | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> }
  >;
  stop_reason: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export interface OAIChatResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: "assistant";
      content: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export function translateAnthropicResponse(res: AnthropicResponse): OAIChatResponse {
  let text = "";
  const toolCalls: NonNullable<OAIChatResponse["choices"][0]["message"]["tool_calls"]> = [];
  for (const block of res.content || []) {
    if (block.type === "text") text += block.text;
    else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        type: "function",
        function: { name: block.name, arguments: JSON.stringify(block.input || {}) },
      });
    }
  }
  const finish = res.stop_reason === "tool_use" ? "tool_calls"
    : res.stop_reason === "end_turn" ? "stop"
    : res.stop_reason === "max_tokens" ? "length"
    : (res.stop_reason || "stop");

  return {
    id: res.id,
    model: res.model,
    choices: [{
      message: {
        role: "assistant",
        content: text,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: finish,
    }],
    usage: res.usage ? {
      prompt_tokens: res.usage.input_tokens,
      completion_tokens: res.usage.output_tokens,
      cache_read_input_tokens: res.usage.cache_read_input_tokens,
      cache_creation_input_tokens: res.usage.cache_creation_input_tokens,
    } : undefined,
  };
}

// ─── Anthropic SSE → OpenAI SSE translation ───────────────────────────

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  content_block?: {
    type: string;
    id?: string;
    name?: string;
    text?: string;
    input?: Record<string, unknown>;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
    stop_reason?: string;
  };
  error?: { type?: string; message?: string };
  message?: { error?: { type?: string; message?: string } };
}

/**
 * Stateful translator: feed it Anthropic SSE events one at a time, get back
 * an array of OpenAI-shape SSE chunks. The chat route already parses
 * OpenAI deltas, so we don't have to touch it.
 */
export class AnthropicSSEToOpenAITranslator {
  private toolBlocks = new Map<number, { id: string; name: string; idx: number }>();
  private nextOaiToolIndex = 0;
  private id = `chatcmpl-${Date.now()}`;
  private model = "";

  setModel(m: string) { this.model = m; }

  translate(event: AnthropicStreamEvent): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = [];
    const base = { id: this.id, model: this.model, object: "chat.completion.chunk" };

    switch (event.type) {
      case "message_start":
        // No-op for OpenAI consumers.
        return out;

      case "content_block_start": {
        const block = event.content_block;
        if (block?.type === "tool_use" && event.index !== undefined) {
          const oaiIdx = this.nextOaiToolIndex++;
          this.toolBlocks.set(event.index, { id: block.id || "", name: block.name || "", idx: oaiIdx });
          out.push({
            ...base,
            choices: [{
              index: 0,
              delta: {
                tool_calls: [{
                  index: oaiIdx,
                  id: block.id,
                  type: "function",
                  function: { name: block.name, arguments: "" },
                }],
              },
              finish_reason: null,
            }],
          });
        }
        return out;
      }

      case "content_block_delta": {
        const d = event.delta;
        if (d?.type === "text_delta" && d.text) {
          out.push({
            ...base,
            choices: [{ index: 0, delta: { content: d.text }, finish_reason: null }],
          });
        } else if (d?.type === "input_json_delta" && d.partial_json !== undefined && event.index !== undefined) {
          const tool = this.toolBlocks.get(event.index);
          if (tool) {
            out.push({
              ...base,
              choices: [{
                index: 0,
                delta: {
                  tool_calls: [{
                    index: tool.idx,
                    function: { arguments: d.partial_json },
                  }],
                },
                finish_reason: null,
              }],
            });
          }
        }
        return out;
      }

      case "message_delta": {
        const stop = event.delta?.stop_reason;
        if (stop) {
          const finish = stop === "tool_use" ? "tool_calls"
            : stop === "end_turn" ? "stop"
            : stop === "max_tokens" ? "length"
            : stop;
          out.push({
            ...base,
            choices: [{ index: 0, delta: {}, finish_reason: finish }],
          });
        }
        return out;
      }

      case "error": {
        const msg = event.error?.message || "Anthropic stream error";
        console.error(`[llm/anthropic] stream error event: ${msg}`);
        out.push({
          ...base,
          choices: [{
            index: 0,
            delta: { content: `\n\n[stream error: ${msg}]` },
            finish_reason: "stop",
          }],
        });
        return out;
      }

      case "message_stop":
      case "content_block_stop":
      case "ping":
        return out;

      default:
        return out;
    }
  }
}

// ─── Preemptive throttle ──────────────────────────────────────────────
//
// Tool-call loops in the chat route can fire back-to-back Anthropic
// requests, each re-sending the full system prompt + tool list + message
// history (~100KB). That burns through the input-tokens-per-minute (ITPM)
// window of the current tier and ends in a 429 that costs us 30-60s of
// forced wait. Avoid it two ways:
//
//   1. A minimum floor between successive calls so a tool-call storm
//      doesn't fire ten requests in the same second.
//   2. When the response's anthropic-ratelimit-input-tokens-remaining
//      header shows we're nearly out, delay the next call until the
//      window resets. This is adaptive — we only slow down when we're
//      close to the edge, not every time.

const MIN_CALL_SPACING_MS = 400;
const LOW_REMAINING_FRACTION = 0.15;
const MAX_PREEMPTIVE_WAIT_MS = 60_000;

let nextSafeCallTime = 0;

/**
 * Derive the earliest time (epoch ms) the next Anthropic call should be
 * allowed to fire, given the rate-limit headers on the most recent response
 * and the currently scheduled "next safe" time. Pure for unit testing.
 */
export function computeNextSafeCallTime(
  headers: Record<string, string | undefined>,
  now: number,
  current: number,
  minSpacingMs: number = MIN_CALL_SPACING_MS,
): number {
  // Always at least enforce the spacing floor from "now".
  let next = Math.max(current, now + minSpacingMs);

  const remaining = parseIntSafe(
    headers["anthropic-ratelimit-input-tokens-remaining"],
  );
  const limit = parseIntSafe(
    headers["anthropic-ratelimit-input-tokens-limit"],
  );
  const resetRaw =
    headers["anthropic-ratelimit-input-tokens-reset"] ||
    headers["anthropic-ratelimit-tokens-reset"];

  if (
    remaining !== null &&
    limit !== null &&
    limit > 0 &&
    resetRaw &&
    remaining < limit * LOW_REMAINING_FRACTION
  ) {
    const resetMs = Date.parse(resetRaw);
    if (Number.isFinite(resetMs) && resetMs > now) {
      const capped = Math.min(resetMs, now + MAX_PREEMPTIVE_WAIT_MS);
      next = Math.max(next, capped);
    }
  }

  return next;
}

function parseIntSafe(s: string | undefined): number | null {
  if (!s) return null;
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : null;
}

async function awaitNextSafeCallTime(): Promise<void> {
  const now = Date.now();
  const wait = nextSafeCallTime - now;
  if (wait > 0) {
    console.log(`[llm/anthropic] preemptive throttle ${wait}ms`);
    await sleep(wait);
  }
}

function recordRateLimit(headers: Record<string, string | undefined>): void {
  nextSafeCallTime = computeNextSafeCallTime(
    headers,
    Date.now(),
    nextSafeCallTime,
  );
}

/**
 * Exposed for tests so they can reset the module-level throttle state
 * between scenarios. Not intended for production callers.
 */
export function __resetAnthropicThrottleForTests(): void {
  nextSafeCallTime = 0;
}

// ─── Retry / backoff ──────────────────────────────────────────────────

/**
 * Sleep based on Anthropic's response headers. `retry-after` wins if set
 * (seconds), else fall back to the input-tokens reset header (ISO date).
 * Returns ms to wait, capped to a sane maximum.
 */
export function backoffMsFromHeaders(
  headers: Record<string, string | undefined>,
  attempt: number,
  now: number = Date.now(),
): number {
  const cap = 60_000;
  const retryAfter = headers["retry-after"];
  if (retryAfter) {
    const secs = parseFloat(retryAfter);
    if (!Number.isNaN(secs) && secs >= 0) return Math.min(cap, Math.ceil(secs * 1000));
  }
  const reset = headers["anthropic-ratelimit-input-tokens-reset"]
    || headers["anthropic-ratelimit-tokens-reset"];
  if (reset) {
    const t = Date.parse(reset);
    if (!Number.isNaN(t)) {
      const wait = t - now;
      if (wait > 0) return Math.min(cap, wait);
    }
  }
  // Exponential fallback: 1s, 2s, 4s, …
  return Math.min(cap, 1000 * 2 ** attempt);
}

const ANTHROPIC_VERSION = "2023-06-01";

function anthropicHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": ANTHROPIC_VERSION,
    "anthropic-beta": "prompt-caching-2024-07-31",
  };
}

function shouldRetry(status: number): boolean {
  return status === 429 || status === 529 || (status >= 500 && status < 600);
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function headersToObject(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => { out[k.toLowerCase()] = v; });
  return out;
}

// ─── Native Anthropic API calls ───────────────────────────────────────

export interface AnthropicCallOpts {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  messages: OAIMessage[];
  tools?: OAITool[];
  maxRetries?: number;
}

function buildAnthropicBody(opts: AnthropicCallOpts, stream: boolean): AnthropicRequest {
  const translated = translateToAnthropic(opts.messages, opts.tools);
  return {
    model: opts.model,
    max_tokens: opts.maxOutputTokens,
    temperature: opts.temperature,
    system: translated.system,
    messages: translated.messages,
    tools: translated.tools,
    stream,
  };
}

export async function anthropicChat(opts: AnthropicCallOpts): Promise<OAIChatResponse> {
  const url = `${opts.apiBaseUrl.replace(/\/v1\/?$/, "")}/v1/messages`;
  const body = JSON.stringify(buildAnthropicBody(opts, false));
  const maxRetries = opts.maxRetries ?? 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await awaitNextSafeCallTime();
    const abort = new AbortController();
    const timer = setTimeout(
      () => abort.abort(new Error("anthropicChat timed out after 3 min")),
      180_000,
    );
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: anthropicHeaders(opts.apiKey),
        body,
        signal: abort.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    recordRateLimit(headersToObject(res.headers));
    if (res.ok) {
      const json = (await res.json()) as AnthropicResponse;
      return translateAnthropicResponse(json);
    }
    const errBody = await res.text();
    if (attempt < maxRetries && shouldRetry(res.status)) {
      const wait = backoffMsFromHeaders(headersToObject(res.headers), attempt);
      console.warn(`[llm] Anthropic ${res.status}, retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(wait);
      continue;
    }
    throw new Error(`LLM API error ${res.status}: ${errBody}`);
  }
  throw new Error("LLM API: exhausted retries");
}

/**
 * Streaming Anthropic call. Returns a Response whose body is OpenAI-shape
 * SSE chunks, so the existing chat route consumer (data: {choices:[{delta}]})
 * works unchanged.
 */
export async function anthropicStream(opts: AnthropicCallOpts): Promise<Response> {
  const url = `${opts.apiBaseUrl.replace(/\/v1\/?$/, "")}/v1/messages`;
  const reqBody = buildAnthropicBody(opts, true);
  const body = JSON.stringify(reqBody);
  const maxRetries = opts.maxRetries ?? 3;

  console.log(
    `[llm/anthropic] stream → ${url} model=${opts.model} ` +
    `system_blocks=${reqBody.system?.length || 0} ` +
    `messages=${reqBody.messages.length} tools=${reqBody.tools?.length || 0} ` +
    `payload=${body.length}b`,
  );

  let upstream: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await awaitNextSafeCallTime();
    // Bound the *connection* time (headers) only — a valid streaming response
    // can legitimately run for many minutes, so we clear the timer as soon
    // as fetch resolves and let the body stream continue under the consumer's
    // control. Without this, a stalled Anthropic router never returns a
    // Response and the caller hangs forever.
    const connectAbort = new AbortController();
    const connectTimer = setTimeout(
      () => connectAbort.abort(new Error("anthropicStream connect timed out after 90s")),
      90_000,
    );
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: { ...anthropicHeaders(opts.apiKey), Accept: "text/event-stream" },
        body,
        signal: connectAbort.signal,
      });
    } finally {
      clearTimeout(connectTimer);
    }
    recordRateLimit(headersToObject(upstream.headers));
    if (upstream.ok) break;
    const errBody = await upstream.text();
    if (attempt < maxRetries && shouldRetry(upstream.status)) {
      const wait = backoffMsFromHeaders(headersToObject(upstream.headers), attempt);
      console.warn(`[llm/anthropic] ${upstream.status}, retrying in ${wait}ms (attempt ${attempt + 1}/${maxRetries})`);
      await sleep(wait);
      upstream = null;
      continue;
    }
    console.error(`[llm/anthropic] ${upstream.status} ${errBody.slice(0, 500)}`);
    throw new Error(`LLM API error ${upstream.status}: ${errBody}`);
  }
  if (!upstream || !upstream.body) throw new Error("LLM API: no response body");

  console.log(`[llm/anthropic] stream connected (status ${upstream.status})`);

  const translator = new AnthropicSSEToOpenAITranslator();
  translator.setModel(opts.model);

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalEvents = 0;
  let totalEnqueued = 0;

  const enc = new TextEncoder();
  const out = new ReadableStream({
    async pull(controller) {
      // Loop until we enqueue at least one chunk or upstream closes — a
      // bare ping/heartbeat shouldn't stall the consumer.
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[llm/anthropic] stream done — events=${totalEvents} chunks=${totalEnqueued}`);
          controller.enqueue(enc.encode("data: [DONE]\n\n"));
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        let enqueued = false;
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).replace(/^ /, "").trim();
          if (!data) continue;
          totalEvents++;
          try {
            const event = JSON.parse(data) as AnthropicStreamEvent;
            const chunks = translator.translate(event);
            for (const chunk of chunks) {
              controller.enqueue(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));
              enqueued = true;
              totalEnqueued++;
            }
          } catch (parseErr) {
            console.warn(`[llm/anthropic] parse error: ${(parseErr as Error).message} — line: ${line.slice(0, 200)}`);
          }
        }
        if (enqueued) return;
      }
    },
  });

  return new Response(out, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}
