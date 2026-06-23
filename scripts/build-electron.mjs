import * as esbuild from "esbuild";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

mkdirSync(resolve(root, "electron/dist"), { recursive: true });

// Bundle the Electron main process (main.ts + all server code) into a single file.
// External: electron (provided by runtime), better-sqlite3 (native module), node builtins.
await esbuild.build({
  entryPoints: ["electron/main.ts"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "electron/dist/main.mjs",
  sourcemap: true,
  external: [
    "electron",
    "better-sqlite3",
    "@napi-rs/canvas",
    // esbuild ships its parser as a native binary located via a relative path
    // from the API source. Bundling it breaks that path resolution.
    "esbuild",
    // bun:sqlite is only imported conditionally under Bun — never reached in Node
    "bun:sqlite",
    "drizzle-orm/bun-sqlite",
    "drizzle-orm/bun-sqlite/migrator",
    // jsdom reads its default-stylesheet.css via a path relative to its own
    // source file; bundling breaks that resolution. @mozilla/readability pulls
    // in jsdom types only but keep them together to be safe.
    "jsdom",
    "@mozilla/readability",
  ],
  banner: {
    // Provide __dirname and __filename for ESM compatibility, and require() for native modules
    js: `
import { fileURLToPath as __fileURLToPath } from "url";
import { dirname as __pathDirname } from "path";
import { createRequire as __createRequire } from "module";
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);
const require = __createRequire(import.meta.url);
    `.trim(),
  },
});

// Bundle the preload script separately as CJS
await esbuild.build({
  entryPoints: ["electron/preload.cjs"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: "electron/dist/preload.cjs",
  sourcemap: true,
  external: ["electron"],
});

console.log("Electron build complete.");
