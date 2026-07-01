import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import type { ConversationRef } from "./conversationKey";

/**
 * Server-owned persistence of chat messages. Previously the client wrote
 * messages after a stream finished; for background runs that survive the client
 * switching away, the server must own this. Each conversation scope maps to its
 * own table, but all three share an identical column shape, so we switch on
 * scope and write to the right one.
 */

export type MessageStatus = "streaming" | "complete";

export interface StoredMessage {
  id: string;
  role: string;
  content: string;
  thinking?: string | null;
  toolCalls?: unknown;   // serialized to JSON if not already a string
  segments?: unknown;
  status?: MessageStatus;
  createdAt?: string;
}

function tableFor(scope: ConversationRef["scope"]) {
  switch (scope) {
    case "project": return schema.chatMessages;
    case "image": return schema.imageChatMessages;
    case "styleguide": return schema.styleguideChatMessages;
  }
}

/** The scope-specific foreign-key column name. */
function fkColumn(scope: ConversationRef["scope"]): "projectId" | "imageId" | "styleguideId" {
  switch (scope) {
    case "project": return "projectId";
    case "image": return "imageId";
    case "styleguide": return "styleguideId";
  }
}

function toJsonOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}

/**
 * Insert-or-update a message by id into the conversation's table. Upsert (not
 * plain insert) so a "streaming" assistant placeholder can later be finalized
 * to "complete" under the same id.
 */
export async function upsertMessage(ref: ConversationRef, msg: StoredMessage): Promise<void> {
  const table = tableFor(ref.scope) as any;
  const fk = fkColumn(ref.scope);
  const row: Record<string, unknown> = {
    id: msg.id,
    [fk]: ref.id,
    role: msg.role,
    content: msg.content || "",
    thinking: msg.thinking ?? null,
    toolCalls: toJsonOrNull(msg.toolCalls),
    segments: toJsonOrNull(msg.segments),
    status: msg.status ?? "complete",
    createdAt: msg.createdAt || new Date().toISOString(),
  };
  await db.insert(table).values(row).onConflictDoUpdate({
    target: table.id,
    set: {
      role: row.role,
      content: row.content,
      thinking: row.thinking,
      toolCalls: row.toolCalls,
      segments: row.segments,
      status: row.status,
    },
  });
}

export function persistUserMessage(ref: ConversationRef, msg: Omit<StoredMessage, "status">): Promise<void> {
  return upsertMessage(ref, { ...msg, role: "user", status: "complete" });
}

/** Write the streaming placeholder so an interrupted run leaves a visible row. */
export function beginAssistantMessage(ref: ConversationRef, id: string): Promise<void> {
  return upsertMessage(ref, { id, role: "assistant", content: "", status: "streaming" });
}

export function finalizeAssistantMessage(ref: ConversationRef, msg: Omit<StoredMessage, "status" | "role">): Promise<void> {
  return upsertMessage(ref, { ...msg, role: "assistant", status: "complete" });
}

/** Delete every message in a conversation (used by the mid-stream summarize path). */
export async function clearConversation(ref: ConversationRef): Promise<void> {
  const table = tableFor(ref.scope) as any;
  const fk = fkColumn(ref.scope);
  await db.delete(table).where(eq(table[fk], ref.id));
}

/**
 * On boot no in-memory runs exist, so any assistant message still marked
 * "streaming" was orphaned by a restart. Flip them to "complete" so the UI
 * stops showing them as in-flight. Returns the number of rows touched.
 */
export async function reconcileStreamingMessages(): Promise<number> {
  let touched = 0;
  for (const scope of ["project", "image", "styleguide"] as const) {
    const table = tableFor(scope) as any;
    const res = await db.update(table)
      .set({ status: "complete" })
      .where(eq(table.status, "streaming"));
    touched += (res as any)?.changes ?? (res as any)?.rowsAffected ?? 0;
  }
  return touched;
}
