/**
 * Ideogram-style image sizing: the user picks an aspect ratio + a megapixel
 * target, which together determine concrete pixel dimensions. We round each
 * dimension to a multiple of 64 (latent-grid friendly for ComfyUI/SDXL/Flux/
 * Ideogram samplers) and keep the short side >= 512.
 */

export const ASPECT_RATIOS = [
  "1:1",
  "16:9", "9:16",
  "4:3", "3:4",
  "3:2", "2:3",
  "16:10", "10:16",
  "5:4", "4:5",
  "21:9",
  "2:1", "1:2",
  "3:1", "1:3",
] as const;

export type AspectRatio = typeof ASPECT_RATIOS[number];

export const MEGAPIXEL_OPTIONS = [1, 2] as const;
export type Megapixels = typeof MEGAPIXEL_OPTIONS[number];

export function isValidAspectRatio(value: unknown): value is AspectRatio {
  return typeof value === "string" && (ASPECT_RATIOS as readonly string[]).includes(value);
}

export function isValidMegapixels(value: unknown): value is number {
  return typeof value === "number" && (MEGAPIXEL_OPTIONS as readonly number[]).includes(value);
}

/**
 * Compute concrete pixel dimensions for an aspect ratio at a megapixel target.
 *   area = megapixels * 1_000_000
 *   w/h preserve the ratio; round each to nearest multiple of 64; min 512.
 */
export function computeDimensions(aspect: string, megapixels: number): { width: number; height: number } {
  const parts = aspect.split(":").map(Number);
  const rw = parts[0] || 1;
  const rh = parts[1] || 1;
  const target = (megapixels || 1) * 1_000_000;
  const wExact = Math.sqrt(target * (rw / rh));
  const hExact = wExact * (rh / rw);
  const round64 = (n: number) => Math.max(512, Math.round(n / 64) * 64);
  return { width: round64(wExact), height: round64(hExact) };
}
