import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";

export interface AttachedStyleguideForPrompt {
  id: string;
  name: string;
  description: string | null;
  markdown: string;
  assets: Array<{
    id: string;
    role: string;
    label: string | null;
    url: string;
    fileName: string;
    mimeType: string | null;
  }>;
}

/**
 * Load all styleguides attached to a project, with their markdown, brand assets,
 * and named animations, in the shape consumed by `getSystemPrompt` and
 * `list_infographic_components`. Returns [] when no styleguides are attached,
 * so the system prompt stays byte-identical to today's output.
 */
export async function loadAttachedStyleguides(projectId: string): Promise<AttachedStyleguideForPrompt[]> {
  const attached = await db.select({
    id: schema.styleguides.id,
    name: schema.styleguides.name,
    description: schema.styleguides.description,
    markdown: schema.styleguides.markdown,
  })
    .from(schema.projectStyleguides)
    .innerJoin(schema.styleguides, eq(schema.styleguides.id, schema.projectStyleguides.styleguideId))
    .where(eq(schema.projectStyleguides.projectId, projectId));

  if (attached.length === 0) return [];

  const result: AttachedStyleguideForPrompt[] = [];
  for (const sg of attached) {
    const assets = await db.select().from(schema.styleguideAssets)
      .where(eq(schema.styleguideAssets.styleguideId, sg.id));
    result.push({
      id: sg.id,
      name: sg.name,
      description: sg.description,
      markdown: sg.markdown,
      assets: assets.map((a: typeof schema.styleguideAssets.$inferSelect) => ({
        id: a.id,
        role: a.role,
        label: a.label,
        url: `/api/uploads/${a.filePath}`,
        fileName: a.fileName,
        mimeType: a.mimeType,
      })),
    });
  }
  return result;
}
