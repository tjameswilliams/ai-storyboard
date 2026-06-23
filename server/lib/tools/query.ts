import type { ToolHandler } from "../types";
import { db, schema } from "../../db/client";
import { eq, asc } from "drizzle-orm";
import { parseLayout } from "../layout";
import { renderLayoutPng } from "../layoutImage";
import { getUploadsDir } from "../config";
import { newId } from "../nanoid";
import { writeFileSync } from "fs";
import { resolve } from "path";

export const queryTools: Record<string, ToolHandler> = {
  get_project_status: async (_args, projectId) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) return { success: false, result: "Project not found" };

    const images = await db.select().from(schema.images)
      .where(eq(schema.images.projectId, projectId))
      .orderBy(asc(schema.images.order));

    const statusCounts: Record<string, number> = {};
    for (const img of images) statusCounts[img.status] = (statusCounts[img.status] ?? 0) + 1;

    return {
      success: true,
      result: {
        project: {
          id: project.id,
          name: project.name,
          aspectRatio: project.aspectRatio,
          megapixels: project.megapixels,
          width: project.width,
          height: project.height,
          promptFormat: project.promptFormat,
          defaultWorkflowId: project.defaultWorkflowId,
        },
        imageCount: images.length,
        statusCounts,
        images: images.map(summarizeImage),
      },
    };
  },

  list_images: async (_args, projectId) => {
    const images = await db.select().from(schema.images)
      .where(eq(schema.images.projectId, projectId))
      .orderBy(asc(schema.images.order));
    return { success: true, result: { images: images.map(summarizeImage) } };
  },

  describe_image: async (args, projectId) => {
    const imageId = args.image_id as string;
    const [img] = await db.select().from(schema.images).where(eq(schema.images.id, imageId));
    if (!img || img.projectId !== projectId) return { success: false, result: "Image not found in this project" };
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    const layout = parseLayout(img.layout);
    const W = project?.width ?? 1024;
    const H = project?.height ?? 1024;
    // Per-region on-screen size feedback: the 0–1000 grid is normalized per
    // axis, so spans translate to different pixels on each axis. Surfacing the
    // pixel size + on-screen aspect helps the agent shape boxes in proportion.
    const regionPixelSizes = layout.compositional_deconstruction.map((r, i) => {
      const [yMin, xMin, yMax, xMax] = r.bounding_box;
      const pxW = Math.round(((xMax - xMin) / 1000) * W);
      const pxH = Math.round(((yMax - yMin) / 1000) * H);
      // Report positions as named edges (x_min/y_min/x_max/y_max) — the same
      // vocabulary the editing tools use — so the agent never has to read the
      // raw y-first array.
      return {
        index: i, id: r.id,
        x_min: xMin, y_min: yMin, x_max: xMax, y_max: yMax,
        pixelWidth: pxW, pixelHeight: pxH, onScreenAspect: pxH ? +(pxW / pxH).toFixed(2) : null,
      };
    });
    return {
      success: true,
      result: {
        id: img.id,
        name: img.name,
        order: img.order,
        status: img.status,
        seed: img.seed,
        assetId: img.assetId,
        filePath: img.filePath,
        lastError: img.lastError,
        canvas: { width: W, height: H, squareFactor: +(H / W).toFixed(3) },
        layout,
        regionPixelSizes,
        plainPrompt: img.plainPrompt,
        negativePrompt: img.negativePrompt,
      },
    };
  },
  // Render an ASCII schematic of the layout so the agent can "see" where its
  // boxes land — drawn to scale on a character grid that is itself aspect-
  // correct, so orientation and proportions are visible at a glance.
  render_layout: async (args, projectId) => {
    const imageId = args.image_id as string;
    const [img] = await db.select().from(schema.images).where(eq(schema.images.id, imageId));
    if (!img || img.projectId !== projectId) return { success: false, result: "Image not found in this project" };
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    const W = project?.width ?? 1024;
    const H = project?.height ?? 1024;
    const layout = parseLayout(img.layout);
    const regions = layout.compositional_deconstruction;

    const { ascii, legend } = renderLayoutAscii(regions, W, H);
    return {
      success: true,
      result: {
        canvas: `${W}x${H}px`,
        orientation: W > H ? "landscape (wider than tall)" : W < H ? "portrait (taller than wide)" : "square",
        note: "Schematic only (box positions/sizes), not the generated picture. Each box is drawn to scale; the grid matches the canvas aspect. '·' = empty.",
        schematic: ascii,
        legend,
      },
    };
  },

  // Render an actual PNG wireframe of the boxes and hand it to the (vision)
  // agent to look at. The chat loop detects this tool and attaches the image as
  // a vision message so the model literally sees the layout for verification.
  render_layout_image: async (args, projectId) => {
    const imageId = args.image_id as string;
    const [img] = await db.select().from(schema.images).where(eq(schema.images.id, imageId));
    if (!img || img.projectId !== projectId) return { success: false, result: "Image not found in this project" };
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    const W = project?.width ?? 1024;
    const H = project?.height ?? 1024;
    const layout = parseLayout(img.layout);
    if (layout.compositional_deconstruction.length === 0) {
      return { success: false, result: "This frame has no regions yet — add some, then render." };
    }
    try {
      const png = renderLayoutPng(layout, W, H);
      const file = `.layout-preview-${newId()}.png`;
      writeFileSync(resolve(getUploadsDir(), file), png);
      return {
        success: true,
        result: {
          rendered: true,
          file,
          canvas: `${W}x${H}px`,
          regionCount: layout.compositional_deconstruction.length,
          note: "A labeled wireframe of the boxes is attached as an image. Look at it and confirm each box is positioned and proportioned correctly for this canvas; fix any that look stretched, overlapping wrong, or mis-placed.",
        },
      };
    } catch (e) {
      return { success: false, result: `Render failed: ${(e as Error).message}` };
    }
  },
};

const BOX_SYMBOLS = "123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function renderLayoutAscii(
  regions: ReturnType<typeof parseLayout>["compositional_deconstruction"],
  W: number,
  H: number,
): { ascii: string; legend: string[] } {
  const cols = 48;
  // A character cell is ~2x taller than wide, so scale rows by ~0.5 to keep the
  // ASCII block's visual shape matching the real canvas aspect.
  let rows = Math.round(cols * (H / W) * 0.5);
  rows = Math.max(6, Math.min(64, rows));
  const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
  const grid: string[][] = Array.from({ length: rows }, () => Array(cols).fill("·"));

  const legend: string[] = [];
  regions.forEach((r, i) => {
    const sym = BOX_SYMBOLS[i] ?? "#";
    const [yMin, xMin, yMax, xMax] = r.bounding_box;
    const c0 = clamp(Math.round((Math.min(xMin, xMax) / 1000) * (cols - 1)), 0, cols - 1);
    const c1 = clamp(Math.round((Math.max(xMin, xMax) / 1000) * (cols - 1)), 0, cols - 1);
    const r0 = clamp(Math.round((Math.min(yMin, yMax) / 1000) * (rows - 1)), 0, rows - 1);
    const r1 = clamp(Math.round((Math.max(yMin, yMax) / 1000) * (rows - 1)), 0, rows - 1);
    // Draw the rectangle border using the region's symbol (later boxes overwrite,
    // so nested/overlapping boxes stay visible).
    for (let c = c0; c <= c1; c++) { grid[r0][c] = sym; grid[r1][c] = sym; }
    for (let rr = r0; rr <= r1; rr++) { grid[rr][c0] = sym; grid[rr][c1] = sym; }

    const pxW = Math.round(((Math.max(xMin, xMax) - Math.min(xMin, xMax)) / 1000) * W);
    const pxH = Math.round(((Math.max(yMin, yMax) - Math.min(yMin, yMax)) / 1000) * H);
    const a = pxH ? +(pxW / pxH).toFixed(2) : 0;
    const desc = (r.description || "").slice(0, 50);
    legend.push(`${sym} = region ${i + 1}: x ${Math.min(xMin, xMax)}–${Math.max(xMin, xMax)}, y ${Math.min(yMin, yMax)}–${Math.max(yMin, yMax)}, ~${pxW}x${pxH}px (aspect ${a}:1)${desc ? ` — ${desc}` : ""}`);
  });

  const ascii = grid.map((row) => row.join("")).join("\n");
  return { ascii, legend };
}

function summarizeImage(img: typeof schema.images.$inferSelect) {
  let highLevel = "";
  let regionCount = 0;
  try {
    const layout = parseLayout(img.layout);
    highLevel = layout.high_level_description;
    regionCount = layout.compositional_deconstruction.length;
  } catch { /* ignore malformed */ }
  return {
    id: img.id,
    order: img.order,
    name: img.name,
    status: img.status,
    highLevelDescription: highLevel,
    regionCount,
    hasImage: !!img.assetId,
  };
}
