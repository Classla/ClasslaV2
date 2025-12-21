import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ParsonsProblemViewerComponent from "../Blocks/ParsonsProblem/ParsonsProblemViewer";
import {
  ParsonsProblemData,
  validateParsonsProblemData,
  sanitizeParsonsProblemData,
} from "./ParsonsProblemBlock";

const defaultParsonsProblemData: ParsonsProblemData = {
  id: "",
  instruction: "",
  correctSolution: "",
  blocks: [],
  distractorBlocks: [],
  enableIndentation: true,
  indentSpaces: 4,
  showLineNumbers: true,
  feedbackMode: "immediate",
  points: 1,
};

export const ParsonsProblemBlockViewer = Node.create({
  name: "parsonsProblemBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  addAttributes() {
    return {
      parsonsProblemData: {
        default: defaultParsonsProblemData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-parsons-problem");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);
              const validation = validateParsonsProblemData(parsed, true);
              if (!validation.isValid) {
                console.warn(
                  "Invalid Parsons Problem data in viewer, sanitizing:",
                  validation.errors
                );
                return sanitizeParsonsProblemData(parsed);
              }
              return parsed;
            } catch (error) {
              console.error(
                "Failed to parse Parsons Problem data in viewer:",
                error
              );
              return sanitizeParsonsProblemData(null);
            }
          }
          return sanitizeParsonsProblemData(null);
        },
        renderHTML: (attributes) => {
          const parsonsProblemData =
            attributes.parsonsProblemData || defaultParsonsProblemData;
          const validation = validateParsonsProblemData(parsonsProblemData, true);

          if (!validation.isValid) {
            console.warn(
              "Invalid Parsons Problem data during viewer render:",
              validation.errors
            );
            const sanitizedData = sanitizeParsonsProblemData(parsonsProblemData);
            return {
              "data-parsons-problem": JSON.stringify(sanitizedData),
              "data-type": "parsons-problem-block",
            };
          }

          return {
            "data-parsons-problem": JSON.stringify(parsonsProblemData),
            "data-type": "parsons-problem-block",
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="parsons-problem-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const parsonsProblemData = node.attrs
      .parsonsProblemData as ParsonsProblemData;

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "parsons-problem-block",
        class: "parsons-problem-block-container",
      }),
      [
        "div",
        { class: "parsons-problem-instruction" },
        parsonsProblemData.instruction || "Enter instructions...",
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ParsonsProblemViewerComponent);
  },
});

export default ParsonsProblemBlockViewer;

