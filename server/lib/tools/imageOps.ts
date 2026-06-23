import type { ToolHandler } from "../types";
import { db, schema } from "../../db/client";
import { eq, asc, sql } from "drizzle-orm";
import { newId } from "../nanoid";
import { recordAction } from "../undoManager";
import { parseLayout, stringifyLayout, validateLayout, emptyLayout, clampBox, type Layout, type Region } from "../layout";

type ImageRow = typeof schema.images.$inferSelect;

const numOr = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) ? v : d);

async function getImage(imageId: string, projectId: string): Promise<ImageRow | null> {
  const [img] = await db.select().from(schema.images).where(eq(schema.images.id, imageId));
  if (!img || img.projectId !== projectId) return null;
  return img;
}

/** Apply a layout mutation to an image, persisting + recording undo. */
async function mutateLayout(
  imageId: string,
  projectId: string,
  undoContext: { groupId: string; seq: number } | undefined,
  toolName: string,
  mutate: (layout: Layout) => Layout | void,
): Promise<{ success: boolean; result: unknown }> {
  const before = await getImage(imageId, projectId);
  if (!before) return { success: false, result: "Image not found in this project" };

  const layout = parseLayout(before.layout);
  const next = mutate(layout) ?? layout;
  const v = validateLayout(next);
  if (!v.ok) return { success: false, result: v.error };

  const now = new Date().toISOString();
  await db.update(schema.images)
    .set({ layout: stringifyLayout(v.layout), updatedAt: now })
    .where(eq(schema.images.id, imageId));
  const after = await getImage(imageId, projectId);

  if (undoContext) {
    await recordAction({
      projectId,
      groupId: undoContext.groupId,
      groupLabel: toolName,
      seq: undoContext.seq,
      toolName,
      source: "agent",
      beforeState: [{ table: "images", id: imageId, row: before }],
      afterState: [{ table: "images", id: imageId, row: after }],
    });
  }
  return { success: true, result: { imageId, layout: v.layout } };
}

export const imageOpsTools: Record<string, ToolHandler> = {
  create_image: async (args, projectId, undoContext) => {
    const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(schema.images)
      .where(eq(schema.images.projectId, projectId));
    let order = Number(count);

    const afterImageId = args.after_image_id as string | undefined;
    if (afterImageId) {
      const after = await getImage(afterImageId, projectId);
      if (after) {
        order = after.order + 1;
        await db.update(schema.images)
          .set({ order: sql`${schema.images.order} + 1` })
          .where(sql`${schema.images.projectId} = ${projectId} AND ${schema.images.order} >= ${order}`);
      }
    }

    let layout = emptyLayout();
    if (args.layout !== undefined) {
      const v = validateLayout(args.layout);
      if (!v.ok) return { success: false, result: v.error };
      layout = v.layout;
    }

    const id = newId();
    const now = new Date().toISOString();
    await db.insert(schema.images).values({
      id,
      projectId,
      name: (args.name as string) ?? "",
      order,
      layout: stringifyLayout(layout),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
    const after = await getImage(id, projectId);
    if (undoContext) {
      await recordAction({
        projectId, groupId: undoContext.groupId, groupLabel: "create_image", seq: undoContext.seq,
        toolName: "create_image", source: "agent",
        beforeState: [{ table: "images", id, row: null }],
        afterState: [{ table: "images", id, row: after }],
      });
    }
    return { success: true, result: { imageId: id, order } };
  },

  delete_image: async (args, projectId, undoContext) => {
    const imageId = args.image_id as string;
    const before = await getImage(imageId, projectId);
    if (!before) return { success: false, result: "Image not found in this project" };

    await db.delete(schema.images).where(eq(schema.images.id, imageId));
    if (undoContext) {
      await recordAction({
        projectId, groupId: undoContext.groupId, groupLabel: "delete_image", seq: undoContext.seq,
        toolName: "delete_image", source: "agent",
        beforeState: [{ table: "images", id: imageId, row: before }],
        afterState: [{ table: "images", id: imageId, row: null }],
      });
    }
    // Re-pack order.
    const rest = await db.select().from(schema.images)
      .where(eq(schema.images.projectId, projectId))
      .orderBy(asc(schema.images.order));
    for (let i = 0; i < rest.length; i++) {
      if (rest[i].order !== i) await db.update(schema.images).set({ order: i }).where(eq(schema.images.id, rest[i].id));
    }
    return { success: true, result: { deleted: imageId } };
  },

  reorder_image: async (args, projectId) => {
    const imageId = args.image_id as string;
    const newIndex = args.new_index as number;
    const all = await db.select().from(schema.images)
      .where(eq(schema.images.projectId, projectId))
      .orderBy(asc(schema.images.order));
    const idx = all.findIndex((i) => i.id === imageId);
    if (idx === -1) return { success: false, result: "Image not found in this project" };
    const [moved] = all.splice(idx, 1);
    const target = Math.max(0, Math.min(all.length, newIndex));
    all.splice(target, 0, moved);
    const now = new Date().toISOString();
    for (let i = 0; i < all.length; i++) {
      await db.update(schema.images).set({ order: i, updatedAt: now }).where(eq(schema.images.id, all[i].id));
    }
    return { success: true, result: { imageId, newIndex: target } };
  },

  update_image_layout: (args, projectId, undoContext) =>
    mutateLayout(args.image_id as string, projectId, undoContext, "update_image_layout", () => {
      const v = validateLayout(args.layout);
      if (!v.ok) throw new Error(v.error);
      return v.layout;
    }),

  patch_image_layout: (args, projectId, undoContext) =>
    mutateLayout(args.image_id as string, projectId, undoContext, "patch_image_layout", (layout) => {
      const patch = (args.patch ?? {}) as Partial<Layout>;
      return { ...layout, ...patch } as Layout;
    }),

  set_high_level_description: (args, projectId, undoContext) =>
    mutateLayout(args.image_id as string, projectId, undoContext, "set_high_level_description", (layout) => {
      layout.high_level_description = String(args.text ?? "");
    }),

  set_style_description: (args, projectId, undoContext) =>
    mutateLayout(args.image_id as string, projectId, undoContext, "set_style_description", (layout) => {
      layout.style_description = String(args.text ?? "");
    }),

  set_color_palette: (args, projectId, undoContext) =>
    mutateLayout(args.image_id as string, projectId, undoContext, "set_color_palette", (layout) => {
      layout.color_palette = Array.isArray(args.palette) ? (args.palette as string[]) : [];
    }),

  add_region: async (args, projectId, undoContext) => {
    const regionId = newId();
    const res = await mutateLayout(args.image_id as string, projectId, undoContext, "add_region", (layout) => {
      // Accept named edges (preferred) and assemble Ideogram's y-first array.
      // Falls back to a raw bounding_box array if one is passed.
      const box = Array.isArray(args.bounding_box)
        ? clampBox(args.bounding_box as [number, number, number, number])
        : clampBox([numOr(args.y_min, 0), numOr(args.x_min, 0), numOr(args.y_max, 1000), numOr(args.x_max, 1000)]);
      const region: Region = {
        id: regionId,
        bounding_box: box,
        description: String(args.description ?? ""),
      };
      if (Array.isArray(args.color_palette)) region.color_palette = args.color_palette as string[];
      if (typeof args.text === "string") region.text = args.text;
      layout.compositional_deconstruction.push(region);
    });
    if (res.success) (res.result as Record<string, unknown>).regionId = regionId;
    return res;
  },

  update_region: (args, projectId, undoContext) =>
    mutateLayout(args.image_id as string, projectId, undoContext, "update_region", (layout) => {
      const region = layout.compositional_deconstruction.find((r) => r.id === args.region_id);
      if (!region) throw new Error(`Region ${args.region_id} not found`);
      const [cy0, cx0, cy1, cx1] = region.bounding_box;
      if (Array.isArray(args.bounding_box)) {
        region.bounding_box = clampBox(args.bounding_box as [number, number, number, number]);
      } else if (args.x_min !== undefined || args.y_min !== undefined || args.x_max !== undefined || args.y_max !== undefined) {
        // Partial move/resize via named edges; omitted edges keep current value.
        region.bounding_box = clampBox([numOr(args.y_min, cy0), numOr(args.x_min, cx0), numOr(args.y_max, cy1), numOr(args.x_max, cx1)]);
      }
      if (args.description !== undefined) region.description = String(args.description);
      if (args.color_palette !== undefined) region.color_palette = args.color_palette as string[];
      if (args.text !== undefined) region.text = String(args.text);
    }),

  delete_region: (args, projectId, undoContext) =>
    mutateLayout(args.image_id as string, projectId, undoContext, "delete_region", (layout) => {
      const idx = layout.compositional_deconstruction.findIndex((r) => r.id === args.region_id);
      if (idx === -1) throw new Error(`Region ${args.region_id} not found`);
      layout.compositional_deconstruction.splice(idx, 1);
    }),

  set_plain_prompt: async (args, projectId, undoContext) => {
    const imageId = args.image_id as string;
    const before = await getImage(imageId, projectId);
    if (!before) return { success: false, result: "Image not found in this project" };
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { plainPrompt: String(args.prompt ?? ""), updatedAt: now };
    if (args.negative_prompt !== undefined) updates.negativePrompt = String(args.negative_prompt);
    await db.update(schema.images).set(updates).where(eq(schema.images.id, imageId));
    const after = await getImage(imageId, projectId);
    if (undoContext) {
      await recordAction({
        projectId, groupId: undoContext.groupId, groupLabel: "set_plain_prompt", seq: undoContext.seq,
        toolName: "set_plain_prompt", source: "agent",
        beforeState: [{ table: "images", id: imageId, row: before }],
        afterState: [{ table: "images", id: imageId, row: after }],
      });
    }
    return { success: true, result: { imageId } };
  },
};
