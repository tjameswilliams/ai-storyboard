import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { resolve } from "path";
import { existsSync, mkdirSync, statSync } from "fs";
import { writeFile, readFile } from "fs/promises";
import { db, schema } from "../../db/client";
import { getUploadsDir, getFfprobePath } from "../config";
import { newId } from "../nanoid";
import { embedAsset } from "../assetEmbeddings";
import { spawn } from "child_process";
import type { ToolHandler } from "../types";

// ── Search config ──

interface SearchConfig {
  provider: "brave" | "duckduckgo" | "google";
  apiKey: string;
  cx?: string;
}

async function getSearchConfig(): Promise<SearchConfig> {
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = {};
  for (const row of rows) map[row.key] = row.value;

  if (map.braveSearchApiKey) {
    return { provider: "brave", apiKey: map.braveSearchApiKey };
  }
  if (map.googleSearchApiKey && map.googleSearchCx) {
    return { provider: "google", apiKey: map.googleSearchApiKey, cx: map.googleSearchCx };
  }
  return { provider: "duckduckgo", apiKey: "" };
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function braveSearch(query: string, numResults: number, apiKey: string): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${numResults}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Brave Search error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  const results = data.web?.results || [];
  return results.slice(0, numResults).map((r) => ({
    title: r.title || "",
    url: r.url || "",
    snippet: r.description || "",
  }));
}

async function googleSearch(query: string, numResults: number, apiKey: string, cx: string): Promise<SearchResult[]> {
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(query)}&num=${Math.min(numResults, 10)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google Search error ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { items?: Array<{ title?: string; link?: string; snippet?: string }> };
  return (data.items || []).map((item) => ({
    title: item.title || "",
    url: item.link || "",
    snippet: item.snippet || "",
  }));
}

async function duckDuckGoSearch(query: string, numResults: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    throw new Error(`Search failed: ${res.status} ${res.statusText}`);
  }

  const html = await res.text();
  if (html.includes("anomaly-modal") || html.includes("anomaly.js") || res.status === 202) {
    throw new Error(
      "DuckDuckGo is rate-limiting this IP (CAPTCHA challenge). Configure a Brave Search API key in Settings → Web for reliable web search (free at https://brave.com/search/api/).",
    );
  }

  const dom = new JSDOM(html);
  const doc = dom.window.document;
  const results: SearchResult[] = [];
  const links = doc.querySelectorAll(".result__a");

  for (const link of links) {
    if (results.length >= numResults) break;
    const el = link as HTMLAnchorElement;
    const title = el.textContent?.trim() || "";
    let href = el.getAttribute("href") || "";
    if (href.includes("uddg=")) {
      try {
        const parsed = new URL(href, "https://duckduckgo.com");
        href = decodeURIComponent(parsed.searchParams.get("uddg") || href);
      } catch { /* keep */ }
    }
    const resultNode = el.closest(".result");
    const snippetEl = resultNode?.querySelector(".result__snippet");
    const snippet = snippetEl?.textContent?.trim() || "";
    if (title && href && !href.startsWith("/") && !href.startsWith("javascript")) {
      results.push({ title, url: href, snippet });
    }
  }
  return results;
}

async function webSearch(query: string, numResults: number): Promise<SearchResult[]> {
  const config = await getSearchConfig();
  switch (config.provider) {
    case "brave": return braveSearch(query, numResults, config.apiKey);
    case "google": return googleSearch(query, numResults, config.apiKey, config.cx!);
    case "duckduckgo": return duckDuckGoSearch(query, numResults);
  }
}

// ── Webpage extraction ──

interface PageContent {
  title: string;
  byline: string | null;
  content: string;
  excerpt: string | null;
  url: string;
  wordCount: number;
}

async function fetchAndExtract(url: string, maxLength: number): Promise<PageContent> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("html") && !contentType.includes("text")) {
      throw new Error(`Not an HTML page (content-type: ${contentType}).`);
    }

    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const doc = dom.window.document;

    const reader = new Readability(doc);
    const article = reader.parse();

    let text: string;
    let title: string;
    let byline: string | null = null;
    let excerpt: string | null = null;

    if (article && article.textContent && article.textContent.length > 100) {
      text = article.textContent;
      title = article.title || doc.title || url;
      byline = article.byline ?? null;
      excerpt = article.excerpt ?? null;
    } else {
      for (const tag of ["script", "style", "nav", "header", "footer", "aside", "iframe", "noscript"]) {
        doc.querySelectorAll(tag).forEach((el) => el.remove());
      }
      text = doc.body?.textContent || "";
      title = doc.title || url;
    }

    text = text.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
    if (text.length > maxLength) {
      text = text.slice(0, maxLength) + `\n\n[Content truncated at ${maxLength} characters]`;
    }
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    return { title, byline, content: text, excerpt, url, wordCount };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Image dimension probe (ffprobe, best-effort) ──

function probeImageDimensions(filePath: string): Promise<{ width?: number; height?: number }> {
  return new Promise((resolvePromise) => {
    const proc = spawn(getFfprobePath(), [
      "-v", "quiet", "-print_format", "json", "-show_streams", filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => { out += d.toString(); });
    proc.on("close", () => {
      try {
        const info = JSON.parse(out);
        const stream = info.streams?.find((s: Record<string, unknown>) => s.codec_type === "video");
        resolvePromise({
          width: stream?.width as number | undefined,
          height: stream?.height as number | undefined,
        });
      } catch {
        resolvePromise({});
      }
    });
    proc.on("error", () => resolvePromise({}));
  });
}

// ── Tool handlers ──

function ensureUploadsDir(): string {
  const dir = getUploadsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "tiff"]);

function extFromContentType(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  if (contentType.includes("bmp")) return "bmp";
  if (contentType.includes("tiff")) return "tiff";
  return "png";
}

export const webTools: Record<string, ToolHandler> = {
  web_search: async (args) => {
    const query = args.query as string;
    const numResults = Math.min((args.num_results as number) || 8, 20);
    const results = await webSearch(query, numResults);
    return {
      success: true,
      result: {
        query,
        resultCount: results.length,
        results: results.map((r, i) => ({ rank: i + 1, title: r.title, url: r.url, snippet: r.snippet })),
      },
    };
  },

  fetch_webpage: async (args) => {
    const url = args.url as string;
    const maxLength = (args.max_length as number) || 15000;
    const page = await fetchAndExtract(url, maxLength);
    return {
      success: true,
      result: {
        title: page.title,
        byline: page.byline,
        url: page.url,
        wordCount: page.wordCount,
        excerpt: page.excerpt,
        content: page.content,
      },
    };
  },

  download_image: async (args, projectId) => {
    const imageUrl = args.url as string;
    const description = (args.description as string) || "";
    const sourcePageUrl = (args.source_page_url as string) || "";

    const uploadsDir = ensureUploadsDir();
    const isLocalPath =
      !imageUrl.startsWith("http://") && !imageUrl.startsWith("https://") && !imageUrl.startsWith("data:");

    try {
      let ext = "png";
      let storedName: string;
      let filePath: string;
      let sizeBytes: number;
      let originalFileName: string;

      if (isLocalPath) {
        const sourcePath = imageUrl.startsWith("file://") ? imageUrl.slice(7) : imageUrl;
        if (!existsSync(sourcePath)) {
          return { success: false, result: `Local file not found: ${sourcePath}` };
        }
        const sourceExt = sourcePath.split(".").pop()?.toLowerCase() || "";
        if (IMAGE_EXTS.has(sourceExt)) ext = sourceExt === "jpeg" ? "jpg" : sourceExt;
        originalFileName = sourcePath.split("/").pop() || `image.${ext}`;
        storedName = `${newId()}.${ext}`;
        filePath = resolve(uploadsDir, storedName);
        const data = await readFile(sourcePath);
        await writeFile(filePath, data);
        sizeBytes = statSync(filePath).size;
      } else {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          const res = await fetch(imageUrl, {
            signal: controller.signal,
            headers: {
              "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
            },
            redirect: "follow",
          });
          clearTimeout(timeout);
          if (!res.ok) return { success: false, result: `Failed to download image: HTTP ${res.status}` };
          const contentType = res.headers.get("content-type") || "";
          ext = extFromContentType(contentType);
          const urlPath = (() => {
            try { return new URL(imageUrl).pathname; } catch { return imageUrl; }
          })();
          const urlExt = urlPath.split(".").pop()?.toLowerCase() || "";
          if (IMAGE_EXTS.has(urlExt)) ext = urlExt === "jpeg" ? "jpg" : urlExt;
          originalFileName = urlPath.split("/").pop() || `image.${ext}`;
          storedName = `${newId()}.${ext}`;
          filePath = resolve(uploadsDir, storedName);
          const arrayBuffer = await res.arrayBuffer();
          await writeFile(filePath, Buffer.from(arrayBuffer));
          sizeBytes = arrayBuffer.byteLength;
        } catch (err) {
          clearTimeout(timeout);
          throw err;
        }
      }

      const { width, height } = await probeImageDimensions(filePath);
      const assetId = newId();
      const now = new Date().toISOString();
      const promptText = description || originalFileName;

      await db.insert(schema.assets).values({
        id: assetId,
        projectId,
        type: "image",
        filePath: storedName,
        fileName: originalFileName,
        prompt: promptText,
        generationTool: "web_download",
        generationParams: JSON.stringify({
          sourceUrl: imageUrl,
          sourcePageUrl: sourcePageUrl || undefined,
        }),
        width,
        height,
        fileSize: sizeBytes,
        createdAt: now,
        updatedAt: now,
      });

      if (promptText) embedAsset(assetId, promptText).catch(() => {});

      const localUrl = `/api/uploads/${storedName}`;
      return {
        success: true,
        result: {
          assetId,
          localUrl,
          filePath: storedName,
          fileName: originalFileName,
          width,
          height,
          sizeBytes,
          sourceUrl: imageUrl,
          message: `Image saved to asset library (assetId=${assetId}). Reference it with this asset ID or the local URL ${localUrl}.`,
        },
      };
    } catch (err) {
      return { success: false, result: `Download failed: ${(err as Error).message}` };
    }
  },
};
