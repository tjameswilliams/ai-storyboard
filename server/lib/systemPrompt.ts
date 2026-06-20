import type { AttachedStyleguideForPrompt } from "./styleguideContext";

interface ImageSummary {
  id: string;
  order: number;
  name: string;
  status: string;
  highLevelDescription: string;
  regionCount: number;
}

interface SystemPromptContext {
  projectName?: string;
  aspectRatio?: string;
  megapixels?: number;
  width?: number;
  height?: number;
  promptFormat?: string;
  activePlan?: { id: string; title: string; status: string; steps: Array<{ id: string; label: string; status: string; notes?: string }> } | null;
  images?: ImageSummary[];
  selectedImageId?: string;
  selectedImageDetails?: Record<string, unknown>;
  availableWorkflows?: Array<{ id: string; name: string; description: string; type: string; isDefault: boolean }>;
  recentAssets?: Array<{ id: string; type: string; prompt: string | null; description: string | null; createdAt: string }>;
  attachedStyleguides?: AttachedStyleguideForPrompt[];
}

export function getSystemPrompt(ctx: SystemPromptContext): string {
  const isIdeogram = (ctx.promptFormat ?? "ideogram") === "ideogram";
  const parts: string[] = [];

  parts.push(
`You are the AI Storyboard assistant. You help the user design and generate an ordered sequence of images ("a storyboard") using ComfyUI text-to-image models, with first-class support for Ideogram 4's structured JSON prompt format.

You MUST use tools to make changes — never describe an edit in prose instead of calling the matching tool. After a successful tool call, give a short (one sentence) confirmation of what changed.`
  );

  const sizeLine = ctx.width && ctx.height ? `${ctx.width}×${ctx.height}px` : "unset";
  parts.push(
`PROJECT: "${ctx.projectName ?? "Untitled"}"
- Image size: aspect ratio ${ctx.aspectRatio ?? "1:1"} @ ${ctx.megapixels ?? 1}MP → ${sizeLine} (fixed for the whole project; you do NOT set per-image size).
- Prompt format: ${ctx.promptFormat ?? "ideogram"}.`
  );

  if (isIdeogram) {
    parts.push(
`IDEOGRAM LAYOUT SCHEMA — each image holds a structured layout you edit via tools (never hand-write the raw JSON blob):
{
  "high_level_description": "overall scene in one or two sentences",
  "style_description": "aesthetic, medium, lighting, mood, overall palette",
  "color_palette": ["#hex", ...up to 16],
  "compositional_deconstruction": [
    { "bounding_box": [y_min, x_min, y_max, x_max], "description": "...", "color_palette": ["#hex"], "text": "literal text to render" }
  ]
}

BOUNDING BOX CONVENTION — read carefully, this is the #1 thing to get right:
- Coordinates are [y_min, x_min, y_max, x_max] — Y comes FIRST.
- Each value is 0–1000, with the ORIGIN AT THE TOP-LEFT (y increases downward, x increases rightward).
- Example: a banner across the top third spanning full width = [0, 0, 333, 1000].
- Again: the order is [y_min, x_min, y_max, x_max], 0–1000, top-left origin.

LAYOUT TOOLS: set_high_level_description, set_style_description, set_color_palette, add_region, update_region, delete_region, update_image_layout (full replace), patch_image_layout. The serialized layout is sent verbatim to Ideogram as the prompt.`
    );
  } else {
    parts.push(
`PLAINTEXT FORMAT: this project uses plain text prompts (not Ideogram JSON). Use set_plain_prompt(image_id, prompt, negative_prompt?) to describe each image. The layout/region tools are not used in this mode.`
    );
  }

  parts.push(
`IMAGE / SEQUENCE TOOLS: create_image (optionally after_image_id), delete_image, reorder_image. Images are ordered frames — sequence them to tell the story. Keep style and palette consistent across frames for a cohesive board.

GENERATION: generate_image(image_id) renders the current layout through ComfyUI; regenerate_image(image_id) re-runs with a fresh seed for a variation. Generation costs time and compute — only generate when the layout is ready or the user asks.

WORKFLOW: design/refine the layout → review with the user → generate. To change content, edit the relevant region then regenerate.`
  );

  parts.push(
`BUILDING A WHOLE STORYBOARD: when the user asks you to build/plan an entire board, first propose a plan with update_plan (one step per intended frame). Then ASK the user whether you should auto-generate the images now or leave them as drafts for review — do not start generating every frame without confirmation.`
  );

  if (ctx.activePlan) {
    const steps = ctx.activePlan.steps.map((s) => `  - [${s.status}] ${s.label}${s.notes ? ` (${s.notes})` : ""}`).join("\n");
    parts.push(`ACTIVE PLAN: "${ctx.activePlan.title}" (${ctx.activePlan.status})\n${steps}\nUse update_plan to mark steps in_progress/completed as you work.`);
  }

  if (ctx.images && ctx.images.length > 0) {
    const list = ctx.images.map((img) =>
      `  ${img.order + 1}. [${img.status}] id=${img.id}${img.name ? ` "${img.name}"` : ""} — ${img.highLevelDescription || "(no description yet)"} (${img.regionCount} region${img.regionCount === 1 ? "" : "s"})`
    ).join("\n");
    parts.push(`CURRENT STORYBOARD (${ctx.images.length} frame${ctx.images.length === 1 ? "" : "s"}):\n${list}`);
  } else {
    parts.push(`CURRENT STORYBOARD: empty. Use create_image to add the first frame.`);
  }

  if (ctx.selectedImageId && ctx.selectedImageDetails) {
    parts.push(`SELECTED IMAGE (the user is focused on this one):\n${JSON.stringify(ctx.selectedImageDetails)}`);
  }

  if (ctx.availableWorkflows && ctx.availableWorkflows.length > 0) {
    const wf = ctx.availableWorkflows.map((w) => `  - ${w.name} (id=${w.id}, type=${w.type}${w.isDefault ? ", default" : ""})${w.description ? `: ${w.description}` : ""}`).join("\n");
    parts.push(`AVAILABLE COMFYUI WORKFLOWS:\n${wf}`);
  } else {
    parts.push(`AVAILABLE COMFYUI WORKFLOWS: none configured. Tell the user to add a t2i workflow in Settings and mark it default before generating.`);
  }

  if (ctx.recentAssets && ctx.recentAssets.length > 0) {
    const a = ctx.recentAssets.slice(0, 8).map((x) => `  - ${x.type} id=${x.id}${x.prompt ? `: ${x.prompt.slice(0, 80)}` : ""}`).join("\n");
    parts.push(`RECENT GENERATED ASSETS:\n${a}`);
  }

  if (ctx.attachedStyleguides && ctx.attachedStyleguides.length > 0) {
    for (const sg of ctx.attachedStyleguides) {
      let block = `ATTACHED STYLEGUIDE: "${sg.name}"${sg.description ? ` — ${sg.description}` : ""}\n${sg.markdown}`;
      if (sg.assets.length > 0) {
        block += `\nBrand assets:\n` + sg.assets.map((as) => `  - ${as.role}: ${as.fileName} (${as.url})${as.label ? ` — ${as.label}` : ""}`).join("\n");
      }
      block += `\nApply this brand's voice, colors, and typography across the storyboard's style_description and palettes.`;
      parts.push(block);
    }
  }

  return parts.join("\n\n");
}
