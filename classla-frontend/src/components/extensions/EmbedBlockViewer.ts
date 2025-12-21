import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import EmbedViewerComponent from "../Blocks/Embed/EmbedViewer";
import {
  EmbedData,
  defaultEmbedData,
  sanitizeEmbedData,
} from "./EmbedBlock";

export const EmbedBlockViewer = Node.create({
  name: "embedBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      embedData: {
        default: defaultEmbedData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-embed-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultEmbedData;
            }
          }
          return defaultEmbedData;
        },
        renderHTML: (attributes) => {
          if (!attributes.embedData) return {};
          return { "data-embed-data": JSON.stringify(attributes.embedData) };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="embed-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "embed-block" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedViewerComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".embed-viewer-wrapper") &&
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

