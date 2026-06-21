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

  // Full-bleed layout: images tile edge-to-edge with no page margins or gutters.
  // Each page's height is sized exactly to the rows it holds, so there is no
  // white border on any edge. With rows-per-page = columns, every full page is
  // exactly the project's aspect ratio. Cells preserve the image aspect, so
  // images are never distorted. Captions (optional) overlay the image bottom as
  // a translucent bar rather than reserving layout space.
  const PAGE_W = 1200;
  const aspect = data.project.width / data.project.height; // w/h
  const cellW = PAGE_W / columns;
  const imgH = cellW / aspect;
  const rowsPerPage = columns;

  const total = data.images.length;
  const totalRows = Math.max(1, Math.ceil(total / columns));

  for (let startRow = 0; startRow < totalRows; startRow += rowsPerPage) {
    const rowsThisPage = Math.min(rowsPerPage, totalRows - startRow);
    const pageH = rowsThisPage * imgH;
    const page = doc.addPage([PAGE_W, pageH]);

    for (let r = 0; r < rowsThisPage; r++) {
      for (let c = 0; c < columns; c++) {
        const i = (startRow + r) * columns + c;
        if (i >= total) break;
        const img = data.images[i];
        const x = c * cellW;
        const y = pageH - (r + 1) * imgH; // bottom-left of the cell

        const file = img.filePath ? imageBytes(img.filePath) : null;
        if (file) {
          try {
            const embedded = file.kind === "jpg" ? await doc.embedJpg(file.bytes) : await doc.embedPng(file.bytes);
            page.drawImage(embedded, { x, y, width: cellW, height: imgH });
          } catch {
            drawPlaceholder(page, x, y, cellW, imgH, font, "render error");
          }
        } else {
          drawPlaceholder(page, x, y, cellW, imgH, font, img.status === "generating" ? "generating…" : "not generated");
        }

        if (captions) {
          const barH = Math.min(26, Math.max(15, imgH * 0.06));
          const size = Math.min(11, Math.max(8, Math.round(barH * 0.45)));
          page.drawRectangle({ x, y, width: cellW, height: barH, color: rgb(0, 0, 0), opacity: 0.55 });
          const caption = `${i + 1}. ${img.name || ""}`.trim();
          page.drawText(truncate(caption, font, size, cellW - 12), {
            x: x + 6,
            y: y + (barH - size) / 2 + 1,
            size,
            font,
            color: rgb(1, 1, 1),
          });
        }
      }
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
  page.drawRectangle({ x, y, width: w, height: h, color: rgb(0.12, 0.12, 0.14) });
  const size = 9;
  const tw = font.widthOfTextAtSize(label, size);
  page.drawText(label, { x: x + (w - tw) / 2, y: y + h / 2 - 4, size, font, color: rgb(0.5, 0.5, 0.55) });
}

function truncate(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxW: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxW) return text;
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t + "…", size) > maxW) t = t.slice(0, -1);
  return t + "…";
}

export default app;
