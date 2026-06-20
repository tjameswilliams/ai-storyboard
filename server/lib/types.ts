export interface EntitySnapshot {
  table: "images";
  id: string;
  row: Record<string, unknown> | null;
}

export type ToolResult = { success: boolean; result: unknown };

export type ToolHandler = (
  args: Record<string, unknown>,
  projectId: string,
  undoContext?: { groupId: string; seq: number }
) => Promise<ToolResult>;
