import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ClickableAreaEditorComponent from "../Blocks/ClickableArea/ClickableAreaEditor";
import { generateUUID, htmlToText } from "./blockUtils";

export interface ClickableAreaLine {
  lineNumber: number;
  content: string;
  isCorrect: boolean;
  isClickable: boolean;
}

export interface ClickableAreaData {
  id: string;
  instruction: string;
  content: string; // Code or text
  lines: ClickableAreaLine[];
  showLineNumbers: boolean;
  allowMultipleAttempts: boolean;
  showCorrectAfterAttempts: number;
  points: number;
  partialCredit: boolean;
}

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

const validationCache = new Map<
  string,
  { isValid: boolean; errors: string[] }
>();

export const validateClickableAreaData = (
  data: any,
  isStudentView: boolean = false
): { isValid: boolean; errors: string[] } => {
  const cacheKey = JSON.stringify(data) + (isStudentView ? "-student" : "");

  if (validationCache.has(cacheKey)) {
    return validationCache.get(cacheKey)!;
  }

  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Code Selection data must be an object");
    const result = { isValid: false, errors };
    validationCache.set(cacheKey, result);
    return result;
  }

  if (!data.id || typeof data.id !== "string") {
    errors.push("Code Selection must have a valid ID");
  }

  if (typeof data.instruction !== "string") {
    errors.push("Code Selection must have an instruction text");
  }

  if (typeof data.points !== "number" || data.points < 0) {
    errors.push("Code Selection must have a valid points value (>= 0)");
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

export const sanitizeClickableAreaData = (
  data: any
): ClickableAreaData => {
  if (!data || typeof data !== "object") {
    return {
      ...defaultClickableAreaData,
      id: generateUUID(),
    };
  }

  return {
    id: data.id && typeof data.id === "string" ? data.id : generateUUID(),
    instruction: typeof data.instruction === "string" ? data.instruction : "",
    content: typeof data.content === "string" ? data.content : "",
    lines: Array.isArray(data.lines)
      ? data.lines
          .filter((l: any) => l && typeof l === "object")
          .map((l: any) => ({
            lineNumber:
              typeof l.lineNumber === "number" && l.lineNumber >= 0
                ? l.lineNumber
                : 0,
            content: typeof l.content === "string" ? l.content : "",
            isCorrect:
              typeof l.isCorrect === "boolean" ? l.isCorrect : false,
            isClickable:
              typeof l.isClickable === "boolean" ? l.isClickable : true,
          }))
      : [],
    showLineNumbers:
      typeof data.showLineNumbers === "boolean"
        ? data.showLineNumbers
        : true,
    allowMultipleAttempts:
      typeof data.allowMultipleAttempts === "boolean"
        ? data.allowMultipleAttempts
        : true,
    showCorrectAfterAttempts:
      typeof data.showCorrectAfterAttempts === "number"
        ? data.showCorrectAfterAttempts
        : 3,
    points:
      typeof data.points === "number" && data.points >= 0 ? data.points : 1,
    partialCredit:
      typeof data.partialCredit === "boolean" ? data.partialCredit : true,
  };
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    clickableAreaBlock: {
      insertClickableAreaBlock: (
        data?: Partial<ClickableAreaData>
      ) => ReturnType;
    };
  }
}

export const ClickableAreaBlock = Node.create({
  name: "clickableAreaBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  selectable: true,

  allowGapCursor: false,

  // Debug: Log when extension is created
  onCreate() {
    console.log("[ClickableAreaBlock] Extension created");
  },

  addAttributes() {
    return {
      clickableAreaData: {
        default: defaultClickableAreaData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-clickable-area");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);
              const validation = validateClickableAreaData(parsed);
              if (!validation.isValid) {
                console.warn(
                  "Invalid Clickable Area data found, sanitizing:",
                  validation.errors
                );
              }
              const sanitizedData = sanitizeClickableAreaData(parsed);
              return {
                ...sanitizedData,
                id: generateUUID(),
                lines: sanitizedData.lines.map((l) => ({
                  ...l,
                })),
              };
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
        htmlToText(clickableAreaData.instruction) || "Enter instruction...",
      ],
    ];
  },

  addCommands() {
    return {
      insertClickableAreaBlock:
        (data = {}) =>
        ({ commands }) => {
          const clickableAreaData: ClickableAreaData = {
            ...defaultClickableAreaData,
            id: generateUUID(),
            ...data,
          };

          return commands.insertContent({
            type: this.name,
            attrs: {
              clickableAreaData,
            },
          });
        },
    };
  },

  addProseMirrorPlugins() {
    return [];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ClickableAreaEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;

        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }

        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }

        if (
          target.closest(".clickable-area-editor-wrapper") &&
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

export default ClickableAreaBlock;

