import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ClickableAreaViewerComponent from "../Blocks/ClickableArea/ClickableAreaViewer";
import {
  ClickableAreaData,
  validateClickableAreaData,
  sanitizeClickableAreaData,
} from "./ClickableAreaBlock";

const defaultClickableAreaData: ClickableAreaData = {
  id: "",
  instruction: "",
  content: "",
  lines: [],
  showLineNumbers: true,
  allowMultipleAttempts: true,
  showCorrectAfterAttempts: 3,
  points: 1,
  partialCredit: true,
};

export const ClickableAreaBlockViewer = Node.create({
  name: "clickableAreaBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  addAttributes() {
    return {
      clickableAreaData: {
        default: defaultClickableAreaData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-clickable-area");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);
              const validation = validateClickableAreaData(parsed, true);
              if (!validation.isValid) {
                console.warn(
                  "Invalid Code Selection data in viewer, sanitizing:",
                  validation.errors
                );
                return sanitizeClickableAreaData(parsed);
              }
              return parsed;
            } catch (error) {
              console.error(
                "Failed to parse Code Selection data, using default:",
                error
              );
              return sanitizeClickableAreaData(null);
            }
          }
          return sanitizeClickableAreaData(null);
        },
        renderHTML: (attributes) => {
          const clickableAreaData =
            attributes.clickableAreaData || defaultClickableAreaData;
          const validation = validateClickableAreaData(clickableAreaData);

          if (!validation.isValid) {
            console.warn(
              "Invalid Code Selection data during render, sanitizing:",
              validation.errors
            );
            const sanitizedData = sanitizeClickableAreaData(clickableAreaData);
            return {
              "data-clickable-area": JSON.stringify(sanitizedData),
              "data-type": "clickable-area-block",
            };
          }

          return {
            "data-clickable-area": JSON.stringify(clickableAreaData),
            "data-type": "clickable-area-block",
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="clickable-area-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const clickableAreaData = node.attrs.clickableAreaData as ClickableAreaData;

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "clickable-area-block",
        class: "clickable-area-block-container",
      }),
      [
        "div",
        { class: "clickable-area-instruction" },
        clickableAreaData.instruction || "Code Selection Question",
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ClickableAreaViewerComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;

        // Allow all events on input/textarea elements to pass through
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }

        // Stop events on buttons and other interactive elements
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }

        // Stop events on the viewer wrapper but not on inputs
        if (
          target.closest(".clickable-area-viewer-wrapper") &&
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

export default ClickableAreaBlockViewer;

