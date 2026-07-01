// Client mirror of server/lib/conversationKey.ts. A conversation is the
// project main thread, a per-frame side chat, or a styleguide chat. The key is
// the stable identity used for the active-run map and status badges.
export type ConversationScope = "project" | "image" | "styleguide";
export type ConversationKey = string; // `${scope}:${id}`

export function makeConversationKey(scope: ConversationScope, id: string): ConversationKey {
  return `${scope}:${id}`;
}

/** Derive the key from current store selection (matches server precedence). */
export function conversationKeyFor(opts: {
  styleguideId?: string | null;
  projectId?: string | null;
  selectedImageId?: string | null;
  chatScope?: "project" | "image" | null;
}): ConversationKey | null {
  if (opts.styleguideId) return makeConversationKey("styleguide", opts.styleguideId);
  if (opts.chatScope === "image" && opts.selectedImageId) {
    return makeConversationKey("image", opts.selectedImageId);
  }
  if (opts.projectId) return makeConversationKey("project", opts.projectId);
  return null;
}
