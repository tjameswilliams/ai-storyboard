export const ASPECT_RATIOS = [
  "1:1",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "3:2",
  "2:3",
  "16:10",
  "10:16",
  "21:9",
] as const;

export const MEGAPIXELS = [1, 2] as const;

/**
 * Live preview of the pixel dimensions for an aspect ratio + megapixel budget.
 * The server rounds to a multiple of 64 and is the source of truth; this client
 * value rounds to a multiple of 8 just to show a plausible preview in the UI.
 */
export function computeDims(aspect: string, mp: number): { width: number; height: number } {
  const parts = aspect.split(":").map((n) => Number(n));
  const ratioW = parts[0] && parts[0] > 0 ? parts[0] : 1;
  const ratioH = parts[1] && parts[1] > 0 ? parts[1] : 1;
  const area = mp * 1_000_000;
  const ratio = ratioW / ratioH;
  // width * height = area, width / height = ratio  =>  height = sqrt(area / ratio)
  let height = Math.sqrt(area / ratio);
  let width = height * ratio;
  const roundTo8 = (n: number) => Math.max(512, Math.round(n / 8) * 8);
  return { width: roundTo8(width), height: roundTo8(height) };
}
