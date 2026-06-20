import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { resolve } from "path";
import { existsSync, statSync } from "fs";
import { newId } from "./nanoid";
import { getUploadsDir } from "./config";
import { getComfyConfig, resolveWorkflow, executeWorkflow } from "./comfyuiClient";
import { serializeLayout, parseLayout } from "./layout";
import { embedAsset } from "./assetEmbeddings";

export interface GenerateOptions {
  seed?: number;
  workflowId?: string;
}

export interface GenerateOutcome {
  success: boolean;
  imageId: string;
  assetId?: string;
  filePath?: string;
  seed?: number;
  error?: string;
}

/**
 * Generate (or regenerate) the picture for one storyboard image from its
 * current layout. Shared by the REST route (UI "Generate" button) and the
 * agent `generate_image` tool so there's exactly one code path.
 *
 * For Ideogram-format projects the structured layout JSON is serialized and
 * sent verbatim as the prompt (rawPrompt). For plaintext projects the image's
 * plainPrompt/negativePrompt are used instead.
 */
export async function runImageGeneration(imageId: string, opts: GenerateOptions = {}): Promise<GenerateOutcome> {
  const [image] = await db.select().from(schema.images).where(eq(schema.images.id, imageId));
  if (!image) return { success: false, imageId, error: "Image not found" };

  const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, image.projectId));
  if (!project) return { success: false, imageId, error: "Project not found" };

  const isIdeogram = (project.promptFormat ?? "ideogram") === "ideogram";

  let prompt: string;
  let negativePrompt: string | undefined;
  if (isIdeogram) {
    prompt = serializeLayout(parseLayout(image.layout));
    if (!prompt || prompt === "{}") {
      return { success: false, imageId, error: "Layout is empty — describe the image before generating" };
    }
  } else {
    prompt = (image.plainPrompt ?? "").trim();
    negativePrompt = (image.negativePrompt ?? "").trim() || undefined;
    if (!prompt) {
      return { success: false, imageId, error: "Plain prompt is empty — describe the image before generating" };
    }
  }

  const workflowId = opts.workflowId ?? project.defaultWorkflowId ?? undefined;
  const workflow = await resolveWorkflow("comfyui", "t2i", workflowId);
  if (!workflow) {
    return { success: false, imageId, error: "No t2i workflow configured. Add one in Settings and mark it default." };
  }
  if (!workflow.workflowJson) {
    return { success: false, imageId, error: "Selected workflow has no JSON." };
  }

  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 32);

  // Mark as generating
  await db.update(schema.images)
    .set({ status: "generating", lastError: null, updatedAt: new Date().toISOString() })
    .where(eq(schema.images.id, imageId));

  const config = await getComfyConfig();
  const baseUrl = workflow.overrideBaseUrl || config.baseUrl || "http://localhost:8188";

  const result = await executeWorkflow(baseUrl, workflow.workflowJson, {
    prompt,
    negativePrompt,
    width: project.width,
    height: project.height,
    aspectRatio: project.aspectRatio,
    megapixels: project.megapixels,
    rawPrompt: isIdeogram,
    seed,
  }, workflow);

  if (!result.success || !result.filePath) {
    await db.update(schema.images)
      .set({ status: "failed", lastError: result.error ?? "Generation failed", updatedAt: new Date().toISOString() })
      .where(eq(schema.images.id, imageId));
    return { success: false, imageId, error: result.error ?? "Generation failed" };
  }

  // Track the generated asset
  const assetId = await trackImageAsset(project.id, {
    filePath: result.filePath,
    prompt,
    negativePrompt,
    seed,
    workflowId: workflow.id,
    width: project.width,
    height: project.height,
    executedWorkflow: result.executedWorkflow,
    generationParams: { aspectRatio: project.aspectRatio, megapixels: project.megapixels, promptFormat: project.promptFormat },
  });

  await db.update(schema.images)
    .set({
      status: "generated",
      assetId,
      filePath: result.filePath,
      seed,
      genWidth: project.width,
      genHeight: project.height,
      workflowId: workflow.id,
      executedWorkflowJson: result.executedWorkflow ? JSON.stringify(result.executedWorkflow) : null,
      lastError: null,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.images.id, imageId));

  return { success: true, imageId, assetId, filePath: result.filePath, seed };
}

/** Insert an asset row for a generated image and fire-and-forget the embedding. */
async function trackImageAsset(
  projectId: string,
  opts: {
    filePath: string;
    prompt?: string;
    negativePrompt?: string;
    seed?: number;
    workflowId?: string;
    width?: number;
    height?: number;
    executedWorkflow?: Record<string, unknown>;
    generationParams?: Record<string, unknown>;
  },
): Promise<string> {
  const assetId = newId();
  const now = new Date().toISOString();

  let fileSize: number | undefined;
  try {
    const fullPath = opts.filePath.startsWith("/") ? opts.filePath : resolve(getUploadsDir(), opts.filePath);
    if (existsSync(fullPath)) fileSize = statSync(fullPath).size;
  } catch { /* ignore */ }

  let workflowName: string | undefined;
  if (opts.workflowId) {
    const [wf] = await db.select({ name: schema.workflows.name }).from(schema.workflows)
      .where(eq(schema.workflows.id, opts.workflowId));
    if (wf) workflowName = wf.name;
  }

  await db.insert(schema.assets).values({
    id: assetId,
    projectId,
    type: "image",
    filePath: opts.filePath,
    fileName: opts.filePath,
    prompt: opts.prompt,
    negativePrompt: opts.negativePrompt,
    seed: opts.seed,
    workflowId: opts.workflowId,
    workflowName,
    generationTool: "generate_image",
    generationParams: opts.generationParams ? JSON.stringify(opts.generationParams) : undefined,
    executedWorkflowJson: opts.executedWorkflow ? JSON.stringify(opts.executedWorkflow) : undefined,
    width: opts.width,
    height: opts.height,
    fileSize,
    createdAt: now,
    updatedAt: now,
  });

  if (opts.prompt) {
    embedAsset(assetId, opts.prompt).catch(() => {});
  }

  return assetId;
}
