import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import DiscussionEditorComponent from "../Blocks/Discussion/DiscussionEditor";
import { generateUUID } from "./blockUtils";

export interface DiscussionData {
  id: string;
  prompt: string;
  allowAnonymous: boolean;
  requireModeration: boolean;
  enableReplies: boolean;
  enableVoting: boolean;
  maxPostsPerStudent?: number;
  closeDate?: string;
}

export const defaultDiscussionData: DiscussionData = {
  id: "",
  prompt: "",
  allowAnonymous: false,
  requireModeration: false,
  enableReplies: true,
  enableVoting: false,
};

export const validateDiscussionData = (data: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    errors.push("Discussion data must be an object");
    return { isValid: false, errors };
  }
  if (!data.id || typeof data.id !== "string") {
    errors.push("Discussion must have a valid ID");
  }
  return { isValid: errors.length === 0, errors };
};

export const sanitizeDiscussionData = (data: any): DiscussionData => {
  return {
    id: data?.id || generateUUID(),
    prompt: typeof data?.prompt === "string" ? data.prompt.trim() : "",
    allowAnonymous: !!data?.allowAnonymous,
    requireModeration: !!data?.requireModeration,
    enableReplies: data?.enableReplies !== undefined ? !!data.enableReplies : true,
    enableVoting: !!data?.enableVoting,
    maxPostsPerStudent: typeof data?.maxPostsPerStudent === "number" ? data.maxPostsPerStudent : undefined,
    closeDate: typeof data?.closeDate === "string" ? data.closeDate : undefined,
  };
};

export const DiscussionBlock = Node.create({
  name: "discussionBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      discussionData: {
        default: defaultDiscussionData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-discussion-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultDiscussionData;
            }
          }
          return defaultDiscussionData;
        },
        renderHTML: (attributes) => {
          if (!attributes.discussionData) return {};
          return { "data-discussion-data": JSON.stringify(attributes.discussionData) };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="discussion-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "discussion-block" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(DiscussionEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".discussion-editor-wrapper") &&
          target.tagName !== "INPUT" &&
          target.tagName !== "TEXTAREA"
        ) {
          return true;
        }
        return false;
      },
    });
  },
});

