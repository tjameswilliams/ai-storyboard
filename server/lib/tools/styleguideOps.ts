import { db, schema } from "../../db/client";
import { and, eq } from "drizzle-orm";

export type StyleguideToolResult = { success: boolean; result: unknown };

export type StyleguideToolHandler = (
  args: Record<string, unknown>,
  styleguideId: string,
) => Promise<StyleguideToolResult>;

async function bumpStyleguideUpdated(styleguideId: string) {
  await db.update(schema.styleguides)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.styleguides.id, styleguideId));
}

export const styleguideTools: Record<string, StyleguideToolHandler> = {
  update_styleguide_markdown: async (args, styleguideId) => {
    const content = args.content as string | undefined;
    if (typeof content !== "string") {
      return { success: false, result: { error: "content is required (string)" } };
    }
    await db.update(schema.styleguides)
      .set({ markdown: content, updatedAt: new Date().toISOString() })
      .where(eq(schema.styleguides.id, styleguideId));
    return { success: true, result: { length: content.length } };
  },

  patch_styleguide_markdown: async (args, styleguideId) => {
    const search = args.search as string | undefined;
    const replace = args.replace as string | undefined;
    if (typeof search !== "string" || typeof replace !== "string") {
      return { success: false, result: { error: "search and replace are required (strings)" } };
    }
    const [sg] = await db.select().from(schema.styleguides).where(eq(schema.styleguides.id, styleguideId));
    if (!sg) return { success: false, result: { error: "Styleguide not found" } };
    if (!sg.markdown.includes(search)) {
      return { success: false, result: { error: "search string not found in markdown" } };
    }
    const occurrences = sg.markdown.split(search).length - 1;
    if (occurrences > 1) {
      return { success: false, result: { error: `search string matches ${occurrences} locations; make it more specific` } };
    }
    const next = sg.markdown.replace(search, replace);
    await db.update(schema.styleguides)
      .set({ markdown: next, updatedAt: new Date().toISOString() })
      .where(eq(schema.styleguides.id, styleguideId));
    return { success: true, result: { replaced: 1, newLength: next.length } };
  },

  tag_brand_asset: async (args, styleguideId) => {
    const assetId = args.assetId as string | undefined;
    const role = args.role as string | undefined;
    const label = args.label as string | undefined;
    if (!assetId || !role) {
      return { success: false, result: { error: "assetId and role are required" } };
    }
    const [row] = await db.select().from(schema.styleguideAssets).where(and(
      eq(schema.styleguideAssets.id, assetId),
      eq(schema.styleguideAssets.styleguideId, styleguideId),
    ));
    if (!row) return { success: false, result: { error: "Brand asset not found in this styleguide" } };

    const updates: Record<string, unknown> = { role };
    if (label !== undefined) updates.label = label;
    await db.update(schema.styleguideAssets).set(updates).where(eq(schema.styleguideAssets.id, assetId));
    await bumpStyleguideUpdated(styleguideId);
    return { success: true, result: { assetId, role, label: label ?? row.label } };
  },

  list_styleguide_assets: async (_args, styleguideId) => {
    const rows = await db.select().from(schema.styleguideAssets)
      .where(eq(schema.styleguideAssets.styleguideId, styleguideId));
    return {
      success: true,
      result: {
        assets: rows.map((a: typeof schema.styleguideAssets.$inferSelect) => ({
          id: a.id,
          fileName: a.fileName,
          role: a.role,
          label: a.label,
          url: `/api/uploads/${a.filePath}`,
          mimeType: a.mimeType,
        })),
      },
    };
  },

};

export function getStyleguideToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "update_styleguide_markdown",
        description: "Replace the styleguide's full brand-doc markdown with new content. Use when doing a major rewrite. For small edits, prefer patch_styleguide_markdown.",
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: "The full new markdown content for the brand doc." },
          },
          required: ["content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "patch_styleguide_markdown",
        description: "Find a unique string in the current markdown and replace it. Fails if the search string is missing or appears more than once (make it more specific in that case).",
        parameters: {
          type: "object",
          properties: {
            search: { type: "string", description: "Exact substring to find. Must match exactly once." },
            replace: { type: "string", description: "Replacement text." },
          },
          required: ["search", "replace"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "tag_brand_asset",
        description: "Update the role and/or label of an already-uploaded brand asset. The user uploads files via the UI; this tool just categorizes them.",
        parameters: {
          type: "object",
          properties: {
            assetId: { type: "string", description: "The styleguide asset id (not the upload file path)." },
            role: {
              type: "string",
              description: "One of: primary-logo, secondary-logo, wordmark, icon, accent-image, color-swatch, reference.",
            },
            label: { type: "string", description: "Optional human-readable label (e.g. 'dark-bg variant')." },
          },
          required: ["assetId", "role"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_styleguide_assets",
        description: "List all brand assets attached to this styleguide.",
        parameters: { type: "object", properties: {} },
      },
    },
  ];
}

export async function executeStyleguideToolCall(
  name: string,
  args: Record<string, unknown>,
  styleguideId: string,
): Promise<StyleguideToolResult> {
  const handler = styleguideTools[name];
  if (!handler) return { success: false, result: { error: `Unknown tool: ${name}` } };
  try {
    return await handler(args, styleguideId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, result: { error: message } };
  }
}
