import { Hono } from "hono";
import { newId } from "../lib/nanoid";
import { resolve } from "path";
import { existsSync, mkdirSync, statSync, createReadStream } from "fs";
import { writeFile, readFile } from "fs/promises";
import { Readable } from "stream";
import { getUploadsDir } from "../lib/config";
import { db, schema } from "../db/client";

function ensureUploadsDir(): string {
  const uploadsDir = getUploadsDir();
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }
  return uploadsDir;
}

const mimeTypes: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  svg: "image/svg+xml", pdf: "application/pdf", txt: "text/plain", json: "application/json",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", mkv: "video/x-matroska",
  wav: "audio/wav", mp3: "audio/mpeg", ogg: "audio/ogg", flac: "audio/flac",
};

const app = new Hono();

app.post("/uploads", async (c) => {
  const formData = await c.req.formData();
  const file = formData.get("file") as File;
  if (!file) return c.json({ error: "No file provided" }, 400);

  const id = newId();
  const ext = file.name.split(".").pop() || "bin";
  const storedName = `${id}.${ext}`;
  const filePath = resolve(ensureUploadsDir(), storedName);

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  await writeFile(filePath, buffer);

  // Track as an asset if projectId is provided
  const projectId = formData.get("projectId") as string | null;
  if (projectId) {
    const isImage = /\.(png|jpg|jpeg|gif|webp|svg|bmp|tiff)$/i.test(file.name);
    const isVideo = /\.(mp4|mov|webm|mkv|avi)$/i.test(file.name);
    const isAudio = /\.(wav|mp3|ogg|flac|aac|m4a)$/i.test(file.name);
    const assetType = isImage ? "image" : isVideo ? "video" : isAudio ? "audio" : null;

    if (assetType) {
      const now = new Date().toISOString();
      await db.insert(schema.assets).values({
        id: newId(),
        projectId,
        type: assetType,
        filePath: storedName,
        fileName: file.name,
        generationTool: "user_upload",
        fileSize: buffer.length,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return c.json({ url: `/api/uploads/${storedName}`, name: file.name });
});

app.get("/uploads/:filename", async (c) => {
  const filename = c.req.param("filename");
  const filePath = resolve(ensureUploadsDir(), filename);

  if (!existsSync(filePath)) return c.json({ error: "File not found" }, 404);

  const stat = statSync(filePath);
  const fileSize = stat.size;
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const contentType = mimeTypes[ext] || "application/octet-stream";

  // Handle Range requests for video/audio seeking
  const rangeHeader = c.req.header("range");
  if (rangeHeader) {
    const parts = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = createReadStream(filePath, { start, end });
    const webStream = Readable.toWeb(stream as unknown as Readable) as ReadableStream;

    return new Response(webStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize.toString(),
        "Content-Type": contentType,
      },
    });
  }

  // Non-range request: return full file with Accept-Ranges header
  const data = await readFile(filePath);
  return new Response(data, {
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Type": contentType,
      "Content-Length": fileSize.toString(),
    },
  });
});

export default app;
