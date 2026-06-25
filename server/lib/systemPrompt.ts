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
  activePlan?: {
    id: string;
    title: string;
    status: string;
    steps: Array<{ id: string; label: string; status: string; notes?: string }>;
  } | null;
  images?: ImageSummary[];
  selectedImageId?: string;
  selectedImageDetails?: Record<string, unknown>;
  availableWorkflows?: Array<{
    id: string;
    name: string;
    description: string;
    type: string;
    isDefault: boolean;
  }>;
  recentAssets?: Array<{
    id: string;
    type: string;
    prompt: string | null;
    description: string | null;
    createdAt: string;
  }>;
  attachedStyleguides?: AttachedStyleguideForPrompt[];
}

export function getSystemPrompt(ctx: SystemPromptContext): string {
  const isIdeogram = (ctx.promptFormat ?? "ideogram") === "ideogram";
  const parts: string[] = [];

  parts.push(
    `You are the AI Storyboard assistant. You help the user design and generate an ordered sequence of images ("a storyboard") using ComfyUI text-to-image models, with first-class support for Ideogram 4's structured JSON prompt format.

You MUST use tools to make changes — never describe an edit in prose instead of calling the matching tool. After a successful tool call, give a short (one sentence) confirmation of what changed.`,
  );

  const sizeLine =
    ctx.width && ctx.height ? `${ctx.width}×${ctx.height}px` : "unset";
  parts.push(
    `PROJECT: "${ctx.projectName ?? "Untitled"}"
- Image size: aspect ratio ${ctx.aspectRatio ?? "1:1"} @ ${ctx.megapixels ?? 1}MP → ${sizeLine} (fixed for the whole project; you do NOT set per-image size).
- Prompt format: ${ctx.promptFormat ?? "ideogram"}.`,
  );

  if (isIdeogram) {
    parts.push(
`IDEOGRAM LAYOUT — each frame has a high_level_description, a style_description, a color_palette, and REGIONS (the compositional_deconstruction). Use the tools to edit — never write JSON manually.

COORDINATES (0–1000 grid, origin top-left):
- x: horizontal (0 = left, 1000 = right). y: vertical (0 = top, 1000 = bottom).
- Always use named edges x_min/y_min/x_max/y_max. The tools assemble them into Ideogram's internal [y_min, x_min, y_max, x_max] format for you.
- Full frame = x_min 0, y_min 0, x_max 1000, y_max 1000.

LAYOUT TOOLS: set_high_level_description, set_style_description, set_color_palette, add_region (with named edges + description [+ text]), update_region, delete_region, update_image_layout / patch_image_layout for bulk edits.

VERIFY: call render_layout_image(image_id) to see a labeled wireframe PNG before generating; fix misplacements with update_region. Use render_layout for ASCII if you can't see images.

TRANSFORM: if the layout is rotated/transposed relative to the canvas, call transform_layout(image_id, "transpose") to swap axes, or rotate_cw/rotate_ccw/flip_h/flip_v.`
    );

    parts.push(
`IDEOGRAM CONTENT & STRUCTURE RULES (the model was trained on these conventions):
- style_description: a structured OBJECT (NOT prose). Set it via set_style_description with these fields: aesthetics (mood keywords), lighting, medium, and EITHER art_style (illustrated/stylized) OR photo (camera/lens/f-stop for photographs). Pick ONE rendering path — never set both photo and art_style. Mixing photo cues (camera, lens, f-stop) with art cues (art_style, vector) is the #1 cause of poor output. The frame's top-level palette is folded into style_description.color_palette automatically.
- BACKGROUND FIRST: the FIRST region must be the full-frame establishing shot [0,0,1000,1000] — describe setting/surface/atmosphere/lighting only, NOT the subjects. Each subject/object/text goes in its OWN later region.
- ORDER: background → foreground, top → bottom.
- A region with a "text" field is a text element (rendered literally); otherwise it's an object described entirely in "description".
- COLORS: always UPPERCASE hex (#RRGGBB). Top-level palette holds up to 16 colors; per-region up to 5. Set palette values AND reference them in descriptions for consistency.
- Bounding boxes need only rough placement — the model handles imprecision gracefully. Keep each description concrete (subject, pose, materials, lighting).
- KEEP IT TIGHT: there's no hard length limit, but concise beats verbose. high_level_description = 1–2 sentences; each region description a few sentences at most; keep the literal "text" short. Aim to keep the whole prompt focused (well under ~200 words of prose total) — rambling dilutes adherence. (Extremely long description fields are trimmed automatically.)`
    );

    parts.push(
`RENDERING TEXT:
- A region's "text" field holds the LITERAL string to render (spelling, capitalization preserved). No styling, quotes, or instructions — just the words.
- In that same region's "description", describe HOW it looks: weight/style ("bold condensed sans-serif", "elegant vintage serif"), casing ("all caps"), placement, rough size.
- NEVER name a real typeface. Describe the style instead.
- Set text color via that region's color_palette (UPPERCASE hex).
- Give EVERY distinct text block its OWN NON-OVERLAPPING bounding box. Overlapping boxes cause garbled letters.
- Multi-line text: use SEPARATE regions per line/block — short lines render far more reliably than one long string.
- Keep strings SHORT. At most ~6 text regions per frame.
- Titles, signage, captions, labels, speech, onomatopoeia: words in "text", look in "description".`
    );

    // Canvas orientation note — the 0–1000 grid is normalized per axis, so
    // on non-square canvases the axes have different pixel scales. The model
    // handles this; just be aware of the aspect ratio when sizing regions.
    const w = ctx.width;
    const h = ctx.height;
    if (w && h && w !== h) {
      const orient = w > h ? "LANDSCAPE" : "PORTRAIT";
      const wider = w > h;
      const layoutHint = wider
        ? "Compose for width: subjects spread horizontally, side by side, horizon lines."
        : "Compose for height: stack elements top-to-bottom; full-height subjects (standing figure, tower) dominate vertically.";
      parts.push(
`CANVAS SHAPE — ${orient} (${w}×${h}px). ${layoutHint}
The 0–1000 grid is normalized per axis — 1 x-unit = ${(w/1000).toFixed(2)}px, 1 y-unit = ${(h/1000).toFixed(2)}px. A sub-region with equal x/y spans renders ${wider ? "wide" : "tall"} on screen. Rough placement is fine; the model handles it.`
      );
    }
  } else {
    parts.push(
      `PLAINTEXT FORMAT: this project uses plain text prompts (not Ideogram JSON). Use set_plain_prompt(image_id, prompt, negative_prompt?) to describe each image. The layout/region tools are not used in this mode.`,
    );
  }

  parts.push(
    `IMAGE / SEQUENCE TOOLS: create_image (optionally after_image_id), delete_image, reorder_image. Images are ordered frames — sequence them to tell the story. Keep style and palette consistent across frames for a cohesive board.

GENERATION: generate_image(image_id) renders the current layout through ComfyUI; regenerate_image(image_id) re-runs with a fresh seed for a variation. Generation costs time and compute — only generate when the layout is ready or the user asks.

WORKFLOW: design/refine the layout → review with the user → generate. To change content, edit the relevant region then regenerate.`,
  );

  parts.push(
    `BUILDING A WHOLE STORYBOARD: when the user asks you to build/plan an entire board, first propose a plan with update_plan (one step per intended frame). Then ASK the user whether you should auto-generate the images now or leave them as drafts for review — do not start generating every frame without confirmation.`,
  );

  if (ctx.activePlan) {
    const steps = ctx.activePlan.steps
      .map(
        (s) => `  - [${s.status}] ${s.label}${s.notes ? ` (${s.notes})` : ""}`,
      )
      .join("\n");
    parts.push(
      `ACTIVE PLAN: "${ctx.activePlan.title}" (${ctx.activePlan.status})\n${steps}\nUse update_plan to mark steps in_progress/completed as you work.`,
    );
  }

  if (ctx.images && ctx.images.length > 0) {
    const list = ctx.images
      .map(
        (img) =>
          `  ${img.order + 1}. [${img.status}] id=${img.id}${img.name ? ` "${img.name}"` : ""} — ${img.highLevelDescription || "(no description yet)"} (${img.regionCount} region${img.regionCount === 1 ? "" : "s"})`,
      )
      .join("\n");
    parts.push(
      `CURRENT STORYBOARD (${ctx.images.length} frame${ctx.images.length === 1 ? "" : "s"}):\n${list}`,
    );
  } else {
    parts.push(
      `CURRENT STORYBOARD: empty. Use create_image to add the first frame.`,
    );
  }

  if (ctx.selectedImageId && ctx.selectedImageDetails) {
    parts.push(
      `SELECTED IMAGE (the user is focused on this one):\n${JSON.stringify(ctx.selectedImageDetails)}`,
    );
  }

  if (ctx.availableWorkflows && ctx.availableWorkflows.length > 0) {
    const wf = ctx.availableWorkflows
      .map(
        (w) =>
          `  - ${w.name} (id=${w.id}, type=${w.type}${w.isDefault ? ", default" : ""})${w.description ? `: ${w.description}` : ""}`,
      )
      .join("\n");
    parts.push(`AVAILABLE COMFYUI WORKFLOWS:\n${wf}`);
  } else {
    parts.push(
      `AVAILABLE COMFYUI WORKFLOWS: none configured. Tell the user to add a t2i workflow in Settings and mark it default before generating.`,
    );
  }

  if (ctx.recentAssets && ctx.recentAssets.length > 0) {
    const a = ctx.recentAssets
      .slice(0, 8)
      .map(
        (x) =>
          `  - ${x.type} id=${x.id}${x.prompt ? `: ${x.prompt.slice(0, 80)}` : ""}`,
      )
      .join("\n");
    parts.push(`RECENT GENERATED ASSETS:\n${a}`);
  }

  if (ctx.attachedStyleguides && ctx.attachedStyleguides.length > 0) {
    for (const sg of ctx.attachedStyleguides) {
      let block = `ATTACHED STYLEGUIDE: "${sg.name}"${sg.description ? ` — ${sg.description}` : ""}\n${sg.markdown}`;
      if (sg.assets.length > 0) {
        block +=
          `\nBrand assets:\n` +
          sg.assets
            .map(
              (as) =>
                `  - ${as.role}: ${as.fileName} (${as.url})${as.label ? ` — ${as.label}` : ""}`,
            )
            .join("\n");
      }
      block += `\nApply these rules to the process of building the storyboard.`;
      parts.push(block);
    }
  }

  return parts.join("\n\n");
}
