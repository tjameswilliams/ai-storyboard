import { app, BrowserWindow, Menu, dialog } from "electron";
import path from "path";
import net from "net";

// Set app name before anything else so userData goes to the right directory
app.setName("AI Storyboard");

// ASB_DATA_DIR overrides BOTH the server's data dir (DB + uploads) AND
// Electron's userData (Chromium profile lockfiles, cookies). Without
// redirecting userData, a second instance would fail to launch with a
// "profile in use" error from Chromium's Singleton lock. Must run before
// the `ready` event fires.
if (process.env.ASB_DATA_DIR) {
  const isolated = path.resolve(process.env.ASB_DATA_DIR);
  app.setPath("userData", isolated);
}

let mainWindow: BrowserWindow | null = null;
let server: any = null;

async function getAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        reject(new Error("Could not determine port"));
      }
    });
    srv.on("error", reject);
  });
}

async function startServer(port: number) {
  const { configure } = await import("../server/lib/config");
  const { getFfmpegPaths } = await import("./ffmpeg-paths");

  // userData has already been redirected at startup if ASB_DATA_DIR was set,
  // so this single read is correct for both the default and isolated cases.
  const dataDir = app.getPath("userData");
  const { ffmpeg, ffprobe } = getFfmpegPaths();

  const projectRoot = path.join(__dirname, "..", "..");

  configure({
    dataDir,
    ffmpegPath: ffmpeg,
    ffprobePath: ffprobe,
    migrationsDir: path.join(projectRoot, "drizzle"),
  });

  const { app: honoApp } = await import("../server/index");

  const { serveStatic } = await import("@hono/node-server/serve-static");
  const clientDistPath = path.join(projectRoot, "client", "dist");

  honoApp.use("/*", serveStatic({ root: clientDistPath }));

  honoApp.get("/*", async (c: any) => {
    const fs = await import("fs");
    const indexPath = path.join(clientDistPath, "index.html");
    if (fs.existsSync(indexPath)) {
      const html = fs.readFileSync(indexPath, "utf-8");
      return c.html(html);
    }
    return c.text("Client not built. Run: npm run build:client", 404);
  });

  const { serve } = await import("@hono/node-server");
  server = serve({ fetch: honoApp.fetch, port });
  const { setApiPort } = await import("../server/lib/config");
  setApiPort(port);
  console.log(`[electron] Server listening on http://localhost:${port}`);
  return port;
}

function createWindow(port: number) {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "AI Storyboard",
    icon: path.join(__dirname, "..", "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${port}`);

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "AI Storyboard",
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { role: "close" },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  try {
    // Set dock icon on macOS
    const iconPath = path.join(__dirname, "..", "..", "build", "icon.png");
    if (process.platform === "darwin" && app.dock) {
      const { nativeImage } = await import("electron");
      const icon = nativeImage.createFromPath(iconPath);
      if (!icon.isEmpty()) app.dock.setIcon(icon);
    }

    const port = await getAvailablePort();
    await startServer(port);
    createMenu();
    createWindow(port);
  } catch (err) {
    console.error("[electron] Failed to start:", err);
    dialog.showErrorBox(
      "AI Storyboard - Startup Error",
      `Failed to start the application:\n\n${err instanceof Error ? err.message : String(err)}`
    );
    app.quit();
  }
});

app.on("window-all-closed", async () => {
  if (server) {
    server.close();
    server = null;
  }

  try {
    const { sqlite } = await import("../server/db/client");
    sqlite.close();
  } catch {}

  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", async () => {
  if (mainWindow === null) {
    try {
      const port = await getAvailablePort();
      await startServer(port);
      createWindow(port);
    } catch (err) {
      console.error("[electron] Failed to reactivate:", err);
    }
  }
});
