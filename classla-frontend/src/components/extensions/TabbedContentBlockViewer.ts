import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import TabbedContentViewerComponent from "../Blocks/TabbedContent/TabbedContentViewer";
import {
  TabbedContentData,
  defaultTabbedContentData,
  validateTabbedContentData,
  sanitizeTabbedContentData,
} from "./TabbedContentBlock";

export const TabbedContentBlockViewer = Node.create({
  name: "tabbedContentBlock",

  group: "block",

  atom: true,

  addAttributes() {
    return {
      tabbedContentData: {
        default: defaultTabbedContentData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-tabbed-content-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultTabbedContentData;
            }
          }
          return defaultTabbedContentData;
        },
        renderHTML: (attributes) => {
          if (!attributes.tabbedContentData) {
            return {};
          }
          return {
            "data-tabbed-content-data": JSON.stringify(
              attributes.tabbedContentData
            ),
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="tabbed-content-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "tabbed-content-block",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TabbedContentViewerComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".tabbed-content-viewer-wrapper") &&
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

