import type { ToolHandler } from "../types";
import { db, schema } from "../../db/client";
import { eq, asc } from "drizzle-orm";
import { parseLayout } from "../layout";

export const queryTools: Record<string, ToolHandler> = {
  get_project_status: async (_args, projectId) => {
    const [project] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
    if (!project) return { success: false, result: "Project not found" };

    const images = await db.select().from(schema.images)
      .where(eq(schema.images.projectId, projectId))
      .orderBy(asc(schema.images.order));

    const statusCounts: Record<string, number> = {};
    for (const img of images) statusCounts[img.status] = (statusCounts[img.status] ?? 0) + 1;

    return {
      success: true,
      result: {
        project: {
          id: project.id,
          name: project.name,
          aspectRatio: project.aspectRatio,
          megapixels: project.megapixels,
          width: project.width,
          height: project.height,
          promptFormat: project.promptFormat,
          defaultWorkflowId: project.defaultWorkflowId,
        },
        imageCount: images.length,
        statusCounts,
        images: images.map(summarizeImage),
      },
    };
  },

  list_images: async (_args, projectId) => {
    const images = await db.select().from(schema.images)
      .where(eq(schema.images.projectId, projectId))
      .orderBy(asc(schema.images.order));
    return { success: true, result: { images: images.map(summarizeImage) } };
  },

  describe_image: async (args, projectId) => {
    const imageId = args.image_id as string;
    const [img] = await db.select().from(schema.images).where(eq(schema.images.id, imageId));
    if (!img || img.projectId !== projectId) return { success: false, result: "Image not found in this project" };
    return {
      success: true,
      result: {
        id: img.id,
        name: img.name,
        order: img.order,
        status: img.status,
        seed: img.seed,
        assetId: img.assetId,
        filePath: img.filePath,
        lastError: img.lastError,
        layout: parseLayout(img.layout),
        plainPrompt: img.plainPrompt,
        negativePrompt: img.negativePrompt,
      },
    };
  },
};

function summarizeImage(img: typeof schema.images.$inferSelect) {
  let highLevel = "";
  let regionCount = 0;
  try {
    const layout = parseLayout(img.layout);
    highLevel = layout.high_level_description;
    regionCount = layout.compositional_deconstruction.length;
  } catch { /* ignore malformed */ }
  return {
    id: img.id,
    order: img.order,
    name: img.name,
    status: img.status,
    highLevelDescription: highLevel,
    regionCount,
    hasImage: !!img.assetId,
  };
}
