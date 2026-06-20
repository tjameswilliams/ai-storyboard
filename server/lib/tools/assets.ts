import type { ToolHandler } from "../types";
import { db, schema } from "../../db/client";
import { eq, and, like, desc } from "drizzle-orm";
import { searchAssetsSemantic } from "../assetEmbeddings";

export const assetTools: Record<string, ToolHandler> = {
  list_assets: async (args, projectId) => {
    const type = args.type as string | undefined;
    const limit = Math.min((args.limit as number) || 20, 100);
    const offset = (args.offset as number) || 0;
    const favoriteOnly = args.favorite_only as boolean | undefined;

    let query = db.select().from(schema.assets)
      .where(eq(schema.assets.projectId, projectId))
      .orderBy(desc(schema.assets.createdAt))
      .limit(limit)
      .offset(offset);

    const rows = await query;

    let filtered = rows as Array<typeof schema.assets.$inferSelect>;
    if (type) filtered = filtered.filter((a: { type: string }) => a.type === type);
    if (favoriteOnly) filtered = filtered.filter((a: { favorite: number | null }) => a.favorite === 1);

    return {
      success: true,
      result: {
        assets: filtered.map(summarizeAsset),
        total: filtered.length,
        offset,
      },
    };
  },

  search_assets: async (args, projectId) => {
    const query = (args.query as string).toLowerCase();
    const type = args.type as string | undefined;

    const rows = await db.select().from(schema.assets)
      .where(eq(schema.assets.projectId, projectId))
      .orderBy(desc(schema.assets.createdAt));

    const matches = rows.filter((a: typeof schema.assets.$inferSelect) => {
      if (type && a.type !== type) return false;
      const searchable = [a.prompt, a.fileName, a.tags, a.workflowName, a.negativePrompt, a.description]
        .filter(Boolean).join(" ").toLowerCase();
      return searchable.includes(query);
    });

    return {
      success: true,
      result: {
        assets: matches.slice(0, 20).map(summarizeAsset),
        total: matches.length,
      },
    };
  },

  search_assets_semantic: async (args, projectId) => {
    const query = args.query as string;
    const type = args.type as string | undefined;
    const topK = (args.top_k as number) || 10;

    const results = await searchAssetsSemantic(projectId, query, { type, topK });

    return {
      success: true,
      result: {
        assets: results.map((r) => ({
          assetId: r.assetId,
          type: r.type,
          filePath: r.filePath,
          fileName: r.fileName,
          prompt: r.prompt,
          score: Math.round(r.score * 1000) / 1000,
          createdAt: r.createdAt,
        })),
      },
    };
  },

  get_asset_info: async (args, projectId) => {
    const assetId = args.asset_id as string;
    const [asset] = await db.select().from(schema.assets)
      .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));

    if (!asset) return { success: false, result: "Asset not found" };

    return {
      success: true,
      result: {
        id: asset.id,
        type: asset.type,
        filePath: asset.filePath,
        fileName: asset.fileName,
        description: asset.description ?? "",
        prompt: asset.prompt,
        negativePrompt: asset.negativePrompt,
        seed: asset.seed,
        workflowId: asset.workflowId,
        workflowName: asset.workflowName,
        generationTool: asset.generationTool,
        generationParams: asset.generationParams ? JSON.parse(asset.generationParams) : null,
        sourceAssetIds: asset.sourceAssetIds ? JSON.parse(asset.sourceAssetIds) : [],
        sourceClipId: asset.sourceClipId,
        duration: asset.duration,
        width: asset.width,
        height: asset.height,
        fileSize: asset.fileSize,
        tags: JSON.parse(asset.tags || "[]"),
        favorite: asset.favorite === 1,
        onTimeline: asset.onTimeline === 1,
        createdAt: asset.createdAt,
      },
    };
  },

  tag_asset: async (args, projectId) => {
    const assetId = args.asset_id as string;
    const tags = args.tags as string[];

    const [asset] = await db.select().from(schema.assets)
      .where(and(eq(schema.assets.id, assetId), eq(schema.assets.projectId, projectId)));

    if (!asset) return { success: false, result: "Asset not found" };

    await db.update(schema.assets).set({
      tags: JSON.stringify(tags),
      updatedAt: new Date().toISOString(),
    }).where(eq(schema.assets.id, assetId));

    return { success: true, result: { assetId, tags } };
  },
};

function summarizeAsset(a: typeof schema.assets.$inferSelect) {
  return {
    id: a.id,
    type: a.type,
    filePath: a.filePath,
    fileName: a.fileName,
    description: a.description || null,
    prompt: a.prompt ? (a.prompt.length > 100 ? a.prompt.slice(0, 100) + "..." : a.prompt) : null,
    workflowName: a.workflowName,
    generationTool: a.generationTool,
    seed: a.seed,
    favorite: a.favorite === 1,
    onTimeline: a.onTimeline === 1,
    createdAt: a.createdAt,
  };
}
