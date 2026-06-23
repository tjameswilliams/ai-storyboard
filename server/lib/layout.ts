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
  style_description: z.string().default(""),
  color_palette: z.array(hexColor).default([]),
  compositional_deconstruction: z.array(RegionSchema).default([]),
});

export type Region = z.infer<typeof RegionSchema>;
export type Layout = z.infer<typeof LayoutSchema>;

export function emptyLayout(): Layout {
  return {
    high_level_description: "",
    style_description: "",
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
export function serializeLayout(layout: Layout): string {
  const clean = {
    high_level_description: layout.high_level_description,
    style_description: layout.style_description,
    color_palette: layout.color_palette,
    compositional_deconstruction: layout.compositional_deconstruction.map((r) => {
      const region: Record<string, unknown> = {
        bounding_box: r.bounding_box,
        description: r.description,
      };
      if (r.color_palette && r.color_palette.length) region.color_palette = r.color_palette;
      if (r.text && r.text.length) region.text = r.text;
      return region;
    }),
  };
  return JSON.stringify(clean);
}

/** Clamp a bounding box to the 0..1000 grid with a minimum size, integer-rounded. */
export function clampBox(box: [number, number, number, number]): [number, number, number, number] {
  const MIN = 10;
  let [yMin, xMin, yMax, xMax] = box.map((n) => Math.round(Math.max(0, Math.min(1000, n)))) as [number, number, number, number];
  if (xMax - xMin < MIN) xMax = Math.min(1000, xMin + MIN);
  if (yMax - yMin < MIN) yMax = Math.min(1000, yMin + MIN);
  return [yMin, xMin, yMax, xMax];
}
