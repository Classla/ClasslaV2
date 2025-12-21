import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import DiscussionViewerComponent from "../Blocks/Discussion/DiscussionViewer";
import {
  DiscussionData,
  defaultDiscussionData,
  sanitizeDiscussionData,
} from "./DiscussionBlock";

export const DiscussionBlockViewer = Node.create({
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
    return ReactNodeViewRenderer(DiscussionViewerComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".discussion-viewer-wrapper") &&
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

