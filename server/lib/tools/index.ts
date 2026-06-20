import type { ToolHandler } from "../types";
import { queryTools } from "./query";
import { imageOpsTools } from "./imageOps";
import { generationTools } from "./generation";
import { planningTools } from "./planning";
import { assetTools } from "./assets";
import { webTools } from "./web";

const toolRegistry: Record<string, ToolHandler> = {
  ...queryTools,
  ...imageOpsTools,
  ...generationTools,
  ...planningTools,
  ...assetTools,
  ...webTools,
};

export function getRegisteredToolNames(): string[] {
  return Object.keys(toolRegistry);
}

export async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  projectId: string,
  undoContext?: { groupId: string; seq: number }
): Promise<{ success: boolean; result: unknown }> {
  try {
    const handler = toolRegistry[name];
    if (!handler) {
      return { success: false, result: `Unknown tool: ${name}` };
    }
    return await handler(args, projectId, undoContext);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, result: message };
  }
}
