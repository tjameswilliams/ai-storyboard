import { test, expect } from "bun:test";
import {
  makeConversationKey,
  parseConversationKey,
  conversationKeyFromRequest,
} from "../lib/conversationKey";

test("make/parse round-trips and rejects garbage", () => {
  expect(makeConversationKey("image", "abc")).toBe("image:abc");
  expect(parseConversationKey("image:abc")).toEqual({ scope: "image", id: "abc" });

  // ids containing a colon must survive (only the first colon splits)
  const weird = parseConversationKey("project:a:b:c");
  expect(weird).toEqual({ scope: "project", id: "a:b:c" });

  expect(() => makeConversationKey("bogus" as any, "x")).toThrow();
  expect(() => makeConversationKey("image", "")).toThrow();
  expect(() => parseConversationKey("noseparator")).toThrow();
  expect(() => parseConversationKey("bogus:x")).toThrow();
});

test("conversationKeyFromRequest applies scope precedence", () => {
  // styleguide wins over everything
  expect(conversationKeyFromRequest({ styleguideId: "sg1", projectId: "p1" }))
    .toEqual({ scope: "styleguide", id: "sg1" });
  // image scope + selected image -> image
  expect(conversationKeyFromRequest({ projectId: "p1", chatScope: "image", selectedImageId: "i1" }))
    .toEqual({ scope: "image", id: "i1" });
  // image scope but no selected image -> falls back to project
  expect(conversationKeyFromRequest({ projectId: "p1", chatScope: "image", selectedImageId: null }))
    .toEqual({ scope: "project", id: "p1" });
  // default project scope
  expect(conversationKeyFromRequest({ projectId: "p1" }))
    .toEqual({ scope: "project", id: "p1" });
  // nothing addressable
  expect(conversationKeyFromRequest({})).toBeNull();
});
