import type { ImageGeneratorPlugin, ImageGenerationParams, GenerationResult, ConfigSchema } from "./types";
import { getComfyConfig, resolveWorkflow, executeWorkflow } from "../comfyuiClient";

export class ComfyUIImagePlugin implements ImageGeneratorPlugin {
  manifest = {
    id: "comfyui-image",
    name: "ComfyUI Image Generator",
    version: "1.0.0",
    type: "image-generator" as const,
    description: "Generate images using ComfyUI workflows (T2I and I2I)",
  };

  private config: Record<string, unknown> = {};

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = config;
  }

  getConfigSchema(): ConfigSchema {
    return {
      properties: {
        comfyui_url: { type: "string", description: "ComfyUI server URL", default: "http://localhost:8188" },
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    const config = await getComfyConfig();
    const url = config.baseUrl || "http://localhost:8188";
    try {
      const res = await fetch(`${url}/system_stats`, { signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch { return false; }
  }

  async generateImage(params: ImageGenerationParams): Promise<GenerationResult> {
    const config = await getComfyConfig();
    const defaultBaseUrl = config.baseUrl || "http://localhost:8188";

    const hasSource = !!params.inputImage;
    const workflowType = hasSource ? "i2i" : "t2i";
    const workflow = await resolveWorkflow("comfyui", workflowType, params.workflowId);

    if (!workflow) {
      return { success: false, error: `No ${workflowType} workflow configured. Upload a workflow in Settings.` };
    }
    if (!workflow.workflowJson) {
      return { success: false, error: "Workflow has no JSON" };
    }

    const baseUrl = workflow.overrideBaseUrl || defaultBaseUrl;
    const result = await executeWorkflow(baseUrl, workflow.workflowJson, {
      prompt: params.prompt,
      negativePrompt: params.negativePrompt,
      width: params.width,
      height: params.height,
      sourceImagePath: params.inputImage,
      seed: params.seed,
      cfg: params.cfg,
    }, workflow);

    const metadata = result.executedWorkflow
      ? { executedWorkflow: result.executedWorkflow }
      : undefined;

    if (result.success) {
      return { success: true, filePath: result.filePath, metadata };
    }
    return { success: false, error: result.error, metadata };
  }
}
