import type { BoundingBox, Layout } from "../types";

export type LayoutTransform = "transpose" | "rotate_cw" | "rotate_ccw" | "rotate_180" | "flip_h" | "flip_v";

/**
 * Bounding boxes use the Ideogram-4 format: [y_min, x_min, y_max, x_max] on a
 * 0..1000 grid with a top-left origin. `rect` is the rendered image area in
 * pixels (relative to its own top-left).
 */

export interface Rect {
  w: number;
  h: number;
}

export interface PxBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Normalized 0..1000 box -> pixel rect within the rendered image. */
export function toPx(box: BoundingBox, rect: Rect): PxBox {
  const [yMin, xMin, yMax, xMax] = box;
  const x = (xMin / 1000) * rect.w;
  const y = (yMin / 1000) * rect.h;
  const w = ((xMax - xMin) / 1000) * rect.w;
  const h = ((yMax - yMin) / 1000) * rect.h;
  return { x, y, w, h };
}

/** Pixel rect within the rendered image -> normalized 0..1000 box. */
export function toNorm(px: PxBox, rect: Rect): BoundingBox {
  const w = rect.w || 1;
  const h = rect.h || 1;
  const xMin = (px.x / w) * 1000;
  const yMin = (px.y / h) * 1000;
  const xMax = ((px.x + px.w) / w) * 1000;
  const yMax = ((px.y + px.h) / h) * 1000;
  return [yMin, xMin, yMax, xMax];
}

const MIN_SIZE = 10;

/** Clamp to the 0..1000 grid with a minimum size, integer-rounded, min<max. */
export function clampBox(box: BoundingBox): BoundingBox {
  let [yMin, xMin, yMax, xMax] = box.map((n) =>
    Math.round(Math.max(0, Math.min(1000, n))),
  ) as BoundingBox;
  if (xMax - xMin < MIN_SIZE) {
    if (xMin + MIN_SIZE <= 1000) xMax = xMin + MIN_SIZE;
    else xMin = xMax - MIN_SIZE;
  }
  if (yMax - yMin < MIN_SIZE) {
    if (yMin + MIN_SIZE <= 1000) yMax = yMin + MIN_SIZE;
    else yMin = yMax - MIN_SIZE;
  }
  return [yMin, xMin, yMax, xMax];
}

function transformPoint(op: LayoutTransform, x: number, y: number): [number, number] {
  switch (op) {
    case "transpose": return [y, x];
    case "rotate_cw": return [1000 - y, x];
    case "rotate_ccw": return [y, 1000 - x];
    case "rotate_180": return [1000 - x, 1000 - y];
    case "flip_h": return [1000 - x, y];
    case "flip_v": return [x, 1000 - y];
  }
}

/** Re-map every region's bounding box under a coordinate transform. */
export function transformLayoutBoxes(layout: Layout, op: LayoutTransform): Layout {
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
