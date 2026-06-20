import type { ToolHandler } from "../types";
import { runImageGeneration } from "../imageGeneration";

export const generationTools: Record<string, ToolHandler> = {
  generate_image: async (args) => {
    const imageId = args.image_id as string;
    if (!imageId) return { success: false, result: "image_id is required" };
    const outcome = await runImageGeneration(imageId, {
      seed: typeof args.seed === "number" ? (args.seed as number) : undefined,
      workflowId: typeof args.workflow_id === "string" ? (args.workflow_id as string) : undefined,
    });
    if (!outcome.success) return { success: false, result: outcome.error };
    return { success: true, result: { imageId, assetId: outcome.assetId, filePath: outcome.filePath, seed: outcome.seed } };
  },

  regenerate_image: async (args) => {
    const imageId = args.image_id as string;
    if (!imageId) return { success: false, result: "image_id is required" };
    // Fresh random seed unless one is explicitly provided.
    const outcome = await runImageGeneration(imageId, {
      seed: typeof args.seed === "number" ? (args.seed as number) : undefined,
      workflowId: typeof args.workflow_id === "string" ? (args.workflow_id as string) : undefined,
    });
    if (!outcome.success) return { success: false, result: outcome.error };
    return { success: true, result: { imageId, assetId: outcome.assetId, filePath: outcome.filePath, seed: outcome.seed } };
  },
};
