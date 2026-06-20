import { resolve } from "path";
import { readFileSync, existsSync } from "fs";
import { execFileSync } from "child_process";
import { getUploadsDir, getFfmpegPath } from "../lib/config";
import { estimateTokens } from "../lib/llm";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";

const MAX_IMAGE_DIMENSION = 1024;

/** Resize image to fit within MAX_IMAGE_DIMENSION and return as JPEG buffer */
export function resizeImageForVision(filePath: string): Buffer {
  const raw = readFileSync(filePath);
  try {
    // Use ffmpeg to resize to max dimension and output JPEG to stdout
    const result = execFileSync(getFfmpegPath(), [
      "-i", filePath,
      "-vf", `scale='min(${MAX_IMAGE_DIMENSION},iw)':'min(${MAX_IMAGE_DIMENSION},ih)':force_original_aspect_ratio=decrease`,
      "-q:v", "6",
      "-f", "image2",
      "-vcodec", "mjpeg",
      "pipe:1",
    ], { maxBuffer: 10 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
    return result;
  } catch {
    // If ffmpeg fails, return the original buffer
    return raw;
  }
}

/** Process message attachments into LLM-compatible content parts */
export async function processAttachments(
  message: { role: string; content: string; attachments?: Array<{ url: string; name: string; type: string }> }
): Promise<{ role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }> {
  if (!message.attachments || message.attachments.length === 0) {
    return { role: message.role, content: message.content };
  }

  const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

  // Add the text content first
  if (message.content && message.content !== "(attached files)") {
    contentParts.push({ type: "text", text: message.content });
  }

  for (const att of message.attachments) {
    const filename = att.url.replace("/api/uploads/", "");
    const filePath = resolve(getUploadsDir(), filename);

    if (att.type.startsWith("image/")) {
      // Include resized base64 image for vision-capable LLMs (OpenAI, etc.)
      if (existsSync(filePath)) {
        try {
          const resized = resizeImageForVision(filePath);
          const base64 = resized.toString("base64");
          console.log(`[chat] Attaching image "${att.name}" (${(resized.length / 1024).toFixed(0)}KB resized) as vision content`);
          contentParts.push({
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${base64}` },
          });
        } catch (err) {
          console.error(`[chat] Failed to read image "${att.name}":`, (err as Error).message);
        }
      } else {
        console.warn(`[chat] Image file not found: ${filePath}`);
      }
      // Always include a text reference so the AI can use the path in tool calls
      contentParts.push({
        type: "text",
        text: `[Attached image: "${att.name}" — available at ${att.url}. Use this path as start_frame for generate_video or input_image for generate_image.]`,
      });
    } else {
      // For documents: read text content and inject it
      if (existsSync(filePath)) {
        const ext = filename.split(".").pop()?.toLowerCase() || "";
        let textContent = "";

        if (["txt", "md", "csv", "json", "xml", "html", "css", "js", "ts", "py", "sh"].includes(ext)) {
          textContent = readFileSync(filePath, "utf-8");
        } else if (ext === "pdf") {
          textContent = `[PDF document: "${att.name}" — PDF text extraction is not available in this app. Ask the user to paste the key content as text.]`;
        } else {
          textContent = `[Attached file: "${att.name}" (${att.type})]`;
        }

        if (textContent) {
          contentParts.push({
            type: "text",
            text: `--- Attached document: ${att.name} ---\n${textContent}\n--- End of document ---`,
          });
        }
      }
    }
  }

  if (contentParts.length === 0) {
    return { role: message.role, content: message.content };
  }

  // If only text parts, can simplify to string
  const hasImages = contentParts.some((p) => p.type === "image_url");
  if (!hasImages) {
    return { role: message.role, content: contentParts.map((p) => p.text || "").join("\n") };
  }

  return { role: message.role, content: contentParts };
}

export function estimateFullContextUsage(
  conversation: Array<{ role: string; content: string }>,
  toolsJson: string
): number {
  const convTokens = estimateTokens(conversation.map((m) => m.content).join("\n"));
  const toolTokens = estimateTokens(toolsJson);
  return convTokens + toolTokens;
}

export function compactToolResults(
  conversation: Array<{
    role: string;
    content: string;
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
  }>,
  keepRecent: number = 4
): void {
  const toolIndices: number[] = [];
  for (let i = 0; i < conversation.length; i++) {
    if (conversation[i].role === "tool") toolIndices.push(i);
  }
  const toCompact = toolIndices.slice(0, Math.max(0, toolIndices.length - keepRecent));
  for (const idx of toCompact) {
    const msg = conversation[idx];
    try {
      const parsed = JSON.parse(msg.content);
      msg.content = parsed.success
        ? `{"success":true,"result":"(completed)"}`
        : `{"success":false,"result":"(failed)"}`;
    } catch {}
  }
}

/**
 * Check if a plan still has incomplete steps (pending or in_progress).
 * Returns true if the plan exists and has remaining work.
 */
export async function isPlanStillRunning(planId: string): Promise<boolean> {
  try {
    const [freshPlan] = await db.select().from(schema.plans)
      .where(eq(schema.plans.id, planId));
    if (freshPlan && (freshPlan.status === "executing" || freshPlan.status === "approved")) {
      const steps = JSON.parse(freshPlan.steps);
      return steps.some(
        (s: any) => s.status === "pending" || s.status === "in_progress"
      );
    }
  } catch {}
  return false;
}

/**
 * Strip image_url content parts from a conversation by describing them via
 * a vision model, then collapsing array content to plain text strings.
 * Mutates the conversation array in place and returns it.
 */
export async function stripImageContentWithVisionFallback(
  conversation: Array<{
    role: string;
    content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    tool_call_id?: string;
  }>,
  uploadsDir: string
): Promise<typeof conversation> {
  for (const msg of conversation as any[]) {
    if (!Array.isArray(msg.content)) continue;
    const imageParts = msg.content.filter((p: any) => p.type === "image_url");
    if (imageParts.length === 0) continue;

    // Describe each image via the vision model
    for (const imgPart of imageParts) {
      const dataUrl: string = imgPart.image_url?.url || "";
      // Find the matching text reference to get the filename
      const textRef = msg.content.find((p: any) =>
        p.type === "text" && p.text?.includes("[Attached image:")
      );
      const nameMatch = textRef?.text?.match(/\[Attached image: "([^"]+)"/);
      const imgName = nameMatch?.[1] || "image";
      const urlMatch = textRef?.text?.match(/available at ([^\s.]+)/);
      const imgUrl = urlMatch?.[1] || "";
      const filename = imgUrl.replace("/api/uploads/", "");
      const imgPath = filename ? resolve(uploadsDir, filename) : "";

      // No separate vision model is configured in this app; just drop the
      // image bytes and keep the text reference so the LLM still has the path.
      void imgPath;
      const description = "";

      // Replace the image_url part with a text description
      const idx = msg.content.indexOf(imgPart);
      if (idx !== -1) {
        if (description) {
          msg.content[idx] = { type: "text", text: `[Visual description of "${imgName}": ${description}]` };
        } else {
          msg.content.splice(idx, 1);
        }
      }
    }

    // Collapse to string since no more image_url parts
    const textParts = msg.content.filter((p: any) => p.type === "text");
    msg.content = textParts.map((p: any) => p.text || "").join("\n");
  }

  return conversation;
}

/**
 * Detect if the LLM described a tool action in text without actually calling the tool.
 * Returns a nudge prompt if narration is detected, or null if the response looks fine.
 */
export function detectToolNarration(
  content: string,
  availableToolNames: string[],
): string | null {
  if (!content || content.length < 20) return null;

  // Patterns that indicate the LLM is narrating instead of acting
  const narrationPatterns = [
    /\b(?:I'll|I will|Let me|I'm going to|I can|I would)\b.*\b(?:use|call|run|execute|invoke)\b/i,
    /\b(?:I'll|I will|Let me|I'm going to)\b.*\b(?:add|create|delete|remove|split|trim|move|set|generate|extract|rename|mute|hide|export)\b/i,
    /\bhere'?s (?:what|how) I (?:would|will|can)\b/i,
    /\bI (?:would |will |can )(?:recommend|suggest) (?:using|calling)\b/i,
  ];

  const hasNarration = narrationPatterns.some((p) => p.test(content));
  if (!hasNarration) return null;

  // Check if the text mentions a specific tool name
  const mentionedTool = availableToolNames.find((name) => {
    const readable = name.replace(/_/g, "[_ ]?");
    return new RegExp(`\\b${readable}\\b`, "i").test(content);
  });

  // Check for action verbs that map to tools
  const actionVerbs = /\b(?:trim|split|add|delete|remove|move|rename|mute|unmute|hide|show|generate|export|create)\b/i;
  const hasActionVerb = actionVerbs.test(content);

  if (mentionedTool || hasActionVerb) {
    return "You described what you would do but didn't call the tool. Please execute the action now by calling the appropriate tool function.";
  }

  return null;
}
