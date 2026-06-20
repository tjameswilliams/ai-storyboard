import type { ImageGeneratorPlugin, ImageGenerationParams, GenerationResult, ConfigSchema } from "./types";
import { mcpClientManager } from "../mcp/clientManager";
import { newId } from "../nanoid";
import { getUploadsDir } from "../config";
import { copyFileSync, existsSync } from "fs";
import { resolve } from "path";

export class NanoBananaPlugin implements ImageGeneratorPlugin {
  manifest = {
    id: "nano-banana",
    name: "Nano Banana Image Generator",
    version: "1.0.0",
    type: "image-generator" as const,
    description: "Generate and edit images using Nano Banana via MCP (supports text-to-image and image compositing)",
  };

  private config: Record<string, unknown> = {};

  async initialize(config: Record<string, unknown>): Promise<void> {
    this.config = config;
  }

  getConfigSchema(): ConfigSchema {
    return {
      properties: {},
    };
  }

  async healthCheck(): Promise<boolean> {
    // Check if the nano-banana MCP server is connected
    try {
      const tools = mcpClientManager.getAllToolDefinitions();
      return tools.some((t) => t.function.name === "mcp__nano-banana__generate_image");
    } catch {
      return false;
    }
  }

  async generateImage(params: ImageGenerationParams): Promise<GenerationResult> {
    const outputDir = resolve(getUploadsDir());
    const filename = `nb_${newId()}.png`;

    const mcpArgs: Record<string, unknown> = {
      prompt: params.prompt,
      output_dir: outputDir,
      filename,
    };

    // Support input images for i2i / compositing
    if (params.inputImage) {
      mcpArgs.input_images = [params.inputImage];
    }

    const result = await mcpClientManager.callTool("mcp__nano-banana__generate_image", mcpArgs);

    if (!result.success) {
      return { success: false, error: `Nano Banana generation failed: ${typeof result.result === "string" ? result.result : JSON.stringify(result.result)}` };
    }

    // The MCP tool saves the file to output_dir/filename
    // Check if the file exists there
    const expectedPath = resolve(outputDir, filename);
    if (existsSync(expectedPath)) {
      return { success: true, filePath: filename };
    }

    // If the tool saved to a different path, try to parse it from the response
    const responseText = typeof result.result === "string" ? result.result : JSON.stringify(result.result);
    const pathMatch = responseText.match(/(?:saved|path|file)[:\s]*([^\s\n"]+\.(?:png|jpg|jpeg|webp))/i);
    if (pathMatch) {
      const sourcePath = pathMatch[1];
      if (existsSync(sourcePath)) {
        const ext = sourcePath.split(".").pop() || "png";
        const destFilename = `nb_${newId()}.${ext}`;
        copyFileSync(sourcePath, resolve(outputDir, destFilename));
        return { success: true, filePath: destFilename };
      }
    }

    return { success: false, error: `Nano Banana completed but output file not found. Response: ${responseText.slice(0, 200)}` };
  }
}
