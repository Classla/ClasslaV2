import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import MCQViewerComponent from "../Blocks/MCQ/MCQViewer";
import { MCQBlockData, validateMCQData, sanitizeMCQData } from "./MCQBlock";

// Default MCQ data for viewer blocks
const defaultMCQData: MCQBlockData = {
  id: "",
  question: "",
  options: [
    { id: "opt-1", text: "", isCorrect: false },
    { id: "opt-2", text: "", isCorrect: false },
  ],
  allowMultiple: false,
  points: 1,
  explanation: "",
};

export const MCQBlockViewer = Node.create({
  name: "mcqBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false, // Not draggable in viewer mode

  addAttributes() {
    return {
      mcqData: {
        default: defaultMCQData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-mcq");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);

              // Validate and sanitize the parsed data (student view mode)
              const validation = validateMCQData(parsed, true);
              if (!validation.isValid) {
                console.warn(
                  "Invalid MCQ data in viewer, sanitizing:",
                  validation.errors
                );
                return sanitizeMCQData(parsed);
              }

              return parsed;
            } catch (error) {
              console.error("Failed to parse MCQ data in viewer:", error);
              return sanitizeMCQData(null);
            }
          }
          return sanitizeMCQData(null);
        },
        renderHTML: (attributes) => {
          // Validate before rendering (student view mode)
          const mcqData = attributes.mcqData || defaultMCQData;
          const validation = validateMCQData(mcqData, true);

          if (!validation.isValid) {
            console.warn(
              "Invalid MCQ data during viewer render:",
              validation.errors
            );
            const sanitizedData = sanitizeMCQData(mcqData);
            return {
              "data-mcq": JSON.stringify(sanitizedData),
              "data-type": "mcq-block",
            };
          }

          return {
            "data-mcq": JSON.stringify(mcqData),
            "data-type": "mcq-block",
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="mcq-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const mcqData = node.attrs.mcqData as MCQBlockData;

    const elements: any[] = [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "mcq-block",
        class: "mcq-block-container",
      }),
      [
        "div",
        { class: "mcq-question" },
        mcqData.question || "Enter your question...",
      ],
      [
        "div",
        { class: "mcq-options" },
        ...mcqData.options.map((option, index) => [
          "div",
          {
            class: "mcq-option",
            "data-option-id": option.id,
          },
          [
            "input",
            {
              type: mcqData.allowMultiple ? "checkbox" : "radio",
              name: `mcq-${mcqData.id}`,
              id: `option-${option.id}`,
              disabled: "disabled",
              class: "mcq-option-input",
            },
          ],
          [
            "label",
            {
              for: `option-${option.id}`,
              class: "mcq-option-label",
            },
            option.text || `Option ${index + 1}`,
          ],
        ]),
      ],
    ];

    if (mcqData.explanation) {
      elements.push(["div", { class: "mcq-explanation" }, mcqData.explanation]);
    }

    return elements as any;
  },

  addNodeView() {
    return ReactNodeViewRenderer(MCQViewerComponent);
  },
});

export default MCQBlockViewer;
