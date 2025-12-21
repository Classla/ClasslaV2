import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import FillInTheBlankViewerComponent from "../Blocks/FillInTheBlank/FillInTheBlankViewer";
import {
  FillInTheBlankData,
  validateFillInTheBlankData,
  sanitizeFillInTheBlankData,
} from "./FillInTheBlankBlock";

const defaultFillInTheBlankData: FillInTheBlankData = {
  id: "",
  question: "",
  blanks: [],
  points: 1,
  pointsPerBlank: false,
  attempts: 3,
  showHintAfterAttempts: 1,
  showAnswerAfterAttempts: 3,
  generalFeedback: "",
};

export const FillInTheBlankBlockViewer = Node.create({
  name: "fillInTheBlankBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  addAttributes() {
    return {
      fillInTheBlankData: {
        default: defaultFillInTheBlankData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-fill-in-the-blank");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);
              const validation = validateFillInTheBlankData(parsed, true);
              if (!validation.isValid) {
                console.warn(
                  "Invalid Fill-in-the-Blank data in viewer, sanitizing:",
                  validation.errors
                );
                return sanitizeFillInTheBlankData(parsed);
              }
              return parsed;
            } catch (error) {
              console.error(
                "Failed to parse Fill-in-the-Blank data in viewer:",
                error
              );
              return sanitizeFillInTheBlankData(null);
            }
          }
          return sanitizeFillInTheBlankData(null);
        },
        renderHTML: (attributes) => {
          const fillInTheBlankData =
            attributes.fillInTheBlankData || defaultFillInTheBlankData;
          const validation = validateFillInTheBlankData(fillInTheBlankData, true);

          if (!validation.isValid) {
            console.warn(
              "Invalid Fill-in-the-Blank data during viewer render:",
              validation.errors
            );
            const sanitizedData = sanitizeFillInTheBlankData(fillInTheBlankData);
            return {
              "data-fill-in-the-blank": JSON.stringify(sanitizedData),
              "data-type": "fill-in-the-blank-block",
            };
          }

          return {
            "data-fill-in-the-blank": JSON.stringify(fillInTheBlankData),
            "data-type": "fill-in-the-blank-block",
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="fill-in-the-blank-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const fillInTheBlankData = node.attrs.fillInTheBlankData as FillInTheBlankData;

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "fill-in-the-blank-block",
        class: "fill-in-the-blank-block-container",
      }),
      [
        "div",
        { class: "fill-in-the-blank-question" },
        fillInTheBlankData.question || "Enter your fill-in-the-blank question...",
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FillInTheBlankViewerComponent, {
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
          target.closest(".fill-in-the-blank-viewer-wrapper") &&
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

export default FillInTheBlankBlockViewer;

