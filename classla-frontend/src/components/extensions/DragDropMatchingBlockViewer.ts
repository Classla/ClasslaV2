import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import DragDropMatchingViewerComponent from "../Blocks/DragDropMatching/DragDropMatchingViewer";
import {
  DragDropMatchingData,
  defaultDragDropMatchingData,
  validateDragDropMatchingData,
  sanitizeDragDropMatchingData,
} from "./DragDropMatchingBlock";

export const DragDropMatchingBlockViewer = Node.create({
  name: "dragDropMatchingBlock",

  group: "block",

  atom: true,

  addAttributes() {
    return {
      dragDropMatchingData: {
        default: defaultDragDropMatchingData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-drag-drop-matching-data");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);
              // Sanitize and remove answer data for student view
              const sanitized = sanitizeDragDropMatchingData(parsed);
              // Remove correctItemIds from target zones
              sanitized.targetZones = sanitized.targetZones.map((zone) => ({
                ...zone,
                correctItemIds: [],
              }));
              return sanitized;
            } catch {
              return defaultDragDropMatchingData;
            }
          }
          return defaultDragDropMatchingData;
        },
        renderHTML: (attributes) => {
          if (!attributes.dragDropMatchingData) {
            return {};
          }
          return {
            "data-drag-drop-matching-data": JSON.stringify(
              attributes.dragDropMatchingData
            ),
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="drag-drop-matching-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "drag-drop-matching-block",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DragDropMatchingViewerComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".drag-drop-matching-viewer-wrapper") &&
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

