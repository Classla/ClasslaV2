import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import FillInTheBlankEditorComponent from "../Blocks/FillInTheBlank/FillInTheBlankEditor";
import { generateUUID, htmlToText } from "./blockUtils";

export interface FillInTheBlankBlank {
  id: string;
  acceptedAnswers: string[];
  caseSensitive: boolean;
  feedback?: string;
}

export interface FillInTheBlankData {
  id: string;
  question: string; // Rich text with [BLANK] markers
  blanks: FillInTheBlankBlank[];
  points: number;
  pointsPerBlank: boolean; // If true, award points per blank
  attempts: number; // Max attempts allowed
  showHintAfterAttempts?: number;
  showAnswerAfterAttempts?: number;
  generalFeedback?: string;
}

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

const validationCache = new Map<
  string,
  { isValid: boolean; errors: string[] }
>();

export const validateFillInTheBlankData = (
  data: any,
  isStudentView: boolean = false
): { isValid: boolean; errors: string[] } => {
  const cacheKey = JSON.stringify(data) + (isStudentView ? "-student" : "");

  if (validationCache.has(cacheKey)) {
    return validationCache.get(cacheKey)!;
  }

  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Fill-in-the-Blank data must be an object");
    const result = { isValid: false, errors };
    validationCache.set(cacheKey, result);
    return result;
  }

  if (!data.id || typeof data.id !== "string") {
    errors.push("Fill-in-the-Blank must have a valid ID");
  }

  if (typeof data.question !== "string") {
    errors.push("Fill-in-the-Blank must have a question text");
  }

  if (!Array.isArray(data.blanks)) {
    errors.push("Fill-in-the-Blank must have a blanks array");
  } else {
    data.blanks.forEach((blank: any, index: number) => {
      if (!blank || typeof blank !== "object") {
        errors.push(`Blank ${index + 1} must be an object`);
        return;
      }

      if (!blank.id || typeof blank.id !== "string") {
        errors.push(`Blank ${index + 1} must have a valid ID`);
      }

      // acceptedAnswers is filtered out for students (only used in autograding backend)
      // So we only validate it in editor mode, not in student view
      if (!isStudentView) {
        if (!Array.isArray(blank.acceptedAnswers)) {
          errors.push(`Blank ${index + 1} must have an acceptedAnswers array`);
        } else if (blank.acceptedAnswers.length === 0) {
          errors.push(`Blank ${index + 1} must have at least one accepted answer`);
        }
      }

      if (typeof blank.caseSensitive !== "boolean") {
        errors.push(`Blank ${index + 1} must have a valid caseSensitive boolean`);
      }
    });
  }

  if (typeof data.points !== "number" || data.points < 0) {
    errors.push("Fill-in-the-Blank must have a valid points value (>= 0)");
  }

  if (typeof data.pointsPerBlank !== "boolean") {
    errors.push("Fill-in-the-Blank must have a valid pointsPerBlank boolean");
  }

  if (typeof data.attempts !== "number" || data.attempts < 1) {
    errors.push("Fill-in-the-Blank must have a valid attempts value (>= 1)");
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

export const sanitizeFillInTheBlankData = (data: any): FillInTheBlankData => {
  if (!data || typeof data !== "object") {
    return {
      ...defaultFillInTheBlankData,
      id: generateUUID(),
    };
  }

  const sanitized: FillInTheBlankData = {
    id: data.id && typeof data.id === "string" ? data.id : generateUUID(),
    question: typeof data.question === "string" ? data.question : "",
    blanks: [],
    points:
      typeof data.points === "number" && data.points >= 0 ? data.points : 1,
    pointsPerBlank:
      typeof data.pointsPerBlank === "boolean" ? data.pointsPerBlank : false,
    attempts:
      typeof data.attempts === "number" && data.attempts >= 1
        ? data.attempts
        : 3,
    showHintAfterAttempts:
      typeof data.showHintAfterAttempts === "number"
        ? data.showHintAfterAttempts
        : 1,
    showAnswerAfterAttempts:
      typeof data.showAnswerAfterAttempts === "number"
        ? data.showAnswerAfterAttempts
        : 3,
    generalFeedback:
      typeof data.generalFeedback === "string" ? data.generalFeedback : "",
  };

  if (Array.isArray(data.blanks)) {
    sanitized.blanks = data.blanks
      .filter((blank: any) => blank && typeof blank === "object")
      .map((blank: any) => ({
        id:
          blank.id && typeof blank.id === "string"
            ? blank.id
            : generateUUID(),
        // acceptedAnswers may be missing in student view (filtered out for security)
        acceptedAnswers: Array.isArray(blank.acceptedAnswers)
          ? blank.acceptedAnswers.filter(
              (ans: any) => typeof ans === "string"
            )
          : [],
        caseSensitive:
          typeof blank.caseSensitive === "boolean"
            ? blank.caseSensitive
            : false,
        feedback:
          typeof blank.feedback === "string" ? blank.feedback : undefined,
      }));
  }

  return sanitized;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fillInTheBlankBlock: {
      insertFillInTheBlankBlock: (
        data?: Partial<FillInTheBlankData>
      ) => ReturnType;
    };
  }
}

export const FillInTheBlankBlock = Node.create({
  name: "fillInTheBlankBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  selectable: true,

  allowGapCursor: false,

  // Debug: Log when extension is created
  onCreate() {
    console.log("[FillInTheBlankBlock] Extension created");
  },

  addAttributes() {
    return {
      fillInTheBlankData: {
        default: defaultFillInTheBlankData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-fill-in-the-blank");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);
              const validation = validateFillInTheBlankData(parsed);
              if (!validation.isValid) {
                console.warn(
                  "Invalid Fill-in-the-Blank data found, sanitizing:",
                  validation.errors
                );
              }
              const sanitizedData = sanitizeFillInTheBlankData(parsed);
              return {
                ...sanitizedData,
                id: generateUUID(),
                blanks: sanitizedData.blanks.map((blank) => ({
                  ...blank,
                  id: generateUUID(),
                })),
              };
            } catch (error) {
              console.error(
                "Failed to parse Fill-in-the-Blank data, using default:",
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
          const validation = validateFillInTheBlankData(fillInTheBlankData);

          if (!validation.isValid) {
            console.warn(
              "Invalid Fill-in-the-Blank data during render, sanitizing:",
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
        htmlToText(fillInTheBlankData.question) ||
          "Enter your fill-in-the-blank question...",
      ],
    ];
  },

  addCommands() {
    return {
      insertFillInTheBlankBlock:
        (data = {}) =>
        ({ commands }) => {
          const fillInTheBlankData: FillInTheBlankData = {
            ...defaultFillInTheBlankData,
            id: generateUUID(),
            ...data,
          };

          return commands.insertContent({
            type: this.name,
            attrs: {
              fillInTheBlankData,
            },
          });
        },
    };
  },

  addProseMirrorPlugins() {
    return [];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FillInTheBlankEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;

        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }

        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }

        if (
          target.closest(".fill-in-the-blank-editor-wrapper") &&
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

export default FillInTheBlankBlock;

