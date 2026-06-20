import { db, schema } from "../db/client";

interface EmbeddingConfig {
  apiBaseUrl: string;
  apiKey: string;
  model: string;
}

async function getEmbeddingConfig(): Promise<EmbeddingConfig> {
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return {
    apiBaseUrl: map.embeddingApiBaseUrl || map.apiBaseUrl || "http://localhost:11434/v1",
    apiKey: map.embeddingApiKey || map.apiKey || "ollama",
    model: map.embeddingModel || "text-embedding-3-small",
  };
}

export async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
  const config = await getEmbeddingConfig();

  const res = await fetch(`${config.apiBaseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      input: texts,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Embedding API error ${res.status}: ${errorText}`);
  }

  const data = await res.json();
  const sorted = (data.data as Array<{ embedding: number[]; index: number }>)
    .sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
