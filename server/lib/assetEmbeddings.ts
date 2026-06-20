import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import { newId } from "./nanoid";
import { fetchEmbeddings, cosineSimilarity } from "./embeddings";

/**
 * Generate and store an embedding for an asset's prompt text.
 * Fire-and-forget safe — logs errors instead of throwing.
 */
export async function embedAsset(assetId: string, text: string): Promise<void> {
  try {
    const [embedding] = await fetchEmbeddings([text]);
    await db.insert(schema.assetEmbeddings).values({
      id: newId(),
      assetId,
      text,
      embedding: JSON.stringify(embedding),
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(`[assets] Failed to embed asset ${assetId}:`, (err as Error).message);
  }
}

export interface AssetSearchResult {
  assetId: string;
  type: string;
  filePath: string;
  fileName: string;
  prompt: string | null;
  score: number;
  createdAt: string;
}

/**
 * Semantic search across asset prompts using cosine similarity.
 */
export async function searchAssetsSemantic(
  projectId: string,
  query: string,
  opts: { type?: string; topK?: number } = {},
): Promise<AssetSearchResult[]> {
  const topK = opts.topK ?? 10;

  const [queryEmbedding] = await fetchEmbeddings([query]);

  // Load all assets for the project
  const allAssets = await db.select().from(schema.assets)
    .where(eq(schema.assets.projectId, projectId));

  const projectAssets = opts.type ? allAssets.filter((a: { type: string }) => a.type === opts.type) : allAssets;

  const assetMap = new Map(projectAssets.map((a: typeof schema.assets.$inferSelect) => [a.id, a] as const));

  // Load embeddings for those assets
  const allEmbeddings: Array<typeof schema.assetEmbeddings.$inferSelect> = [];
  for (const asset of projectAssets) {
    const rows = await db.select().from(schema.assetEmbeddings)
      .where(eq(schema.assetEmbeddings.assetId, asset.id));
    allEmbeddings.push(...rows);
  }

  const scored = allEmbeddings.map((e) => {
    const vec = JSON.parse(e.embedding) as number[];
    return { entry: e, score: cosineSimilarity(queryEmbedding, vec) };
  });

  scored.sort((a, b) => b.score - a.score);
  const topResults = scored.slice(0, topK);

  return topResults
    .map(({ entry, score }) => {
      const asset = assetMap.get(entry.assetId);
      if (!asset) return null;
      return {
        assetId: asset.id,
        type: asset.type,
        filePath: asset.filePath,
        fileName: asset.fileName,
        prompt: asset.prompt,
        score,
        createdAt: asset.createdAt,
      };
    })
    .filter((r): r is AssetSearchResult => r !== null);
}
