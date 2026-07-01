/**
 * A conversation is one of three things the agent can chat against:
 *   - "project": the project-level "main thread" (chat_messages)
 *   - "image":   a side conversation focused on one storyboard frame (image_chat_messages)
 *   - "styleguide": the styleguide-editing conversation (styleguide_chat_messages)
 *
 * A ConversationKey is the stable identity of a conversation across the server
 * (run registry, persistence) and client (active-run map, status badges). It is
 * serialized as "<scope>:<id>" so it can be used as a Map key / URL segment.
 */
export type ConversationScope = "project" | "image" | "styleguide";

export interface ConversationRef {
  scope: ConversationScope;
  id: string;
}

export type ConversationKey = string; // `${scope}:${id}`

const SCOPES: ConversationScope[] = ["project", "image", "styleguide"];

export function makeConversationKey(scope: ConversationScope, id: string): ConversationKey {
  if (!SCOPES.includes(scope)) throw new Error(`invalid conversation scope: ${scope}`);
  if (!id) throw new Error("conversation id is required");
  return `${scope}:${id}`;
}

export function parseConversationKey(key: ConversationKey): ConversationRef {
  const sep = key.indexOf(":");
  if (sep === -1) throw new Error(`malformed conversation key: ${key}`);
  const scope = key.slice(0, sep) as ConversationScope;
  const id = key.slice(sep + 1);
  if (!SCOPES.includes(scope)) throw new Error(`invalid conversation scope in key: ${key}`);
  if (!id) throw new Error(`missing conversation id in key: ${key}`);
  return { scope, id };
}

/**
 * Derive the key from the fields a /chat request carries. An image-scoped side
 * chat is selected only when scope === "image" AND a selected image is present;
 * otherwise it's the project main thread (or a styleguide).
 */
export function conversationKeyFromRequest(opts: {
  styleguideId?: string | null;
  projectId?: string | null;
  selectedImageId?: string | null;
  chatScope?: "project" | "image" | null;
}): ConversationRef | null {
  if (opts.styleguideId) return { scope: "styleguide", id: opts.styleguideId };
  if (opts.chatScope === "image" && opts.selectedImageId) {
    return { scope: "image", id: opts.selectedImageId };
  }
  if (opts.projectId) return { scope: "project", id: opts.projectId };
  return null;
}
