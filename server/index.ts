import { Hono } from "hono";
import { cors } from "hono/cors";
import projects from "./routes/projects";
import images from "./routes/images";
import messages from "./routes/messages";
import settingsRoutes from "./routes/settings";
import chat from "./routes/chat";
import uploads from "./routes/uploads";
import mcpServerRoutes from "./routes/mcpServers";
import undo from "./routes/undo";
import comfyuiRoutes from "./routes/comfyui";
import planRoutes from "./routes/plans";
import folderRoutes from "./routes/folders";
import assetRoutes from "./routes/assets";
import styleguideRoutes from "./routes/styleguides";
import exportRoutes from "./routes/export";
import { mcpClientManager } from "./lib/mcp/clientManager";
import { seedDefaultStyleguides } from "./lib/seedDefaults";

const app = new Hono();

// Seed bundled default styleguides on first run (idempotent, one-time flag).
seedDefaultStyleguides()
  .then((n) => { if (n > 0) console.log(`[seed] inserted ${n} default styleguide(s)`); })
  .catch((err) => console.error("[seed] default styleguides failed:", err));

app.use("/api/*", cors({ origin: "*" }));

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/projects", projects);
app.route("/api", images);
app.route("/api", messages);
app.route("/api", settingsRoutes);
app.route("/api", chat);
app.route("/api", uploads);
app.route("/api", mcpServerRoutes);
app.route("/api", undo);
app.route("/api", comfyuiRoutes);
app.route("/api", planRoutes);
app.route("/api", folderRoutes);
app.route("/api", assetRoutes);
app.route("/api", styleguideRoutes);
app.route("/api", exportRoutes);

// Init external MCP connections on startup
mcpClientManager.initAll().catch((err) =>
  console.error("[mcp-client] Init failed:", err)
);

const port = 3084;

const isBun = typeof globalThis.Bun !== "undefined";
const isElectron = typeof process !== "undefined" && process.versions && !!process.versions.electron;

if (!isBun && !isElectron) {
  const { serve } = await import("@hono/node-server");
  const server = serve({ fetch: app.fetch, port });
  console.log(`[server] Listening on http://localhost:${port}`);
  (globalThis as Record<string, unknown>).__honoServer = server;
  const { setApiPort } = await import("./lib/config");
  setApiPort(port);
}

if (isBun) {
  // Bun's `export default { port, fetch }` server is bound by the runtime
  // before this module finishes evaluating, so by the time anything calls
  // getApiOrigin() the port has already been claimed.
  const { setApiPort } = await import("./lib/config");
  setApiPort(port);
}

export { app, port };

export default {
  port,
  fetch: app.fetch,
  idleTimeout: 0,
  maxRequestBodySize: 1024 * 1024 * 500,
};
