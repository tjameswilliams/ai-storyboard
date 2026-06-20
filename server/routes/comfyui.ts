import { Hono } from "hono";
import { db, schema } from "../db/client";
import { eq, and } from "drizzle-orm";
import { newId } from "../lib/nanoid";
import {
  getComfyConfig,
  setComfyConfig,
  analyzeWorkflow,
  testConnection,
  getComfyDisabledWorkflowIds,
  setComfyDisabledWorkflowIds,
} from "../lib/comfyuiClient";

const app = new Hono();

// Get ComfyUI plugin config
app.get("/plugins/comfyui/config", async (c) => {
  const config = await getComfyConfig();
  return c.json(config);
});

// Update ComfyUI plugin config
app.put("/plugins/comfyui/config", async (c) => {
  const body = await c.req.json();
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") {
      await setComfyConfig(key, value);
    }
  }
  const config = await getComfyConfig();
  return c.json(config);
});

// Test ComfyUI connection
app.post("/plugins/comfyui/test", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const config = await getComfyConfig();
  const url = (body.baseUrl as string) || config.baseUrl || "http://localhost:8188";
  const ok = await testConnection(url);
  return c.json({ success: ok, url });
});

// Analyze a workflow JSON
app.post("/plugins/comfyui/analyze-workflow", async (c) => {
  const body = await c.req.json();
  const workflowJson = body.workflowJson as string;
  if (!workflowJson) return c.json({ error: "No workflowJson provided" }, 400);
  const analysis = analyzeWorkflow(workflowJson);
  return c.json(analysis);
});

// List saved workflows
app.get("/plugins/comfyui/workflows", async (c) => {
  const disabledIds = await getComfyDisabledWorkflowIds();
  const rows = await db.select().from(schema.workflows)
    .where(eq(schema.workflows.pluginId, "comfyui"));
  return c.json(rows.map((r) => ({
    ...r,
    enabled: !disabledIds.has(r.id),
    workflowJson: undefined, // Don't send full JSON in list
  })));
});

// Get a specific workflow (with JSON)
app.get("/plugins/comfyui/workflows/:id", async (c) => {
  const id = c.req.param("id");
  const disabledIds = await getComfyDisabledWorkflowIds();
  const [row] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, id));
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ ...row, enabled: !disabledIds.has(row.id) });
});

// Create workflow
app.post("/plugins/comfyui/workflows", async (c) => {
  const body = await c.req.json();
  const now = new Date().toISOString();

  // Auto-analyze if workflowJson provided
  let analysis: ReturnType<typeof analyzeWorkflow> | null = null;
  if (body.workflowJson) {
    analysis = analyzeWorkflow(body.workflowJson);
  }

  const id = newId();
  await db.insert(schema.workflows).values({
    id,
    pluginId: "comfyui",
    name: body.name || "Untitled Workflow",
    description: body.description || "",
    workflowType: body.workflowType || analysis?.suggestedType || "t2i",
    workflowJson: body.workflowJson || null,
    promptNodeId: body.promptNodeId || analysis?.promptNodeId || null,
    outputNodeId: body.outputNodeId || analysis?.outputNodeId || null,
    imageInputNodeId: body.imageInputNodeId || analysis?.imageInputNodeId || null,
    endImageInputNodeId: body.endImageInputNodeId || analysis?.endImageInputNodeId || null,
    audioInputNodeId: body.audioInputNodeId || analysis?.audioInputNodeId || null,
    voiceInputNodeId: body.voiceInputNodeId || analysis?.voiceInputNodeId || null,
    defaultVoiceFile: body.defaultVoiceFile || null,
    defaultCfg: body.defaultCfg ?? analysis?.cfg ?? null,
    postfix: body.postfix || "",
    overrideBaseUrl: body.overrideBaseUrl || null,
    trimEndFrames: body.trimEndFrames ?? 0,
    isDefault: body.isDefault ? 1 : 0,
    createdAt: now,
    updatedAt: now,
  });

  const [created] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, id));
  return c.json({ ...created, enabled: true }, 201);
});

// Update workflow
app.put("/plugins/comfyui/workflows/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

  for (const key of ["name", "description", "workflowType", "workflowJson", "promptNodeId", "outputNodeId",
    "imageInputNodeId", "endImageInputNodeId", "audioInputNodeId", "voiceInputNodeId", "defaultVoiceFile", "defaultCfg", "postfix", "overrideBaseUrl", "trimEndFrames"]) {
    if (body[key] !== undefined) updates[key] = body[key];
  }
  if (body.isDefault !== undefined) updates.isDefault = body.isDefault ? 1 : 0;

  await db.update(schema.workflows).set(updates).where(eq(schema.workflows.id, id));
  if (body.enabled !== undefined) {
    const disabledIds = await getComfyDisabledWorkflowIds();
    if (body.enabled) disabledIds.delete(id);
    else disabledIds.add(id);
    await setComfyDisabledWorkflowIds(Array.from(disabledIds));
  }
  const [row] = await db.select().from(schema.workflows).where(eq(schema.workflows.id, id));
  const disabledIds = await getComfyDisabledWorkflowIds();
  return c.json({ ...row, enabled: !disabledIds.has(id) });
});

// Delete workflow
app.delete("/plugins/comfyui/workflows/:id", async (c) => {
  const id = c.req.param("id");
  await db.delete(schema.workflows).where(eq(schema.workflows.id, id));
  const disabledIds = await getComfyDisabledWorkflowIds();
  if (disabledIds.delete(id)) {
    await setComfyDisabledWorkflowIds(Array.from(disabledIds));
  }
  return c.json({ success: true });
});

export default app;
