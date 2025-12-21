import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import RevealContentViewerComponent from "../Blocks/RevealContent/RevealContentViewer";
import {
  RevealContentData,
  defaultRevealContentData,
  sanitizeRevealContentData,
} from "./RevealContentBlock";

export const RevealContentBlockViewer = Node.create({
  name: "revealContentBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      revealContentData: {
        default: defaultRevealContentData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-reveal-content-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultRevealContentData;
            }
          }
          return defaultRevealContentData;
        },
        renderHTML: (attributes) => {
          if (!attributes.revealContentData) {
            return {};
          }
          return {
            "data-reveal-content-data": JSON.stringify(attributes.revealContentData),
          };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="reveal-content-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "reveal-content-block" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RevealContentViewerComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".reveal-content-viewer-wrapper") &&
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

