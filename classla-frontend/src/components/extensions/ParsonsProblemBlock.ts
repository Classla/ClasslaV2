import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ParsonsProblemEditorComponent from "../Blocks/ParsonsProblem/ParsonsProblemEditor";
import { generateUUID, htmlToText } from "./blockUtils";

export interface ParsonsProblemBlock {
  id: string;
  code: string;
  indentLevel: number;
}

export interface ParsonsProblemData {
  id: string;
  instruction: string;
  correctSolution: string; // Code that gets split into blocks
  blocks: ParsonsProblemBlock[];
  distractorBlocks: Array<{
    id: string;
    code: string;
  }>;
  enableIndentation: boolean;
  indentSpaces: number; // Default 4
  showLineNumbers: boolean;
  feedbackMode: "immediate" | "onCorrect";
  points: number;
}

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

const validationCache = new Map<
  string,
  { isValid: boolean; errors: string[] }
>();

export const validateParsonsProblemData = (
  data: any,
  isStudentView: boolean = false
): { isValid: boolean; errors: string[] } => {
  const cacheKey = JSON.stringify(data) + (isStudentView ? "-student" : "");

  if (validationCache.has(cacheKey)) {
    return validationCache.get(cacheKey)!;
  }

  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Parsons Problem data must be an object");
    const result = { isValid: false, errors };
    validationCache.set(cacheKey, result);
    return result;
  }

  if (!data.id || typeof data.id !== "string") {
    errors.push("Parsons Problem must have a valid ID");
  }

  if (typeof data.instruction !== "string") {
    errors.push("Parsons Problem must have an instruction text");
  }

  if (typeof data.points !== "number" || data.points < 0) {
    errors.push("Parsons Problem must have a valid points value (>= 0)");
  }

  const result = { isValid: errors.length === 0, errors };

  if (validationCache.size > 100) {
    const firstKey = validationCache.keys().next().value;
    if (firstKey) {
      validationCache.delete(firstKey);
    }
  }
  validationCache.set(cacheKey, result);

  return result;
};

export const sanitizeParsonsProblemData = (
  data: any
): ParsonsProblemData => {
  if (!data || typeof data !== "object") {
    return {
      ...defaultParsonsProblemData,
      id: generateUUID(),
    };
  }

  return {
    id: data.id && typeof data.id === "string" ? data.id : generateUUID(),
    instruction: typeof data.instruction === "string" ? data.instruction : "",
    correctSolution:
      typeof data.correctSolution === "string" ? data.correctSolution : "",
    blocks: Array.isArray(data.blocks)
      ? data.blocks
          .filter((b: any) => b && typeof b === "object")
          .map((b: any) => ({
            id: b.id && typeof b.id === "string" ? b.id : generateUUID(),
            code: typeof b.code === "string" ? b.code : "",
            indentLevel:
              typeof b.indentLevel === "number" && b.indentLevel >= 0
                ? b.indentLevel
                : 0,
          }))
      : [],
    distractorBlocks: Array.isArray(data.distractorBlocks)
      ? data.distractorBlocks
          .filter((b: any) => b && typeof b === "object")
          .map((b: any) => ({
            id: b.id && typeof b.id === "string" ? b.id : generateUUID(),
            code: typeof b.code === "string" ? b.code : "",
          }))
      : [],
    enableIndentation:
      typeof data.enableIndentation === "boolean"
        ? data.enableIndentation
        : true,
    indentSpaces:
      typeof data.indentSpaces === "number" && data.indentSpaces > 0
        ? data.indentSpaces
        : 4,
    showLineNumbers:
      typeof data.showLineNumbers === "boolean"
        ? data.showLineNumbers
        : true,
    feedbackMode:
      data.feedbackMode === "onCorrect" ? "onCorrect" : "immediate",
    points:
      typeof data.points === "number" && data.points >= 0 ? data.points : 1,
  };
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    parsonsProblemBlock: {
      insertParsonsProblemBlock: (
        data?: Partial<ParsonsProblemData>
      ) => ReturnType;
    };
  }
}

export const ParsonsProblemBlock = Node.create({
  name: "parsonsProblemBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  selectable: true,

  allowGapCursor: false,

  // Debug: Log when extension is created
  onCreate() {
    console.log("[ParsonsProblemBlock] Extension created");
  },

  addAttributes() {
    return {
      parsonsProblemData: {
        default: defaultParsonsProblemData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-parsons-problem");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);
              const validation = validateParsonsProblemData(parsed);
              if (!validation.isValid) {
                console.warn(
                  "Invalid Parsons Problem data found, sanitizing:",
                  validation.errors
                );
              }
              const sanitizedData = sanitizeParsonsProblemData(parsed);
              return {
                ...sanitizedData,
                id: generateUUID(),
                blocks: sanitizedData.blocks.map((b) => ({
                  ...b,
                  id: generateUUID(),
                })),
                distractorBlocks: sanitizedData.distractorBlocks.map((b) => ({
                  ...b,
                  id: generateUUID(),
                })),
              };
            } catch (error) {
              console.error(
                "Failed to parse Parsons Problem data, using default:",
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
          const validation = validateParsonsProblemData(parsonsProblemData);

          if (!validation.isValid) {
            console.warn(
              "Invalid Parsons Problem data during render, sanitizing:",
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
        htmlToText(parsonsProblemData.instruction) ||
          "Enter instructions...",
      ],
    ];
  },

  addCommands() {
    return {
      insertParsonsProblemBlock:
        (data = {}) =>
        ({ commands }) => {
          const parsonsProblemData: ParsonsProblemData = {
            ...defaultParsonsProblemData,
            id: generateUUID(),
            ...data,
          };

          return commands.insertContent({
            type: this.name,
            attrs: {
              parsonsProblemData,
            },
          });
        },
    };
  },

  addProseMirrorPlugins() {
    return [];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ParsonsProblemEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;

        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }

        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }

        if (
          target.closest(".parsons-problem-editor-wrapper") &&
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

export default ParsonsProblemBlock;

