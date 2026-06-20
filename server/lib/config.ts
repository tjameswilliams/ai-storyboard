import { join } from "path";
import { existsSync, mkdirSync } from "fs";

let dataDir = process.cwd();
let ffmpegPath = "ffmpeg";
let ffprobePath = "ffprobe";
let migrationsDir = "";
let apiPort: number | null = null;

export function configure(opts: {
  dataDir: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  migrationsDir?: string;
}) {
  dataDir = opts.dataDir;
  if (opts.ffmpegPath) ffmpegPath = opts.ffmpegPath;
  if (opts.ffprobePath) ffprobePath = opts.ffprobePath;
  if (opts.migrationsDir) migrationsDir = opts.migrationsDir;

  // Ensure directories exist
  const uploads = getUploadsDir();
  if (!existsSync(uploads)) {
    mkdirSync(uploads, { recursive: true });
  }
}

export function getDataDir(): string {
  return dataDir;
}

export function getDbPath(): string {
  return join(dataDir, "data.db");
}

export function getUploadsDir(): string {
  return join(dataDir, "uploads");
}

export function getFfmpegPath(): string {
  return ffmpegPath;
}

export function getFfprobePath(): string {
  return ffprobePath;
}

export function getMigrationsDir(): string {
  return migrationsDir;
}

/**
 * Record the port the API is actually bound to. In Bun-direct mode this is
 * the hardcoded constant from server/index.ts. In Electron the port is
 * picked dynamically (`net.createServer().listen(0)`), and that's the only
 * place it's known. Server-side consumers (notably the Remotion overlay
 * renderer, which spins up Chromium pointed at /api/uploads/...) read it
 * via getApiOrigin().
 */
export function setApiPort(port: number): void {
  apiPort = port;
}

export function getApiOrigin(): string | null {
  if (apiPort === null) return null;
  return `http://127.0.0.1:${apiPort}`;
}
