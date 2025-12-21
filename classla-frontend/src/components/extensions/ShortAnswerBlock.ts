import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ShortAnswerEditorComponent from "../Blocks/ShortAnswer/ShortAnswerEditor";
import { generateUUID, htmlToText } from "./blockUtils";

export interface ShortAnswerData {
  id: string;
  prompt: string; // Rich text question
  minWords?: number;
  maxWords?: number;
  points: number;
  sampleAnswer?: string; // Hidden from students
  gradingType?: "manual" | "keyword" | "regex"; // Grading method
  keywordMatches?: string[]; // Keywords/phrases that must be present
  regexPattern?: string; // Regex pattern for matching
  caseSensitive?: boolean; // For keyword/regex matching
}

const defaultShortAnswerData: ShortAnswerData = {
  id: "",
  prompt: "",
  minWords: undefined,
  maxWords: undefined,
  points: 1,
  sampleAnswer: "",
  gradingType: "manual",
  keywordMatches: [],
  regexPattern: "",
  caseSensitive: false,
};

const validationCache = new Map<
  string,
  { isValid: boolean; errors: string[] }
>();

export const validateShortAnswerData = (
  data: any,
  isStudentView: boolean = false
): { isValid: boolean; errors: string[] } => {
  const cacheKey = JSON.stringify(data) + (isStudentView ? "-student" : "");

  if (validationCache.has(cacheKey)) {
    return validationCache.get(cacheKey)!;
  }

  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Short Answer data must be an object");
    const result = { isValid: false, errors };
    validationCache.set(cacheKey, result);
    return result;
  }

  if (!data.id || typeof data.id !== "string") {
    errors.push("Short Answer must have a valid ID");
  }

  if (typeof data.prompt !== "string") {
    errors.push("Short Answer must have a prompt text");
  }

  if (typeof data.points !== "number" || data.points < 0) {
    errors.push("Short Answer must have a valid points value (>= 0)");
  }

  if (
    data.minWords !== undefined &&
    (typeof data.minWords !== "number" || data.minWords < 0)
  ) {
    errors.push("Short Answer minWords must be a non-negative number");
  }

  if (
    data.maxWords !== undefined &&
    (typeof data.maxWords !== "number" || data.maxWords < 0)
  ) {
    errors.push("Short Answer maxWords must be a non-negative number");
  }

  if (
    data.minWords !== undefined &&
    data.maxWords !== undefined &&
    data.minWords > data.maxWords
  ) {
    errors.push("Short Answer minWords cannot be greater than maxWords");
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

export const sanitizeShortAnswerData = (data: any): ShortAnswerData => {
  if (!data || typeof data !== "object") {
    return {
      ...defaultShortAnswerData,
      id: generateUUID(),
    };
  }

  return {
    id: data.id && typeof data.id === "string" ? data.id : generateUUID(),
    prompt: typeof data.prompt === "string" ? data.prompt : "",
    minWords:
      typeof data.minWords === "number" && data.minWords >= 0
        ? data.minWords
        : undefined,
    maxWords:
      typeof data.maxWords === "number" && data.maxWords >= 0
        ? data.maxWords
        : undefined,
    points:
      typeof data.points === "number" && data.points >= 0 ? data.points : 1,
    sampleAnswer:
      typeof data.sampleAnswer === "string" ? data.sampleAnswer : undefined,
    gradingType:
      data.gradingType === "keyword" || data.gradingType === "regex"
        ? data.gradingType
        : "manual",
    keywordMatches:
      Array.isArray(data.keywordMatches) ? data.keywordMatches : [],
    regexPattern:
      typeof data.regexPattern === "string" ? data.regexPattern : "",
    caseSensitive:
      typeof data.caseSensitive === "boolean" ? data.caseSensitive : false,
  };
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    shortAnswerBlock: {
      insertShortAnswerBlock: (
        data?: Partial<ShortAnswerData>
      ) => ReturnType;
    };
  }
}

export const ShortAnswerBlock = Node.create({
  name: "shortAnswerBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  selectable: true,

  allowGapCursor: false,

  // Debug: Log when extension is created
  onCreate() {
    console.log("[ShortAnswerBlock] Extension created");
  },

  addAttributes() {
    return {
      shortAnswerData: {
        default: defaultShortAnswerData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-short-answer");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);
              const validation = validateShortAnswerData(parsed);
              if (!validation.isValid) {
                console.warn(
                  "Invalid Short Answer data found, sanitizing:",
                  validation.errors
                );
              }
              const sanitizedData = sanitizeShortAnswerData(parsed);
              return {
                ...sanitizedData,
                id: generateUUID(),
              };
            } catch (error) {
              console.error(
                "Failed to parse Short Answer data, using default:",
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
          const validation = validateShortAnswerData(shortAnswerData);

          if (!validation.isValid) {
            console.warn(
              "Invalid Short Answer data during render, sanitizing:",
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
        htmlToText(shortAnswerData.prompt) || "Enter your prompt...",
      ],
    ];
  },

  addCommands() {
    return {
      insertShortAnswerBlock:
        (data = {}) =>
        ({ commands }) => {
          const shortAnswerData: ShortAnswerData = {
            ...defaultShortAnswerData,
            id: generateUUID(),
            ...data,
          };

          return commands.insertContent({
            type: this.name,
            attrs: {
              shortAnswerData,
            },
          });
        },
    };
  },

  addProseMirrorPlugins() {
    return [];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ShortAnswerEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;

        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }

        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }

        if (
          target.closest(".short-answer-editor-wrapper") &&
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

export default ShortAnswerBlock;

