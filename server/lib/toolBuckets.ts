import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";

export interface ToolBucket {
  id: string;
  label: string;
  description: string;
  alwaysOn: boolean;
  toolNames: readonly string[];
}

export const TOOL_BUCKETS: readonly ToolBucket[] = [
  {
    id: "core_inspection",
    label: "Core Inspection & Planning",
    description: "Project/image introspection and multi-step plan management. Required for the agent to orient itself.",
    alwaysOn: true,
    toolNames: [
      "get_project_status",
      "list_images",
      "describe_image",
      "update_plan",
    ],
  },
  {
    id: "asset_library",
    label: "Asset Library",
    description: "List, search, inspect, and tag generated images. Required for the agent to reference past renders.",
    alwaysOn: true,
    toolNames: [
      "list_assets",
      "search_assets",
      "search_assets_semantic",
      "get_asset_info",
      "tag_asset",
    ],
  },
  {
    id: "layout_editing",
    label: "Layout Editing",
    description: "Create/reorder/delete storyboard frames and edit each frame's Ideogram layout (descriptions, palette, regions). This is the core of the app.",
    alwaysOn: true,
    toolNames: [
      "create_image", "delete_image", "reorder_image",
      "update_image_layout", "patch_image_layout",
      "set_high_level_description", "set_style_description", "set_color_palette",
      "add_region", "update_region", "delete_region",
      "set_plain_prompt",
    ],
  },
  {
    id: "generation",
    label: "Image Generation",
    description: "Render a frame's layout through ComfyUI, and regenerate with a fresh seed.",
    alwaysOn: false,
    toolNames: ["generate_image", "regenerate_image"],
  },
  {
    id: "web",
    label: "Web",
    description: "Web search, fetch a page, and download images into the asset library.",
    alwaysOn: false,
    toolNames: ["web_search", "fetch_webpage", "download_image"],
  },
] as const;

export const ALWAYS_ON_BUCKET_IDS: ReadonlySet<string> = new Set(
  TOOL_BUCKETS.filter((b) => b.alwaysOn).map((b) => b.id),
);

let cachedToolToBucket: Map<string, string> | null = null;
function getToolNameToBucketId(): Map<string, string> {
  if (cachedToolToBucket) return cachedToolToBucket;
  const map = new Map<string, string>();
  for (const bucket of TOOL_BUCKETS) {
    for (const name of bucket.toolNames) map.set(name, bucket.id);
  }
  cachedToolToBucket = map;
  return map;
}

export function parseDisabledToolBuckets(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
  } catch {
    return [];
  }
}

export async function getDisabledToolBuckets(projectId: string): Promise<Set<string>> {
  const [row] = await db.select({ disabled: schema.projects.disabledToolBuckets })
    .from(schema.projects).where(eq(schema.projects.id, projectId));
  if (!row) return new Set();
  return new Set(parseDisabledToolBuckets(row.disabled).filter((id) => !ALWAYS_ON_BUCKET_IDS.has(id)));
}

export async function setDisabledToolBuckets(projectId: string, bucketIds: string[]): Promise<string[]> {
  const validIds = new Set(TOOL_BUCKETS.map((b) => b.id));
  const sanitized = Array.from(new Set(
    bucketIds.filter((id) => typeof id === "string" && validIds.has(id) && !ALWAYS_ON_BUCKET_IDS.has(id)),
  )).sort();
  await db.update(schema.projects)
    .set({ disabledToolBuckets: JSON.stringify(sanitized), updatedAt: new Date().toISOString() })
    .where(eq(schema.projects.id, projectId));
  return sanitized;
}

type ToolDef = { type: "function"; function: { name: string; description?: string; parameters?: unknown } };

export function filterToolsByBuckets<T extends ToolDef>(tools: T[], disabledBucketIds: Set<string>): T[] {
  if (disabledBucketIds.size === 0) return tools;
  const nameToBucket = getToolNameToBucketId();
  return tools.filter((tool) => {
    const bucketId = nameToBucket.get(tool.function.name);
    if (!bucketId) return true;
    return !disabledBucketIds.has(bucketId);
  });
}
