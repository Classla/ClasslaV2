import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import MCQEditorComponent from "../Blocks/MCQ/MCQEditor";

// MCQ data interface as specified in the design document
export interface MCQOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface MCQBlockData {
  id: string;
  question: string;
  options: MCQOption[];
  allowMultiple: boolean;
  points: number;
  explanation?: string;
  allowCheckAnswer?: boolean;
}

// Generate a UUID v4 compatible ID
const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Default MCQ data for new blocks
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
  allowCheckAnswer: false,
};

// Memoized validation cache for performance optimization
const validationCache = new Map<
  string,
  { isValid: boolean; errors: string[] }
>();

// Utility function to convert HTML to plain text for display
const htmlToText = (html: string): string => {
  if (!html || html.trim() === "") return "";

  // Create a temporary div to parse HTML
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  // Get text content and clean up
  const text = tempDiv.textContent || tempDiv.innerText || "";
  return text.trim();
};

// Validation functions for MCQ data with caching for performance
export const validateMCQData = (
  data: any,
  isStudentView: boolean = false
): { isValid: boolean; errors: string[] } => {
  // Create a cache key based on the data structure
  const cacheKey = JSON.stringify(data) + (isStudentView ? "-student" : "");

  // Check cache first for performance
  if (validationCache.has(cacheKey)) {
    return validationCache.get(cacheKey)!;
  }

  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("MCQ data must be an object");
    const result = { isValid: false, errors };
    validationCache.set(cacheKey, result);
    return result;
  }

  // Validate required fields
  if (!data.id || typeof data.id !== "string") {
    errors.push("MCQ must have a valid ID");
  }

  if (typeof data.question !== "string") {
    errors.push("MCQ must have a question text");
  } else if (data.question.trim() === "" || data.question === "<p></p>") {
    // Allow empty question for new MCQs, but warn about completely empty questions
    // HTML content like "<p></p>" is considered empty
  }

  if (!Array.isArray(data.options)) {
    errors.push("MCQ must have an options array");
  } else {
    if (data.options.length < 2) {
      errors.push("MCQ must have at least 2 options");
    }

    data.options.forEach((option: any, index: number) => {
      if (!option || typeof option !== "object") {
        errors.push(`Option ${index + 1} must be an object`);
        return;
      }

      if (!option.id || typeof option.id !== "string") {
        errors.push(`Option ${index + 1} must have a valid ID`);
      }

      if (typeof option.text !== "string") {
        errors.push(`Option ${index + 1} must have text`);
      } else if (option.text.trim() === "" || option.text === "<p></p>") {
        // Allow empty text for new options, but warn about completely empty options
        // HTML content like "<p></p>" is considered empty
      }

      if (typeof option.isCorrect !== "boolean") {
        errors.push(`Option ${index + 1} must have a valid isCorrect boolean`);
      }
    });

    // Check if at least one option is marked as correct (skip for student view)
    if (!isStudentView) {
      const hasCorrectAnswer = data.options.some(
        (option: any) => option.isCorrect === true
      );
      if (!hasCorrectAnswer) {
        errors.push("MCQ must have at least one correct answer");
      }
    }
  }

  if (typeof data.allowMultiple !== "boolean") {
    errors.push("MCQ must have a valid allowMultiple boolean");
  }

  if (typeof data.points !== "number" || data.points < 0) {
    errors.push("MCQ must have a valid points value (>= 0)");
  }

  if (data.explanation !== undefined && typeof data.explanation !== "string") {
    errors.push("MCQ explanation must be a string if provided");
  }

  const result = { isValid: errors.length === 0, errors };

  // Cache the result, but limit cache size to prevent memory leaks
  if (validationCache.size > 100) {
    const firstKey = validationCache.keys().next().value;
    if (firstKey) {
      validationCache.delete(firstKey);
    }
  }
  validationCache.set(cacheKey, result);

  return result;
};

// Sanitize and repair MCQ data
export const sanitizeMCQData = (data: any): MCQBlockData => {
  if (!data || typeof data !== "object") {
    const newData = {
      ...defaultMCQData,
      id: generateUUID(),
      options: [
        { id: generateUUID(), text: "", isCorrect: true }, // Set first option as correct
        { id: generateUUID(), text: "", isCorrect: false },
      ],
    };
    return newData;
  }

  // Ensure required fields with fallbacks
  const sanitized: MCQBlockData = {
    id: data.id && typeof data.id === "string" ? data.id : generateUUID(),
    question: typeof data.question === "string" ? data.question : "",
    options: [],
    allowMultiple:
      typeof data.allowMultiple === "boolean" ? data.allowMultiple : false,
    points:
      typeof data.points === "number" && data.points >= 0 ? data.points : 1,
    explanation: typeof data.explanation === "string" ? data.explanation : "",
    allowCheckAnswer:
      typeof data.allowCheckAnswer === "boolean" ? data.allowCheckAnswer : false,
  };

  // Sanitize options array
  if (Array.isArray(data.options) && data.options.length > 0) {
    sanitized.options = data.options
      .filter((option: any) => option && typeof option === "object")
      .map((option: any) => ({
        id:
          option.id && typeof option.id === "string"
            ? option.id
            : generateUUID(),
        text: typeof option.text === "string" ? option.text : "",
        isCorrect:
          typeof option.isCorrect === "boolean" ? option.isCorrect : false,
      }));
  }

  // Ensure minimum 2 options
  while (sanitized.options.length < 2) {
    sanitized.options.push({
      id: generateUUID(),
      text: "",
      isCorrect: false,
    });
  }

  // Ensure at least one correct answer exists
  const hasCorrectAnswer = sanitized.options.some((option) => option.isCorrect);
  if (!hasCorrectAnswer && sanitized.options.length > 0) {
    sanitized.options[0].isCorrect = true;
  }

  return sanitized;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mcqBlock: {
      /**
       * Insert an MCQ block
       */
      insertMCQBlock: (data?: Partial<MCQBlockData>) => ReturnType;
    };
  }
}

export const MCQBlock = Node.create({
  name: "mcqBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  selectable: true,

  // Allow the node view to handle its own selection
  allowGapCursor: false,

  addAttributes() {
    return {
      mcqData: {
        default: defaultMCQData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-mcq");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);

              // Validate and sanitize the parsed data
              const validation = validateMCQData(parsed);
              if (!validation.isValid) {
                console.warn(
                  "Invalid MCQ data found, sanitizing:",
                  validation.errors
                );
              }

              const sanitizedData = sanitizeMCQData(parsed);

              // Generate new UUIDs for pasted content to avoid conflicts
              // This ensures each pasted MCQ block has unique identifiers
              return {
                ...sanitizedData,
                id: generateUUID(),
                options: sanitizedData.options.map((option) => ({
                  ...option,
                  id: generateUUID(),
                })),
              };
            } catch (error) {
              console.error("Failed to parse MCQ data, using default:", error);
              return sanitizeMCQData(null);
            }
          }
          return sanitizeMCQData(null);
        },
        renderHTML: (attributes) => {
          // Validate MCQ data before serializing
          const mcqData = attributes.mcqData || defaultMCQData;
          const validation = validateMCQData(mcqData);

          if (!validation.isValid) {
            console.warn(
              "Invalid MCQ data during render, sanitizing:",
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
        htmlToText(mcqData.question) || "Enter your question...",
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
            htmlToText(option.text) || `Option ${index + 1}`,
          ],
        ]),
      ],
    ];

    if (mcqData.explanation) {
      elements.push([
        "div",
        { class: "mcq-explanation" },
        htmlToText(mcqData.explanation),
      ]);
    }

    return elements as any;
  },

  addCommands() {
    return {
      insertMCQBlock:
        (data = {}) =>
        ({ commands }) => {
          const mcqData: MCQBlockData = {
            ...defaultMCQData,
            id: generateUUID(),
            options: [
              { id: generateUUID(), text: "", isCorrect: false },
              { id: generateUUID(), text: "", isCorrect: false },
            ],
            ...data,
          };

          return commands.insertContent({
            type: this.name,
            attrs: {
              mcqData,
            },
          });
        },
    };
  },

  // Ensure proper clipboard serialization
  addProseMirrorPlugins() {
    return [];
  },

  // Custom clipboard serialization to ensure MCQ data is preserved
  addStorage() {
    return {
      // Store clipboard data validation
      validateClipboardData: (data: any): boolean => {
        if (!data || typeof data !== "object") return false;

        // Check required fields
        const hasId = typeof data.id === "string";
        const hasQuestion = typeof data.question === "string";
        const hasOptions = Array.isArray(data.options);
        const hasAllowMultiple = typeof data.allowMultiple === "boolean";
        const hasPoints = typeof data.points === "number";

        return (
          hasId && hasQuestion && hasOptions && hasAllowMultiple && hasPoints
        );
      },

      // Generate new UUIDs for pasted content to avoid conflicts
      generateNewIds: (data: MCQBlockData): MCQBlockData => {
        return {
          ...data,
          id: generateUUID(),
          options: data.options.map((option) => ({
            ...option,
            id: generateUUID(),
          })),
        };
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MCQEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;

        // Only stop specific events that interfere with ProseMirror
        // Allow normal text editing events to pass through
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          // Allow all events on input/textarea elements for normal text editing
          return false;
        }

        // Stop events on buttons and other interactive elements
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }

        // Stop events on the MCQ editor wrapper but not on inputs
        if (
          target.closest(".mcq-editor-wrapper") &&
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

export default MCQBlock;
