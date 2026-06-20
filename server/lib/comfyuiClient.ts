import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { getUploadsDir } from "./config";
import { newId } from "./nanoid";
import { db, schema } from "../db/client";
import { eq, and } from "drizzle-orm";

// --- Node type detection sets ---

const PROMPT_NODE_TYPES = new Set([
  "CLIPTextEncode", "CLIPTextEncodeSDXL", "CLIPTextEncodeSD3",
  "CLIPTextEncodeFlux", "BNK_CLIPTextEncodeAdvanced",
]);

const OUTPUT_NODE_TYPES_IMAGE = new Set([
  "SaveImage", "PreviewImage", "Image Save",
]);

const OUTPUT_NODE_TYPES_VIDEO = new Set([
  "SaveAnimatedWEBP", "SaveAnimatedPNG", "VHS_VideoCombine", "SaveVideo",
]);

const IMAGE_INPUT_NODE_TYPES = new Set([
  "LoadImage", "LoadImageMask", "ImageReceiver", "LoadImageFromUrl",
]);

const SAMPLER_NODE_TYPES = new Set([
  "KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced",
]);

const CFG_NODE_TYPES = new Set([
  ...SAMPLER_NODE_TYPES,
  "CFGGuider", "DualCFGGuider",
]);

const LATENT_IMAGE_NODE_TYPES = new Set([
  "EmptyLatentImage", "EmptySD3LatentImage", "EmptySDXLLatentImage",
]);

const FRAME_COUNT_KEYS = new Set([
  "num_frames", "frames", "frame_count", "video_frames", "length",
  "num_video_frames", "frames_number",
]);

const VIDEO_LATENT_NODE_TYPES = new Set([
  "EmptyLTXVLatentVideo", "EmptyMochiLatentVideo", "EmptyHunyuanLatentVideo",
  "EmptyCosmosLatentVideo", "EmptyWanLatentVideo",
]);

const AUDIO_PROMPT_NODE_TYPES = new Set([
  "TextEncodeAceStepAudio1.5", "TextEncodeAceStepAudio",
]);

const AUDIO_LATENT_NODE_TYPES = new Set([
  "EmptyAceStep1.5LatentAudio", "EmptyAceStepLatentAudio",
]);

const OUTPUT_NODE_TYPES_AUDIO = new Set([
  "SaveAudioMP3", "SaveAudio", "SaveAudioWAV", "PreviewAudio",
]);

const AUDIO_DURATION_KEYS = new Set([
  "seconds", "duration",
]);

const TTS_NODE_TYPES = new Set([
  "VibeVoiceSingleSpeakerNode", "VibeVoiceMultiSpeakerNode",
]);

// String-primitive node types a workflow author may expose as the editable
// prompt entry. Some authors wire their CLIPTextEncode `text` input to one of
// these and rename the node "Prompt" so the user can edit it in one place;
// when the prompt is *not* wired through, only the title gives away intent.
const USER_PROMPT_PRIMITIVE_TYPES = new Set([
  "PrimitiveStringMultiline", "PrimitiveString",
  "StringConstantMultiline", "String", "StringFunction",
]);

// Match titles the workflow author uses to mark the editable user prompt.
// Accepts "Prompt", "User Prompt", "Positive Prompt", "Main Prompt" — but
// not "Negative Prompt", which we never want to overwrite.
const USER_PROMPT_TITLE_RE = /^\s*(?:user|positive|main)?\s*prompt\s*$/i;

// Titles workflow authors give to the duration / frame-rate primitives that
// feed a ComfyMathExpression producing the latent frame count. Compared
// case-insensitively after trimming.
const DURATION_TITLES = new Set([
  "duration", "length", "seconds", "video duration", "clip duration",
]);
const FRAME_RATE_TITLES = new Set([
  "frame rate", "framerate", "fps", "frames per second",
]);

/**
 * Parse a ComfyMathExpression of the form `a*b`, `a*b+N`, or `a*b-N` and
 * return the additive offset (so `frames = duration * fps + offset`). Returns
 * null for any expression we don't recognize — the caller falls back to
 * leaving frames unchanged rather than guessing.
 */
function parseFrameMathExpression(expr: string): { offset: number } | null {
  const stripped = expr.replace(/\s+/g, "");
  const m = stripped.match(/^a\*b([+-]\d+)?$/);
  if (!m) return null;
  return { offset: m[1] ? parseInt(m[1], 10) : 0 };
}

/**
 * Given a ComfyMathExpression node id, find which referenced primitive carries
 * the duration value and which carries the frame rate, identified by their
 * `_meta.title` (the convention workflow authors use to label these knobs).
 * Returns the current values plus the duration node id so callers can either
 * read the resolved frame count or write a new one back.
 */
function resolveMathChain(
  wf: Record<string, any>,
  mathNodeId: string,
): {
  durationNodeId: string | null;
  durationValue: number | null;
  durationKind: "float" | "int";
  fps: number | null;
  offset: number;
} | null {
  const math = wf[mathNodeId];
  if (!math?.inputs || typeof math.inputs.expression !== "string") return null;
  const parsed = parseFrameMathExpression(math.inputs.expression);
  if (!parsed) return null;

  let durationNodeId: string | null = null;
  let durationValue: number | null = null;
  let durationKind: "float" | "int" = "float";
  let fps: number | null = null;

  for (const [, val] of Object.entries(math.inputs)) {
    if (!Array.isArray(val) || typeof val[0] !== "string") continue;
    const ref = wf[val[0]];
    const title = String(ref?._meta?.title || "").toLowerCase().trim();
    if (!title) continue;
    if (DURATION_TITLES.has(title)) {
      durationNodeId = val[0];
      durationKind = ref.class_type === "PrimitiveInt" ? "int" : "float";
      if (typeof ref.inputs?.value === "number") durationValue = ref.inputs.value;
    } else if (FRAME_RATE_TITLES.has(title)) {
      if (typeof ref.inputs?.value === "number") fps = ref.inputs.value;
    }
  }

  if (!durationNodeId || fps === null) return null;
  return { durationNodeId, durationValue, durationKind, fps, offset: parsed.offset };
}

const VOICE_INPUT_NODE_TYPES = new Set([
  "LoadAudio",
]);

const AUDIO_INPUT_NODE_TYPES = new Set([
  "VHS_LoadAudioUpload", "VHS_LoadAudio", "LoadAudio",
]);

const DISABLED_WORKFLOWS_KEY = "disabledWorkflowIds";

// --- Config helpers ---

/** Strip trailing slashes so `${baseUrl}/prompt` never produces a `//prompt`
 *  double slash — ComfyUI's router answers `//prompt` with 405 Method Not Allowed. */
export function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function getComfyConfig(): Promise<Record<string, string>> {
  const rows = await db.select().from(schema.pluginConfigs)
    .where(eq(schema.pluginConfigs.pluginId, "comfyui"));
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;
  if (map.baseUrl) map.baseUrl = normalizeBaseUrl(map.baseUrl);
  return map;
}

export async function setComfyConfig(key: string, value: string) {
  const now = new Date().toISOString();
  const existing = await db.select().from(schema.pluginConfigs)
    .where(and(eq(schema.pluginConfigs.pluginId, "comfyui"), eq(schema.pluginConfigs.key, key)));
  if (existing.length > 0) {
    await db.update(schema.pluginConfigs).set({ value, updatedAt: now })
      .where(eq(schema.pluginConfigs.id, existing[0].id));
  } else {
    await db.insert(schema.pluginConfigs).values({
      id: newId(), pluginId: "comfyui", key, value, updatedAt: now,
    });
  }
}

export function parseWorkflowIdList(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string" && item.length > 0);
  } catch {
    return [];
  }
}

export async function getComfyDisabledWorkflowIds(): Promise<Set<string>> {
  const config = await getComfyConfig();
  return new Set(parseWorkflowIdList(config[DISABLED_WORKFLOWS_KEY]));
}

export async function setComfyDisabledWorkflowIds(workflowIds: string[]) {
  const uniqueIds = Array.from(new Set(workflowIds.filter(Boolean))).sort();
  await setComfyConfig(DISABLED_WORKFLOWS_KEY, JSON.stringify(uniqueIds));
}

// --- Workflow analysis ---

export interface WorkflowAnalysis {
  promptNodeId: string | null;
  outputNodeId: string | null;
  imageInputNodeId: string | null;
  audioInputNodeId: string | null;
  voiceInputNodeId: string | null;
  suggestedType: "t2v" | "i2v" | "t2i" | "i2i" | "t2m" | "tts" | "ia2v" | "fflf";
  endImageInputNodeId: string | null;
  width: number | null;
  height: number | null;
  cfg: number | null;
  frames: number | null;
  details: string[];
}

export function analyzeWorkflow(workflowJson: string): WorkflowAnalysis {
  const details: string[] = [];
  let promptNodeId: string | null = null;
  let outputNodeId: string | null = null;
  let imageInputNodeId: string | null = null;
  let endImageInputNodeId: string | null = null;
  let width: number | null = null;
  let height: number | null = null;
  let cfg: number | null = null;
  let frames: number | null = null;
  let audioInputNodeId: string | null = null;
  let voiceInputNodeId: string | null = null;
  let hasVideoOutput = false;
  let hasImageInput = false;
  let hasAudioInput = false;
  let hasAudioOutput = false;
  let hasAudioPromptNode = false;
  let hasTTSNode = false;
  // Track every image-input node we encounter so FFLF workflows (which carry
  // two LoadImage nodes — one for the first frame, one for the last) can be
  // classified by node count rather than by node-title heuristics.
  const imageInputNodeIds: string[] = [];

  let workflow: Record<string, {
    class_type?: string;
    inputs?: Record<string, unknown>;
    _meta?: { title?: string };
  }>;
  try { workflow = JSON.parse(workflowJson); } catch {
    return { promptNodeId, outputNodeId, imageInputNodeId, endImageInputNodeId, audioInputNodeId, voiceInputNodeId, suggestedType: "t2i", width, height, cfg, frames, details: ["Invalid JSON"] };
  }

  // Highest-priority prompt signal: a string-primitive node whose title the
  // author set to "Prompt" (or "User Prompt", "Positive Prompt", etc.). When
  // present, these are the workflow's intended user-facing prompt slot — the
  // CLIPTextEncode `text` inputs are usually hardcoded scaffolding the author
  // doesn't expect callers to edit, so we want to inject the user's prompt
  // here even when the primitive isn't wired into a CLIP encoder in the JSON
  // (orphaned-but-titled primitives are a common ComfyUI authoring pattern).
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!node.class_type || !USER_PROMPT_PRIMITIVE_TYPES.has(node.class_type)) continue;
    const title = node._meta?.title;
    if (typeof title !== "string" || !USER_PROMPT_TITLE_RE.test(title)) continue;
    promptNodeId = nodeId;
    details.push(`Prompt (user-titled primitive "${title}"): ${node.class_type} (node ${nodeId})`);
    break;
  }

  // Collect CFG values across all sampler/guider nodes so we can detect
  // multi-stage pipelines (base + refiner, etc.) and avoid auto-populating
  // a single defaultCfg that would later clobber per-stage values.
  const cfgValues: number[] = [];

  // First pass: trace connections to identify which prompt nodes feed into "positive" vs "negative" inputs.
  // This prevents picking the negative prompt node when multiple CLIPTextEncode nodes exist.
  const positivePromptNodeIds = new Set<string>();
  const negativePromptNodeIds = new Set<string>();
  for (const [, node] of Object.entries(workflow)) {
    if (!node.inputs) continue;
    for (const [inputName, inputVal] of Object.entries(node.inputs)) {
      if (!Array.isArray(inputVal) || typeof inputVal[0] !== "string") continue;
      const refNodeId = inputVal[0];
      const refNode = workflow[refNodeId];
      if (!refNode?.class_type || !PROMPT_NODE_TYPES.has(refNode.class_type)) continue;
      if (inputName === "positive") positivePromptNodeIds.add(refNodeId);
      if (inputName === "negative") negativePromptNodeIds.add(refNodeId);
    }
  }

  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!node.class_type) continue;

    // Audio prompt nodes (e.g. TextEncodeAceStepAudio1.5 with tags + lyrics)
    if (AUDIO_PROMPT_NODE_TYPES.has(node.class_type) && !promptNodeId) {
      promptNodeId = nodeId;
      hasAudioPromptNode = true;
      details.push(`Audio prompt: ${node.class_type} (node ${nodeId})`);
    }

    // Standard prompt nodes — prefer nodes connected to a "positive" input,
    // skip nodes connected only to a "negative" input
    if (PROMPT_NODE_TYPES.has(node.class_type) && !promptNodeId) {
      if (!negativePromptNodeIds.has(nodeId) || positivePromptNodeIds.has(nodeId)) {
        promptNodeId = nodeId;
        details.push(`Prompt: ${node.class_type} (node ${nodeId})`);
      }
    }

    // Audio output nodes
    if (OUTPUT_NODE_TYPES_AUDIO.has(node.class_type)) {
      if (!outputNodeId) outputNodeId = nodeId;
      hasAudioOutput = true;
      details.push(`Audio output: ${node.class_type} (node ${nodeId})`);
    }

    // Image/video output nodes
    if (OUTPUT_NODE_TYPES_IMAGE.has(node.class_type) || OUTPUT_NODE_TYPES_VIDEO.has(node.class_type)) {
      if (!outputNodeId) outputNodeId = nodeId;
      if (OUTPUT_NODE_TYPES_VIDEO.has(node.class_type)) hasVideoOutput = true;
      details.push(`Output: ${node.class_type} (node ${nodeId})`);
    }

    // TTS nodes (VibeVoice etc.) — these have a text field, not a CLIP prompt
    if (TTS_NODE_TYPES.has(node.class_type) && !promptNodeId) {
      promptNodeId = nodeId;
      hasTTSNode = true;
      details.push(`TTS: ${node.class_type} (node ${nodeId})`);
    }

    // Voice input nodes (LoadAudio used as voice clone source)
    if (VOICE_INPUT_NODE_TYPES.has(node.class_type) && !voiceInputNodeId) {
      // Check if this LoadAudio is referenced as a voice_to_clone input
      voiceInputNodeId = nodeId;
      details.push(`Voice input: ${node.class_type} (node ${nodeId})`);
    }

    // Audio input nodes (VHS_LoadAudioUpload etc. for IA2V workflows)
    if (AUDIO_INPUT_NODE_TYPES.has(node.class_type) && !audioInputNodeId) {
      audioInputNodeId = nodeId;
      hasAudioInput = true;
      details.push(`Audio input: ${node.class_type} (node ${nodeId})`);
    }

    // Image input nodes
    if (IMAGE_INPUT_NODE_TYPES.has(node.class_type)) {
      if (!imageInputNodeId) imageInputNodeId = nodeId;
      else if (!endImageInputNodeId) endImageInputNodeId = nodeId;
      imageInputNodeIds.push(nodeId);
      hasImageInput = true;
      details.push(`Image input: ${node.class_type} (node ${nodeId})`);
    }

    // Sampler / CFGGuider → CFG. Collect all values; resolve after the loop.
    if (CFG_NODE_TYPES.has(node.class_type) && node.inputs && typeof node.inputs.cfg === "number") {
      cfgValues.push(node.inputs.cfg as number);
    }

    // Latent image → resolution
    if (LATENT_IMAGE_NODE_TYPES.has(node.class_type) && node.inputs) {
      if (typeof node.inputs.width === "number") width = node.inputs.width as number;
      if (typeof node.inputs.height === "number") height = node.inputs.height as number;
    }
  }

  // Fallback: if we have a known positive prompt from connection tracing but
  // it wasn't picked above (e.g. the negative node came first and was skipped,
  // but the positive node was also somehow missed), use it directly.
  if (!promptNodeId && positivePromptNodeIds.size > 0) {
    promptNodeId = positivePromptNodeIds.values().next().value!;
    details.push(`Prompt (from connection trace): node ${promptNodeId}`);
  }

  // Resolve CFG. A defaultCfg is only safe when every sampler in the workflow
  // already uses the same value; otherwise `overrideSamplerParams` would force
  // every stage to a single cfg and break multi-stage pipelines (e.g. CHROMA
  // base at cfg=4 + ZIT refiner at cfg=1). Leave null in that case.
  if (cfgValues.length === 1) {
    cfg = cfgValues[0];
  } else if (cfgValues.length > 1) {
    const unique = Array.from(new Set(cfgValues));
    if (unique.length === 1) {
      cfg = unique[0];
    } else {
      details.push(`Multi-sampler workflow with differing CFG values [${cfgValues.join(", ")}] — leaving defaultCfg unset`);
    }
  }

  // Detect frames
  for (const [, node] of Object.entries(workflow)) {
    if (!node.inputs) continue;
    for (const key of Object.keys(node.inputs)) {
      const baseName = key.includes(".") ? key.split(".").pop()! : key;
      if (FRAME_COUNT_KEYS.has(baseName) && typeof node.inputs[key] === "number" && (node.inputs[key] as number) > 1) {
        frames = node.inputs[key] as number;
        break;
      }
    }
    if (frames) break;
  }

  // Frames fallback: some workflows (LTX with audio) compute frame count via
  // a ComfyMathExpression node like `a * b + 1` where `a` = Duration and
  // `b` = Frame Rate primitives. The first pass sees only the array ref and
  // gives up; walk one level deeper to read the resolved count from the
  // chain so the UI shows the right default.
  if (!frames) {
    for (const [, node] of Object.entries(workflow)) {
      if (!node.inputs) continue;
      for (const [key, val] of Object.entries(node.inputs)) {
        const baseName = key.includes(".") ? key.split(".").pop()! : key;
        if (!FRAME_COUNT_KEYS.has(baseName)) continue;
        if (!Array.isArray(val) || typeof val[0] !== "string") continue;
        const resolved = resolveMathChain(workflow as Record<string, any>, val[0]);
        if (!resolved || resolved.durationValue === null) continue;
        const computed = resolved.durationValue * resolved.fps! + resolved.offset;
        if (computed > 1) {
          frames = Math.round(computed);
          details.push(`Frames (math chain): ${resolved.durationValue}s × ${resolved.fps} + ${resolved.offset} = ${frames}`);
          break;
        }
      }
      if (frames) break;
    }
  }

  // Also check resolution on non-latent nodes (for video workflows)
  if (!width || !height) {
    for (const [, node] of Object.entries(workflow)) {
      if (!node.inputs) continue;
      if (typeof node.inputs.width === "number" && typeof node.inputs.height === "number") {
        width = node.inputs.width as number;
        height = node.inputs.height as number;
        break;
      }
    }
  }

  // FFLF heuristic: a video workflow with two distinct image-input nodes is
  // almost always a first-frame/last-frame setup. We treat the second
  // image-input as the end-frame slot. Users can still override the type in
  // Settings if a particular workflow uses the second LoadImage for something
  // else (e.g. a control map).
  const isFFLF = hasVideoOutput && imageInputNodeIds.length >= 2;

  const suggestedType = hasTTSNode
    ? "tts"
    : (hasAudioOutput || hasAudioPromptNode)
      ? "t2m"
      : hasVideoOutput
        ? (isFFLF ? "fflf" : hasImageInput && hasAudioInput ? "ia2v" : hasImageInput ? "i2v" : "t2v")
        : (hasImageInput ? "i2i" : "t2i");

  return { promptNodeId, outputNodeId, imageInputNodeId, endImageInputNodeId, audioInputNodeId, voiceInputNodeId, suggestedType, width, height, cfg, frames, details };
}

// --- Workflow preparation helpers ---

export interface GenerationParams {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  frames?: number;
  sourceImagePath?: string;
  cfg?: number;
  steps?: number;
  seed?: number;
  // Audio/music-specific
  tags?: string;
  lyrics?: string;
  duration?: number;
  // TTS-specific
  voiceFilePath?: string;
  // IA2V-specific
  sourceAudioPath?: string;
  // FFLF-specific: last-frame image fed to the second LoadImage node
  endImagePath?: string;
  // Ideogram-style structured-JSON prompt: write the prompt verbatim (no
  // smart-quote rewriting, no postfix suffix) so the JSON document stays valid.
  rawPrompt?: boolean;
  // Aspect-ratio string (e.g. "16:9") for Ideogram nodes that expose an
  // `aspect_ratio` / `resolution` input instead of latent width/height.
  aspectRatio?: string;
  // Megapixel target for Ideogram nodes that expose a `megapixels` input.
  megapixels?: number;
}

/**
 * Replace smart quotes and dashes with their ASCII equivalents.
 */
export function sanitizePromptText(text: string): string {
  return text
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u2013\u2014]/g, "-");
}

/**
 * Inject the user prompt into the designated prompt node. Mutates wf in place.
 */
export function injectPrompt(
  wf: Record<string, any>,
  promptNodeId: string,
  prompt: string,
  postfix: string,
  isAudioPrompt: boolean,
  audioParams?: { tags?: string; lyrics?: string; duration?: number },
  opts?: { raw?: boolean },
): void {
  if (!wf[promptNodeId]?.inputs) return;

  const nodeInputs = wf[promptNodeId].inputs;

  // Raw mode: write the prompt verbatim into the node's text input. Used for
  // Ideogram-style JSON prompts where sanitizePromptText (smart-quote/dash
  // rewriting) and the `, postfix` suffix would corrupt the JSON document.
  if (opts?.raw) {
    if ("text" in nodeInputs) {
      nodeInputs.text = prompt;
    } else {
      for (const key of Object.keys(nodeInputs)) {
        if (typeof nodeInputs[key] === "string") {
          nodeInputs[key] = prompt;
          break;
        }
      }
    }
    return;
  }

  const sanitized = sanitizePromptText(prompt);
  const fullPrompt = postfix ? `${sanitized}, ${postfix}` : sanitized;

  if (isAudioPrompt) {
    // Audio prompt nodes have separate tags (style) and lyrics fields
    if ("tags" in nodeInputs) {
      nodeInputs.tags = audioParams?.tags || fullPrompt;
    }
    if ("lyrics" in nodeInputs) {
      nodeInputs.lyrics = audioParams?.lyrics ?? (nodeInputs.lyrics as string) ?? "";
    }
    // Duration on the prompt node itself
    if ("duration" in nodeInputs && audioParams?.duration) {
      nodeInputs.duration = audioParams.duration;
    }
  } else if ("text" in nodeInputs) {
    nodeInputs.text = fullPrompt;
  } else {
    for (const key of Object.keys(nodeInputs)) {
      if (typeof nodeInputs[key] === "string") {
        nodeInputs[key] = fullPrompt;
        break;
      }
    }
  }
}

/**
 * For Ideogram-style ComfyUI nodes that take an `aspect_ratio` enum and/or a
 * `resolution` string ("1024x1024") instead of latent width/height, set those
 * inputs from the project's aspect ratio + computed dimensions. A no-op on
 * standard t2i workflows that don't expose those inputs. Mutates wf in place.
 */
// Some ComfyUI sizing nodes (e.g. ResolutionSelector in the Ideogram4 workflow)
// use a labeled COMBO for aspect_ratio like "4:3 (Standard)" rather than the bare
// "4:3". Map our ratio strings to those labels so we set a valid enum value; bare
// ratio for the rest. Ratios with no known label are left untouched on labeled
// combos (rather than writing an invalid value that ComfyUI rejects).
const IDEOGRAM_ASPECT_LABELS: Record<string, string> = {
  "1:1": "Square",
  "3:2": "Photo",
  "4:3": "Standard",
  "16:9": "Widescreen",
  "21:9": "Ultrawide",
  "2:3": "Portrait Photo",
  "3:4": "Portrait Standard",
  "9:16": "Portrait Widescreen",
};

export function overrideIdeogramSize(
  wf: Record<string, any>,
  aspectRatio: string,
  width?: number,
  height?: number,
  megapixels?: number,
): void {
  for (const [, node] of Object.entries(wf) as [string, any][]) {
    if (!node.inputs) continue;
    if (typeof node.inputs.aspect_ratio === "string") {
      const current = node.inputs.aspect_ratio;
      if (current.includes("(")) {
        // Labeled combo — only set if we know the matching label, else leave as-is.
        const label = IDEOGRAM_ASPECT_LABELS[aspectRatio];
        if (label) node.inputs.aspect_ratio = `${aspectRatio} (${label})`;
      } else {
        node.inputs.aspect_ratio = aspectRatio;
      }
    }
    if (typeof node.inputs.resolution === "string" && width && height) {
      node.inputs.resolution = `${width}x${height}`;
    }
    if (megapixels && typeof node.inputs.megapixels === "number") {
      node.inputs.megapixels = megapixels;
    }
  }
}

/**
 * Override width/height on all nodes that have both. Mutates wf in place.
 */
export function overrideResolution(
  wf: Record<string, any>,
  width?: number,
  height?: number,
): void {
  if (!width && !height) return;
  for (const [, node] of Object.entries(wf) as [string, any][]) {
    if (!node.inputs) continue;
    if (typeof node.inputs.width === "number" && typeof node.inputs.height === "number") {
      if (width) node.inputs.width = width;
      if (height) node.inputs.height = height;
    }
  }
}

/**
 * Override frame counts, including primitive node references for video latent nodes.
 * Mutates wf in place.
 */
export function overrideFrames(
  wf: Record<string, any>,
  frames: number,
): void {
  if (!frames || frames <= 0) return;

  for (const [, node] of Object.entries(wf) as [string, any][]) {
    if (!node.inputs) continue;
    for (const key of Object.keys(node.inputs)) {
      const baseName = key.includes(".") ? key.split(".").pop()! : key;
      if (FRAME_COUNT_KEYS.has(baseName) && typeof node.inputs[key] === "number") {
        node.inputs[key] = frames;
      }
    }
  }
  // Also check primitive node references. Two shapes:
  //   (a) Direct primitive: latent.length → PrimitiveInt.value — set value.
  //   (b) Math chain: latent.length → ComfyMathExpression(a*b[+N])
  //       where a = Duration primitive, b = Frame Rate primitive. Invert the
  //       expression and set Duration so both video and audio latents
  //       sharing the same math node stay in sync.
  // We collect math-node ids and dedupe so we only invert each chain once.
  const seenMathNodes = new Set<string>();
  for (const [, node] of Object.entries(wf) as [string, any][]) {
    if (!node.inputs) continue;
    const isVideoLatent = node.class_type && VIDEO_LATENT_NODE_TYPES.has(node.class_type);
    for (const [key, val] of Object.entries(node.inputs)) {
      const baseName = key.includes(".") ? key.split(".").pop()! : key;
      if (!FRAME_COUNT_KEYS.has(baseName)) continue;
      if (!Array.isArray(val) || typeof val[0] !== "string") continue;
      const refNode = wf[val[0]];
      if (!refNode) continue;

      // (a) Direct primitive — keep the original behavior (only on video-latent
      //     parents, matching the prior scope).
      if (isVideoLatent && refNode.inputs && typeof refNode.inputs.value === "number") {
        refNode.inputs.value = frames;
        continue;
      }

      // (b) Math chain — applies whether the parent is a video or audio latent.
      if (refNode.class_type === "ComfyMathExpression" && !seenMathNodes.has(val[0])) {
        const resolved = resolveMathChain(wf, val[0]);
        if (!resolved) continue;
        seenMathNodes.add(val[0]);
        const targetVal = (frames - resolved.offset) / resolved.fps!;
        const dur = wf[resolved.durationNodeId!];
        if (!dur?.inputs) continue;
        dur.inputs.value = resolved.durationKind === "int" ? Math.round(targetVal) : targetVal;
      }
    }
  }
}

/**
 * Override CFG, steps, and seed on sampler/noise nodes. Mutates wf in place.
 * Seed is randomized if not provided.
 */
export function overrideSamplerParams(
  wf: Record<string, any>,
  cfg?: number | null,
  steps?: number,
  seed?: number,
): void {
  // Override CFG (on samplers and CFGGuider nodes)
  if (cfg !== undefined && cfg !== null) {
    for (const [, node] of Object.entries(wf) as [string, any][]) {
      if (node.class_type && CFG_NODE_TYPES.has(node.class_type) && node.inputs && "cfg" in node.inputs) {
        node.inputs.cfg = cfg;
      }
    }
  }

  // Override steps
  if (steps && steps > 0) {
    for (const [, node] of Object.entries(wf) as [string, any][]) {
      if (node.class_type && SAMPLER_NODE_TYPES.has(node.class_type) && node.inputs && "steps" in node.inputs) {
        node.inputs.steps = steps;
      }
    }
  }

  // Randomize / set seeds
  for (const [, node] of Object.entries(wf) as [string, any][]) {
    if (!node.class_type || !node.inputs) continue;
    if (SAMPLER_NODE_TYPES.has(node.class_type) || node.class_type === "RandomNoise") {
      for (const key of ["seed", "noise_seed"]) {
        if (key in node.inputs) {
          node.inputs[key] = seed ?? Math.floor(Math.random() * 2 ** 32);
        }
      }
    }
  }
}

/**
 * Re-analyze the workflow JSON to fill in missing node IDs from the DB row.
 * Returns resolved node IDs.
 */
export function resolveNodeIds(
  workflowJson: string,
  workflowRow: { promptNodeId?: string | null; outputNodeId?: string | null; imageInputNodeId?: string | null; endImageInputNodeId?: string | null; audioInputNodeId?: string | null; voiceInputNodeId?: string | null },
): { promptNodeId: string | null; imageInputNodeId: string | null; endImageInputNodeId: string | null; audioInputNodeId: string | null; voiceInputNodeId: string | null } {
  let promptNodeId = workflowRow.promptNodeId ?? null;
  let imageInputNodeId = workflowRow.imageInputNodeId ?? null;
  let endImageInputNodeId = workflowRow.endImageInputNodeId ?? null;
  let audioInputNodeId = workflowRow.audioInputNodeId ?? null;
  let voiceInputNodeId = workflowRow.voiceInputNodeId ?? null;

  if (!promptNodeId || !workflowRow.outputNodeId) {
    const analysis = analyzeWorkflow(workflowJson);
    if (!promptNodeId) promptNodeId = analysis.promptNodeId;
    if (!imageInputNodeId) imageInputNodeId = analysis.imageInputNodeId;
    if (!endImageInputNodeId) endImageInputNodeId = analysis.endImageInputNodeId;
    if (!audioInputNodeId) audioInputNodeId = analysis.audioInputNodeId;
    if (!voiceInputNodeId) voiceInputNodeId = analysis.voiceInputNodeId;
    if (promptNodeId) {
      console.log(`[comfyui] Re-analyzed workflow: promptNodeId=${promptNodeId}, type=${analysis.suggestedType}`);
    }
  }

  return { promptNodeId, imageInputNodeId, endImageInputNodeId, audioInputNodeId, voiceInputNodeId };
}

// --- Workflow preparation (orchestrator) ---

export async function prepareWorkflow(
  workflowJson: string,
  params: GenerationParams,
  workflowRow: { promptNodeId?: string | null; outputNodeId?: string | null; imageInputNodeId?: string | null; endImageInputNodeId?: string | null; audioInputNodeId?: string | null; voiceInputNodeId?: string | null; defaultVoiceFile?: string | null; postfix?: string | null; defaultCfg?: number | null },
  baseUrl: string,
): Promise<Record<string, any>> {
  const wf = JSON.parse(workflowJson);

  // Resolve missing node IDs via re-analysis
  const { promptNodeId, imageInputNodeId, endImageInputNodeId, audioInputNodeId, voiceInputNodeId } =
    resolveNodeIds(workflowJson, workflowRow);

  console.log(`[comfyui] prepareWorkflow: promptNode=${promptNodeId}, imageNode=${imageInputNodeId}, endImageNode=${endImageInputNodeId}, audioNode=${audioInputNodeId}, hasImage=${!!params.sourceImagePath}, hasEndImage=${!!params.endImagePath}, hasAudio=${!!params.sourceAudioPath}`);

  // Inject prompt
  if (promptNodeId) {
    const isAudioPrompt = !!(wf[promptNodeId]?.class_type && AUDIO_PROMPT_NODE_TYPES.has(wf[promptNodeId].class_type!));
    injectPrompt(wf, promptNodeId, params.prompt, workflowRow.postfix || "", isAudioPrompt, {
      tags: params.tags,
      lyrics: params.lyrics,
      duration: params.duration,
    }, { raw: params.rawPrompt });
  }

  // Inject negative prompt into all negative-connected CLIPTextEncode nodes
  if (params.negativePrompt) {
    for (const [, node] of Object.entries(wf) as [string, any][]) {
      if (!node.inputs) continue;
      // Find nodes that have a "negative" input referencing a prompt node
      if (Array.isArray(node.inputs.negative) && typeof node.inputs.negative[0] === "string") {
        const negNodeId = node.inputs.negative[0];
        const negNode = wf[negNodeId];
        if (negNode?.class_type && PROMPT_NODE_TYPES.has(negNode.class_type) && negNode.inputs?.text !== undefined) {
          negNode.inputs.text = sanitizePromptText(params.negativePrompt);
          console.log(`[comfyui] Injected negative prompt into node ${negNodeId}`);
        }
      }
    }
  }

  // Override audio duration on latent audio nodes
  if (params.duration && params.duration > 0) {
    for (const [, node] of Object.entries(wf) as [string, any][]) {
      if (!node.class_type || !node.inputs) continue;
      if (AUDIO_LATENT_NODE_TYPES.has(node.class_type) || AUDIO_INPUT_NODE_TYPES.has(node.class_type)) {
        for (const key of Object.keys(node.inputs)) {
          if (AUDIO_DURATION_KEYS.has(key) && typeof node.inputs[key] === "number") {
            node.inputs[key] = params.duration;
          }
        }
      }
    }
  }

  // Override resolution
  overrideResolution(wf, params.width, params.height);

  // Ideogram-style nodes expose `aspect_ratio` / `resolution` / `megapixels`
  // inputs instead of latent width/height. No-op on standard t2i workflows.
  if (params.aspectRatio) {
    overrideIdeogramSize(wf, params.aspectRatio, params.width, params.height, params.megapixels);
  }

  // Override frames
  if (params.frames) {
    overrideFrames(wf, params.frames);
  }

  // Override CFG, steps, and seed
  // CFG is overridden ONLY when the caller explicitly passes one (e.g. a
  // regenerate with an override field). We deliberately do NOT fall back to
  // `workflowRow.defaultCfg` here — that silent fallback would force every
  // sampler in the workflow to a single value and break multi-stage
  // pipelines whose stages run at intentionally different CFGs (e.g. CHROMA
  // base at 4 + ZIT refiner at 1). The workflow JSON's own per-sampler cfg
  // values are the source of truth on first-time runs.
  overrideSamplerParams(wf, params.cfg ?? null, params.steps, params.seed);

  // Upload source image for i2v/i2i/ia2v/fflf
  if (params.sourceImagePath && imageInputNodeId) {
    const comfyFilename = await uploadImage(baseUrl, params.sourceImagePath);
    const imageNode = wf[imageInputNodeId];
    if (imageNode?.inputs) {
      imageNode.inputs.image = comfyFilename;
      console.log(`[comfyui] Injected source image "${comfyFilename}" into node ${imageInputNodeId}`);
    }
  }

  // Upload end-frame image for fflf workflows
  if (params.endImagePath && endImageInputNodeId) {
    const comfyFilename = await uploadImage(baseUrl, params.endImagePath);
    const endNode = wf[endImageInputNodeId];
    if (endNode?.inputs) {
      endNode.inputs.image = comfyFilename;
      console.log(`[comfyui] Injected end-frame image "${comfyFilename}" into node ${endImageInputNodeId}`);
    }
  }

  // Upload source audio for ia2v workflows
  if (params.sourceAudioPath && audioInputNodeId) {
    const comfyFilename = await uploadAudio(baseUrl, params.sourceAudioPath);
    const audioNode = wf[audioInputNodeId];
    if (audioNode?.inputs) {
      audioNode.inputs.audio = comfyFilename;
      console.log(`[comfyui] Injected source audio "${comfyFilename}" into node ${audioInputNodeId}`);
    }
  }

  // Upload voice file for TTS workflows
  if (voiceInputNodeId) {
    const voicePath = params.voiceFilePath || workflowRow.defaultVoiceFile;
    if (voicePath) {
      const comfyFilename = await uploadAudio(baseUrl, voicePath);
      const voiceNode = wf[voiceInputNodeId];
      if (voiceNode?.inputs) {
        voiceNode.inputs.audio = comfyFilename;
        console.log(`[comfyui] Injected voice file "${comfyFilename}" into node ${voiceInputNodeId}`);
      }
    }
  }

  return wf;
}

// --- ComfyUI API functions ---

export async function uploadImage(baseUrl: string, imagePath: string): Promise<string> {
  const fileBuffer = readFileSync(imagePath);
  const filename = imagePath.split("/").pop() || "input.png";
  const blob = new Blob([fileBuffer], { type: "image/png" });
  const formData = new FormData();
  formData.append("image", blob, filename);

  const res = await fetch(`${baseUrl}/upload/image`, { method: "POST", body: formData });
  if (!res.ok) throw new Error(`ComfyUI image upload failed: ${await res.text()}`);
  const result = await res.json();
  return result.name;
}

export async function uploadAudio(baseUrl: string, audioPath: string): Promise<string> {
  const fileBuffer = readFileSync(audioPath);
  const filename = audioPath.split("/").pop() || "input.mp3";
  const ext = filename.split(".").pop() || "mp3";
  const mimeType = ext === "wav" ? "audio/wav" : ext === "flac" ? "audio/flac" : "audio/mpeg";
  const blob = new Blob([fileBuffer], { type: mimeType });
  const formData = new FormData();
  formData.append("image", blob, filename);

  const res = await fetch(`${baseUrl}/upload/image`, { method: "POST", body: formData });
  if (!res.ok) throw new Error(`ComfyUI audio upload failed: ${await res.text()}`);
  const result = await res.json();
  return result.name;
}

export async function queueWorkflow(baseUrl: string, workflow: Record<string, any>): Promise<string> {
  const clientId = `videditor-${newId().slice(0, 8)}`;
  const res = await fetch(`${baseUrl}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`ComfyUI queue failed: ${errText}`);
  }

  const result = await res.json();
  return result.prompt_id;
}

export async function pollForCompletion(
  baseUrl: string,
  promptId: string,
  outputNodeId?: string,
  timeout: number = 60 * 60 * 1000,
): Promise<{ filename: string; subfolder: string; type: string }> {
  const startTime = Date.now();
  let pollCount = 0;

  while (Date.now() - startTime < timeout) {
    await new Promise((r) => setTimeout(r, 2000));
    pollCount++;

    if (pollCount % 5 === 1) {
      console.log(`[comfyui] Poll #${pollCount} for ${promptId} (${Math.round((Date.now() - startTime) / 1000)}s)`);
    }

    let historyRes: Response;
    try {
      historyRes = await fetch(`${baseUrl}/history/${promptId}`, { signal: AbortSignal.timeout(10000) });
    } catch { continue; }
    if (!historyRes.ok) continue;

    const history = await historyRes.json();
    const entry = history[promptId];
    if (!entry) continue;

    if (entry.status?.status_str === "error") {
      throw new Error(`ComfyUI generation failed: ${JSON.stringify(entry.status)}`);
    }

    const outputs = entry.outputs;
    if (!outputs) continue;

    // Find output with images, gifs, videos, or audio
    const OUTPUT_KEYS = ["images", "gifs", "videos", "audio"] as const;
    let outputData: any = null;
    let outputKey: string = "images";
    if (outputNodeId && outputs[outputNodeId]) {
      for (const key of OUTPUT_KEYS) {
        if (outputs[outputNodeId]?.[key]?.length > 0) {
          outputData = outputs[outputNodeId];
          outputKey = key;
          break;
        }
      }
    }
    if (!outputData) {
      for (const nodeId of Object.keys(outputs)) {
        for (const key of OUTPUT_KEYS) {
          if (outputs[nodeId]?.[key]?.length > 0) {
            outputData = outputs[nodeId];
            outputKey = key;
            break;
          }
        }
        if (outputData) break;
      }
    }

    if (!outputData?.[outputKey]?.length) continue;

    const result = outputData[outputKey][0];
    console.log(`[comfyui] Generation complete after ${Math.round((Date.now() - startTime) / 1000)}s: ${result.filename}`);
    return result;
  }

  throw new Error("ComfyUI generation timed out");
}

export async function downloadResult(
  baseUrl: string,
  imageData: { filename: string; subfolder: string; type: string },
): Promise<string> {
  const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(imageData.filename)}&subfolder=${encodeURIComponent(imageData.subfolder || "")}&type=${encodeURIComponent(imageData.type || "output")}`;

  const res = await fetch(viewUrl, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error("Failed to download from ComfyUI");

  const buffer = await res.arrayBuffer();
  const ext = imageData.filename.split(".").pop() || "png";
  const filename = `${newId()}.${ext}`;
  const filePath = resolve(getUploadsDir(), filename);

  writeFileSync(filePath, Buffer.from(buffer));
  console.log(`[comfyui] Saved: ${filename} (${buffer.byteLength} bytes)`);

  return filename; // relative to uploads dir
}

// --- Full pipeline ---

export async function executeWorkflow(
  baseUrl: string,
  workflowJson: string,
  params: GenerationParams,
  workflowRow: { promptNodeId?: string | null; outputNodeId?: string | null; imageInputNodeId?: string | null; endImageInputNodeId?: string | null; audioInputNodeId?: string | null; voiceInputNodeId?: string | null; defaultVoiceFile?: string | null; postfix?: string | null; defaultCfg?: number | null },
): Promise<{ success: boolean; filePath?: string; error?: string; executedWorkflow?: Record<string, any> }> {
  baseUrl = normalizeBaseUrl(baseUrl);
  let prepared: Record<string, any> | undefined;
  try {
    prepared = await prepareWorkflow(workflowJson, params, workflowRow, baseUrl);
    const promptId = await queueWorkflow(baseUrl, prepared);
    console.log(`[comfyui] Queued workflow, prompt_id: ${promptId}`);

    const outputData = await pollForCompletion(baseUrl, promptId, workflowRow.outputNodeId || undefined);
    const filename = await downloadResult(baseUrl, outputData);

    return { success: true, filePath: filename, executedWorkflow: prepared };
  } catch (err) {
    // Return the prepared workflow even on failure so the UI can show what we
    // tried to run when debugging quality regressions or queue rejections.
    return { success: false, error: (err as Error).message, executedWorkflow: prepared };
  }
}

// --- Workflow resolution ---

export async function resolveWorkflow(
  pluginId: string,
  type: "t2v" | "i2v" | "t2i" | "i2i" | "t2m" | "tts" | "ia2v" | "fflf",
  workflowId?: string,
): Promise<typeof schema.workflows.$inferSelect | null> {
  const disabledIds = await getComfyDisabledWorkflowIds();

  if (workflowId) {
    const [row] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, workflowId));
    if (!row || row.pluginId !== pluginId || disabledIds.has(row.id)) return null;
    return row;
  }

  // Find default for this type
  const defaults = await db.select().from(schema.workflows)
    .where(and(eq(schema.workflows.pluginId, pluginId), eq(schema.workflows.workflowType, type)));

  const enabledDefaults = defaults.filter((row) => !disabledIds.has(row.id));
  const defaultRow = enabledDefaults.find((r) => r.isDefault === 1) || enabledDefaults[0];
  return defaultRow || null;
}

export async function testConnection(baseUrl: string): Promise<boolean> {
  baseUrl = normalizeBaseUrl(baseUrl);
  try {
    const res = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}
