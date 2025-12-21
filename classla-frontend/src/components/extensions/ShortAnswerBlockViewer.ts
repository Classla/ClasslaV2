import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ShortAnswerViewerComponent from "../Blocks/ShortAnswer/ShortAnswerViewer";
import {
  ShortAnswerData,
  validateShortAnswerData,
  sanitizeShortAnswerData,
} from "./ShortAnswerBlock";

const defaultShortAnswerData: ShortAnswerData = {
  id: "",
  prompt: "",
  minWords: undefined,
  maxWords: undefined,
  points: 1,
  sampleAnswer: "",
};

export const ShortAnswerBlockViewer = Node.create({
  name: "shortAnswerBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  addAttributes() {
    return {
      shortAnswerData: {
        default: defaultShortAnswerData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-short-answer");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);
              const validation = validateShortAnswerData(parsed, true);
              if (!validation.isValid) {
                console.warn(
                  "Invalid Short Answer data in viewer, sanitizing:",
                  validation.errors
                );
                return sanitizeShortAnswerData(parsed);
              }
              return parsed;
            } catch (error) {
              console.error(
                "Failed to parse Short Answer data in viewer:",
                error
              );
              return sanitizeShortAnswerData(null);
            }
          }
          return sanitizeShortAnswerData(null);
        },
        renderHTML: (attributes) => {
          const shortAnswerData =
            attributes.shortAnswerData || defaultShortAnswerData;
          const validation = validateShortAnswerData(shortAnswerData, true);

          if (!validation.isValid) {
            console.warn(
              "Invalid Short Answer data during viewer render:",
              validation.errors
            );
            const sanitizedData = sanitizeShortAnswerData(shortAnswerData);
            return {
              "data-short-answer": JSON.stringify(sanitizedData),
              "data-type": "short-answer-block",
            };
          }

          return {
            "data-short-answer": JSON.stringify(shortAnswerData),
            "data-type": "short-answer-block",
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="short-answer-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const shortAnswerData = node.attrs.shortAnswerData as ShortAnswerData;

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "short-answer-block",
        class: "short-answer-block-container",
      }),
      [
        "div",
        { class: "short-answer-prompt" },
        shortAnswerData.prompt || "Enter your prompt...",
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ShortAnswerViewerComponent);
  },
});

export default ShortAnswerBlockViewer;

