import { createCanvas } from "@napi-rs/canvas";
import type { Layout } from "./layout";

// Same palette the on-screen editor uses, so the wireframe matches the UI.
const REGION_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#eab308", "#a855f7", "#06b6d4", "#f97316", "#ec4899"];

/**
 * Render a wireframe PNG of a frame's bounding boxes (no generated picture) on
 * an aspect-correct canvas, so a vision-capable agent can SEE where its boxes
 * land and verify positions/proportions. Returns PNG bytes.
 */
export function renderLayoutPng(layout: Layout, W: number, H: number): Buffer {
  // Fit the canvas so the long side is ~1000px, preserving the project aspect.
  const LONG = 1000;
  const cw = W >= H ? LONG : Math.round((W / H) * LONG);
  const ch = H >= W ? LONG : Math.round((H / W) * LONG);
  const canvas = createCanvas(cw, ch);
  const ctx = canvas.getContext("2d");

  // Background + faint thirds grid for reference.
  ctx.fillStyle = "#0b0b12";
  ctx.fillRect(0, 0, cw, ch);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (const f of [1 / 3, 2 / 3]) {
    ctx.beginPath(); ctx.moveTo(Math.round(cw * f), 0); ctx.lineTo(Math.round(cw * f), ch); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, Math.round(ch * f)); ctx.lineTo(cw, Math.round(ch * f)); ctx.stroke();
  }

  const toX = (x: number) => (x / 1000) * cw;
  const toY = (y: number) => (y / 1000) * ch;

  layout.compositional_deconstruction.forEach((r, i) => {
    const color = REGION_COLORS[i % REGION_COLORS.length];
    const [yMin, xMin, yMax, xMax] = r.bounding_box;
    const x = toX(Math.min(xMin, xMax));
    const y = toY(Math.min(yMin, yMax));
    const w = toX(Math.max(xMin, xMax)) - x;
    const h = toY(Math.max(yMin, yMax)) - y;

    // Translucent fill + solid border.
    ctx.fillStyle = hexA(color, 0.12);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.strokeRect(x, y, w, h);

    // Label chip at the box's top-left.
    const label = `${i + 1}` + (r.description ? `  ${r.description.slice(0, 22)}` : "") + (r.text ? `  “${r.text.slice(0, 14)}”` : "");
    ctx.font = "600 16px sans-serif";
    const tw = ctx.measureText(label).width;
    const chipH = 20;
    const chipY = Math.max(0, y);
    ctx.fillStyle = color;
    ctx.fillRect(x, chipY, Math.min(tw + 12, cw - x), chipH);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x + 6, chipY + 15);
  });

  return canvas.toBuffer("image/png");
}

function hexA(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}
