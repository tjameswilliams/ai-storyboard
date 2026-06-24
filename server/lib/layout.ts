import { z } from "zod";
import { newId } from "./nanoid";

/**
 * Ideogram-style structured layout. This is the document the user edits (via
 * the visual bbox editor, the inspectors, or the raw JSON editor) and that we
 * serialize verbatim as the ComfyUI prompt for Ideogram workflows.
 *
 * Bounding boxes use [y_min, x_min, y_max, x_max] on a 0..1000 grid, top-left
 * origin — matching Ideogram 4's caption format.
 */

const hexColor = z.string().regex(/^#?[0-9a-fA-F]{3,8}$/, "must be a hex color");

// Ideogram 4 style_description is a structured OBJECT (not prose), with photo
// and art_style mutually exclusive. All fields optional so partial styles work.
export const StyleObjectSchema = z.object({
  aesthetics: z.string().optional(),   // mood keywords, e.g. "moody, cinematic, desaturated"
  lighting: z.string().optional(),     // e.g. "golden hour, rim light"
  medium: z.string().optional(),       // "photograph" | "illustration" | "3d_render" | "painting" | "graphic_design"
  photo: z.string().optional(),        // camera/lens for photographs — exclusive with art_style
  art_style: z.string().optional(),    // for non-photos — exclusive with photo
  color_palette: z.array(hexColor).optional(),
});
export type StyleDescription = z.infer<typeof StyleObjectSchema>;

// Accept the canonical object, or a legacy prose string (wrapped into aesthetics).
const styleField = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() ? { aesthetics: v } : {}) : v),
  StyleObjectSchema,
).default({});

// Accept regions written with named edges (x_min/y_min/x_max/y_max) and
// normalize to Ideogram's y-first bounding_box, so the agent can never
// transpose the axes regardless of which path it uses.
function coerceRegionInput(v: unknown): unknown {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (!Array.isArray(o.bounding_box) &&
        (o.x_min !== undefined || o.y_min !== undefined || o.x_max !== undefined || o.y_max !== undefined)) {
      const n = (x: unknown, d: number) => (typeof x === "number" && Number.isFinite(x) ? x : d);
      const { x_min, y_min, x_max, y_max, ...rest } = o;
      return { ...rest, bounding_box: [n(y_min, 0), n(x_min, 0), n(y_max, 1000), n(x_max, 1000)] };
    }
  }
  return v;
}

export const RegionSchema = z.preprocess(coerceRegionInput, z.object({
  // Internal id so region-level tools/inspector can target a region. Stripped
  // before the layout is serialized into the model prompt.
  id: z.string().default(() => newId()),
  bounding_box: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  description: z.string().default(""),
  color_palette: z.array(hexColor).optional(),
  text: z.string().optional(),
}));

export const LayoutSchema = z.object({
  high_level_description: z.string().default(""),
  style_description: styleField,
  color_palette: z.array(hexColor).default([]),
  compositional_deconstruction: z.array(RegionSchema).default([]),
});

export type Region = z.infer<typeof RegionSchema>;
export type Layout = z.infer<typeof LayoutSchema>;

export function emptyLayout(): Layout {
  return {
    high_level_description: "",
    style_description: {},
    color_palette: [],
    compositional_deconstruction: [],
  };
}

/**
 * Parse + normalize a layout from its stored JSON string (or an object). Always
 * returns a valid Layout — missing fields are defaulted, regions get ids.
 * Throws only if the value is not valid JSON / not an object.
 */
export function parseLayout(value: string | unknown): Layout {
  let raw: unknown = value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    raw = trimmed.length ? JSON.parse(trimmed) : {};
  }
  const parsed = LayoutSchema.safeParse(raw ?? {});
  if (parsed.success) {
    // Ensure every region has an id (defaults only fire when the key is absent).
    parsed.data.compositional_deconstruction = parsed.data.compositional_deconstruction.map((r) => ({
      ...r,
      id: r.id || newId(),
    }));
    return parsed.data;
  }
  throw new Error(`Invalid layout: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
}

/** Validate an arbitrary value as a layout. Returns the normalized layout or an error string. */
export function validateLayout(value: unknown): { ok: true; layout: Layout } | { ok: false; error: string } {
  try {
    return { ok: true, layout: parseLayout(value) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/** Serialize a layout for storage (keeps region ids). */
export function stringifyLayout(layout: Layout): string {
  return JSON.stringify(layout);
}

/**
 * Serialize a layout for the model prompt: canonical key order, region `id`
 * fields stripped (they're internal), and empty optional fields omitted.
 */
// Ideogram requires UPPERCASE hex; the color picker emits lowercase.
function upHex(h: string): string {
  return "#" + h.replace(/^#/, "").toUpperCase();
}
function upPalette(a: string[] | undefined, max: number): string[] | undefined {
  if (!a || !a.length) return undefined;
  return a.slice(0, max).map(upHex);
}

function isFullFrame([y0, x0, y1, x1]: [number, number, number, number]): boolean {
  return x0 <= 50 && y0 <= 50 && x1 >= 950 && y1 >= 950;
}

/**
 * Serialize a layout into Ideogram 4's canonical structured prompt:
 *  { high_level_description, style_description:{...}, compositional_deconstruction:{ background, elements:[{type,bbox,...}] } }
 * - style_description in canonical key order (photo vs art path).
 * - The first full-frame region becomes the `background` string; the rest become
 *   typed `elements` (type "obj"/"text", bbox, desc, ...).
 * - All hex uppercased; palettes capped (16 image-level, 5 per element).
 */
export function serializeLayout(layout: Layout): string {
  const style = layout.style_description ?? {};
  const styleOut: Record<string, unknown> = {};
  if (style.aesthetics) styleOut.aesthetics = style.aesthetics;
  if (style.lighting) styleOut.lighting = style.lighting;
  if (style.photo) {
    styleOut.photo = style.photo;
    if (style.medium) styleOut.medium = style.medium;
  } else {
    if (style.medium) styleOut.medium = style.medium;
    if (style.art_style) styleOut.art_style = style.art_style;
  }
  const palette = upPalette(style.color_palette && style.color_palette.length ? style.color_palette : layout.color_palette, 16);
  if (palette) styleOut.color_palette = palette;

  // compositional_deconstruction -> { background, elements } (Ideogram shape).
  const regions = layout.compositional_deconstruction;
  let background = "";
  let elementRegions = regions;
  if (regions.length && isFullFrame(regions[0].bounding_box)) {
    background = regions[0].description || "";
    elementRegions = regions.slice(1);
  }
  const elements = elementRegions.map((r) => {
    const isText = !!(r.text && r.text.length);
    const el: Record<string, unknown> = isText
      ? { type: "text", bbox: r.bounding_box, text: r.text, desc: r.description }
      : { type: "obj", bbox: r.bounding_box, desc: r.description };
    const rp = upPalette(r.color_palette, 5);
    if (rp) el.color_palette = rp;
    return el;
  });

  const clean = {
    high_level_description: layout.high_level_description,
    style_description: styleOut,
    compositional_deconstruction: { background, elements },
  };
  return JSON.stringify(clean);
}

export type LayoutTransform = "transpose" | "rotate_cw" | "rotate_ccw" | "rotate_180" | "flip_h" | "flip_v";

// Map a point (x,y) in the 0..1000 grid under a transform. Used to re-map a whole
// layout when the agent laid it out rotated/transposed for the canvas.
function transformPoint(op: LayoutTransform, x: number, y: number): [number, number] {
  switch (op) {
    case "transpose": return [y, x];                 // swap axes (fixes horizontal/vertical mix-ups)
    case "rotate_cw": return [1000 - y, x];          // 90° clockwise
    case "rotate_ccw": return [y, 1000 - x];         // 90° counter-clockwise
    case "rotate_180": return [1000 - x, 1000 - y];
    case "flip_h": return [1000 - x, y];             // mirror left↔right
    case "flip_v": return [x, 1000 - y];             // mirror top↔bottom
  }
}

/** Re-map every region's bounding box under a coordinate transform. */
export function transformLayout(layout: Layout, op: LayoutTransform): Layout {
  return {
    ...layout,
    compositional_deconstruction: layout.compositional_deconstruction.map((r) => {
      const [yMin, xMin, yMax, xMax] = r.bounding_box;
      const [ax, ay] = transformPoint(op, xMin, yMin);
      const [bx, by] = transformPoint(op, xMax, yMax);
      return { ...r, bounding_box: clampBox([Math.min(ay, by), Math.min(ax, bx), Math.max(ay, by), Math.max(ax, bx)]) };
    }),
  };
}

/** Clamp a bounding box to the 0..1000 grid with a minimum size, integer-rounded. */
export function clampBox(box: [number, number, number, number]): [number, number, number, number] {
  const MIN = 10;
  let [yMin, xMin, yMax, xMax] = box.map((n) => Math.round(Math.max(0, Math.min(1000, n)))) as [number, number, number, number];
  if (xMax - xMin < MIN) xMax = Math.min(1000, xMin + MIN);
  if (yMax - yMin < MIN) yMax = Math.min(1000, yMin + MIN);
  return [yMin, xMin, yMax, xMax];
}
