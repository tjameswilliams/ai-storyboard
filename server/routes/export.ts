import { Hono } from "hono";
import { db, schema } from "../db/client";
import { eq, asc } from "drizzle-orm";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { getUploadsDir } from "../lib/config";
import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const app = new Hono();

function safeName(s: string): string {
  return (s || "").replace(/[^a-z0-9-_ ]/gi, "").trim().replace(/\s+/g, "_").slice(0, 60);
}

function imageBytes(filePath: string): { bytes: Uint8Array; kind: "png" | "jpg" } | null {
  const full = resolve(getUploadsDir(), filePath);
  if (!existsSync(full)) return null;
  const buf = readFileSync(full);
  const bytes = new Uint8Array(buf);
  // Detect by magic number; default to png.
  const kind = bytes[0] === 0xff && bytes[1] === 0xd8 ? "jpg" : "png";
  return { bytes, kind };
}

async function loadProjectAndImages(projectId: string) {
  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!project) return null;
  const images = await db.select().from(schema.images)
    .where(eq(schema.images.projectId, projectId))
    .orderBy(asc(schema.images.order));
  return { project, images };
}

// --- ZIP: each generated image, numbered in sequence ---
app.get("/projects/:projectId/export/zip", async (c) => {
  const data = await loadProjectAndImages(c.req.param("projectId"));
  if (!data) return c.json({ error: "Project not found" }, 404);

  const zip = new JSZip();
  let count = 0;
  for (const img of data.images) {
    if (!img.filePath) continue;
    const file = imageBytes(img.filePath);
    if (!file) continue;
    count++;
    const seq = String(count).padStart(3, "0");
    const label = safeName(img.name || "");
    const name = label ? `${seq}_${label}.${file.kind}` : `${seq}.${file.kind}`;
    zip.file(name, file.bytes);
  }

  if (count === 0) return c.json({ error: "No generated images to export" }, 400);

  const content = await zip.generateAsync({ type: "uint8array" });
  return new Response(content, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safeName(data.project.name) || "storyboard"}.zip"`,
    },
  });
});

// --- PDF: storyboard grid in N columns (1-6) ---
app.get("/projects/:projectId/export/pdf", async (c) => {
  const data = await loadProjectAndImages(c.req.param("projectId"));
  if (!data) return c.json({ error: "Project not found" }, 404);

  const columns = Math.max(1, Math.min(6, parseInt(c.req.query("columns") || "2", 10) || 2));
  const captions = c.req.query("captions") !== "0";

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // US Letter portrait.
  const PAGE_W = 612;
  const PAGE_H = 792;
  const MARGIN = 36;
  const GUTTER = 14;
  const CAPTION_H = captions ? 13 : 0;
  const ROW_GAP = 16;

  const aspect = data.project.width / data.project.height; // w/h
  const cellW = (PAGE_W - 2 * MARGIN - (columns - 1) * GUTTER) / columns;
  const imgH = cellW / aspect;
  const rowH = imgH + CAPTION_H + ROW_GAP;

  let page = doc.addPage([PAGE_W, PAGE_H]);
  let col = 0;
  let yTop = PAGE_H - MARGIN; // top of the current row

  const newRowIfNeeded = () => {
    if (yTop - rowH < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H]);
      yTop = PAGE_H - MARGIN;
    }
  };

  for (let i = 0; i < data.images.length; i++) {
    const img = data.images[i];
    if (col === 0) newRowIfNeeded();

    const x = MARGIN + col * (cellW + GUTTER);
    const imgY = yTop - imgH; // bottom-left y of the image

    const file = img.filePath ? imageBytes(img.filePath) : null;
    if (file) {
      try {
        const embedded = file.kind === "jpg" ? await doc.embedJpg(file.bytes) : await doc.embedPng(file.bytes);
        page.drawImage(embedded, { x, y: imgY, width: cellW, height: imgH });
      } catch {
        drawPlaceholder(page, x, imgY, cellW, imgH, font, "render error");
      }
    } else {
      drawPlaceholder(page, x, imgY, cellW, imgH, font, img.status === "generating" ? "generating…" : "not generated");
    }

    if (captions) {
      const caption = `${i + 1}. ${img.name || ""}`.trim();
      page.drawText(truncate(caption, font, 8, cellW), {
        x,
        y: imgY - 10,
        size: 8,
        font,
        color: rgb(0.25, 0.25, 0.25),
      });
    }

    col++;
    if (col >= columns) {
      col = 0;
      yTop -= rowH;
    }
  }

  const bytes = await doc.save();
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${safeName(data.project.name) || "storyboard"}.pdf"`,
    },
  });
});

function drawPlaceholder(
  page: ReturnType<PDFDocument["addPage"]>,
  x: number, y: number, w: number, h: number,
  font: Awaited<ReturnType<PDFDocument["embedFont"]>>,
  label: string,
) {
  page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1, color: rgb(0.96, 0.96, 0.96) });
  const size = 8;
  const tw = font.widthOfTextAtSize(label, size);
  page.drawText(label, { x: x + (w - tw) / 2, y: y + h / 2 - 4, size, font, color: rgb(0.6, 0.6, 0.6) });
}

function truncate(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxW) t = t.slice(0, -1);
  return t + "…";
}

export default app;
