import type { BoundingBox } from "../types";

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
