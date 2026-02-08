import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import IDEBlockEditorComponent from "../Blocks/IDE/IDEBlockEditor";
import { generateUUID } from "./blockUtils";

// IDE Block data interface
export interface IDEBlockTabData {
  s3_bucket_id: string | null;
  last_container_id: string | null;
}

export type IDELanguage = "python" | "java";

export interface IDEBlockSettings {
  default_run_file: string;
  language?: IDELanguage; // Optional - must be selected before starting
}

// Test case types
export type TestCaseType = "inputOutput" | "unitTest" | "manualGrading";

export interface InputOutputTestCase {
  id: string;
  name: string;
  type: "inputOutput";
  input: string;
  expectedOutput: string;
  points: number;
}

export interface UnitTestCase {
  id: string;
  name: string;
  type: "unitTest";
  code: string;
  points: number;
  framework?: "junit" | "unittest"; // Unit testing framework
}

export interface ManualGradingTestCase {
  id: string;
  name: string;
  type: "manualGrading";
  points: number;
}

export type TestCase = InputOutputTestCase | UnitTestCase | ManualGradingTestCase;

export interface IDEBlockAutograder {
  tests: TestCase[];
  allowStudentCheckAnswer?: boolean; // Whether students can check their answers
}

export interface IDEBlockData {
  id: string;
  template: IDEBlockTabData;
  modelSolution: IDEBlockTabData;
  autoGrading: IDEBlockTabData;
  points: number;
  settings: IDEBlockSettings;
  autograder?: IDEBlockAutograder;
}

// Default IDE block data for new blocks
const defaultIDEBlockData: IDEBlockData = {
  id: "",
  template: {
    s3_bucket_id: null,
    last_container_id: null,
  },
  modelSolution: {
    s3_bucket_id: null,
    last_container_id: null,
  },
  autoGrading: {
    s3_bucket_id: null,
    last_container_id: null,
  },
  points: 1,
  settings: {
    default_run_file: "main.py",
    // language is intentionally not set - user must select before starting
  },
  autograder: {
    tests: [],
    allowStudentCheckAnswer: false,
  },
};

// Validation functions for IDE block data
export const validateIDEBlockData = (
  data: any
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("IDE block data must be an object");
    return { isValid: false, errors };
  }

  // Validate required fields
  if (!data.id || typeof data.id !== "string") {
    errors.push("IDE block must have a valid ID");
  }

  if (typeof data.points !== "number" || data.points < 0) {
    errors.push("IDE block must have a valid points value (>= 0)");
  }

  // Validate settings
  if (data.settings && typeof data.settings !== "object") {
    errors.push("IDE block settings must be an object");
  } else if (data.settings) {
    if (
      data.settings.default_run_file !== undefined &&
      typeof data.settings.default_run_file !== "string"
    ) {
      errors.push("IDE block settings.default_run_file must be a string");
    }
    if (
      data.settings.language !== undefined &&
      !["python", "java"].includes(data.settings.language)
    ) {
      errors.push("IDE block settings.language must be 'python' or 'java'");
    }
  }

  // Validate tab data structure
  const tabs = ["template", "modelSolution", "autoGrading"];
  for (const tab of tabs) {
    if (!data[tab] || typeof data[tab] !== "object") {
      errors.push(`IDE block ${tab} must be an object`);
    } else {
      const tabData = data[tab];
      if (
        tabData.s3_bucket_id !== null &&
        typeof tabData.s3_bucket_id !== "string"
      ) {
        errors.push(`IDE block ${tab}.s3_bucket_id must be a string or null`);
      }
      if (
        tabData.last_container_id !== null &&
        typeof tabData.last_container_id !== "string"
      ) {
        errors.push(
          `IDE block ${tab}.last_container_id must be a string or null`
        );
      }
    }
  }

  // Validate autograder data if present
  if (data.autograder !== undefined) {
    if (data.autograder === null || typeof data.autograder !== "object") {
      errors.push("IDE block autograder must be an object or undefined");
    } else {
      if (!Array.isArray(data.autograder.tests)) {
        errors.push("IDE block autograder.tests must be an array");
      } else {
        // Validate each test case
        data.autograder.tests.forEach((test: any, index: number) => {
          if (!test || typeof test !== "object") {
            errors.push(`IDE block autograder.tests[${index}] must be an object`);
            return;
          }
          if (!test.id || typeof test.id !== "string") {
            errors.push(`IDE block autograder.tests[${index}].id must be a string`);
          }
          if (!test.name || typeof test.name !== "string") {
            errors.push(`IDE block autograder.tests[${index}].name must be a string`);
          }
          if (!test.type || !["inputOutput", "unitTest", "manualGrading"].includes(test.type)) {
            errors.push(`IDE block autograder.tests[${index}].type must be one of: inputOutput, unitTest, manualGrading`);
          }
          if (typeof test.points !== "number" || test.points < 0) {
            errors.push(`IDE block autograder.tests[${index}].points must be a number >= 0`);
          }
          if (test.type === "inputOutput") {
            if (typeof test.input !== "string") {
              errors.push(`IDE block autograder.tests[${index}].input must be a string`);
            }
            if (typeof test.expectedOutput !== "string") {
              errors.push(`IDE block autograder.tests[${index}].expectedOutput must be a string`);
            }
          } else if (test.type === "unitTest") {
            if (typeof test.code !== "string") {
              errors.push(`IDE block autograder.tests[${index}].code must be a string`);
            }
            if (test.framework !== undefined && !["junit", "unittest"].includes(test.framework)) {
              errors.push(`IDE block autograder.tests[${index}].framework must be one of: junit, unittest`);
            }
          }
        });
      }
    }
  }

  return { isValid: errors.length === 0, errors };
};

// Sanitize and repair IDE block data
export const sanitizeIDEBlockData = (data: any): IDEBlockData => {
  if (!data || typeof data !== "object") {
    const newData = {
      ...defaultIDEBlockData,
      id: generateUUID(),
    };
    return newData;
  }

  // Ensure required fields with fallbacks
  const sanitized: IDEBlockData = {
    id: data.id && typeof data.id === "string" ? data.id : generateUUID(),
    template: {
      s3_bucket_id:
        data.template?.s3_bucket_id !== undefined
          ? data.template.s3_bucket_id
          : null,
      last_container_id:
        data.template?.last_container_id !== undefined
          ? data.template.last_container_id
          : null,
    },
    modelSolution: {
      s3_bucket_id:
        data.modelSolution?.s3_bucket_id !== undefined
          ? data.modelSolution.s3_bucket_id
          : null,
      last_container_id:
        data.modelSolution?.last_container_id !== undefined
          ? data.modelSolution.last_container_id
          : null,
    },
    autoGrading: {
      s3_bucket_id:
        data.autoGrading?.s3_bucket_id !== undefined
          ? data.autoGrading.s3_bucket_id
          : null,
      last_container_id:
        data.autoGrading?.last_container_id !== undefined
          ? data.autoGrading.last_container_id
          : null,
    },
    points:
      typeof data.points === "number" && data.points >= 0 ? data.points : 1,
    settings: {
      default_run_file:
        data.settings?.default_run_file && typeof data.settings.default_run_file === "string"
          ? data.settings.default_run_file
          : data.settings?.language === "java" ? "Main.java" : "main.py",
      // language is optional - only set if valid, otherwise undefined (user must select)
      ...(data.settings?.language && ["python", "java"].includes(data.settings.language)
        ? { language: data.settings.language }
        : {}),
    },
    autograder: data.autograder && typeof data.autograder === "object" && Array.isArray(data.autograder.tests)
      ? {
          tests: data.autograder.tests.map((test: any) => {
            // Sanitize each test case
            const sanitizedTest: any = {
              id: test.id && typeof test.id === "string" ? test.id : generateUUID(),
              name: test.name && typeof test.name === "string" ? test.name : "",
              type: test.type && ["inputOutput", "unitTest", "manualGrading"].includes(test.type)
                ? test.type
                : "manualGrading",
              points: typeof test.points === "number" && test.points >= 0 ? test.points : 1,
            };

            if (sanitizedTest.type === "inputOutput") {
              sanitizedTest.input = typeof test.input === "string" ? test.input : "";
              sanitizedTest.expectedOutput = typeof test.expectedOutput === "string" ? test.expectedOutput : "";
            } else if (sanitizedTest.type === "unitTest") {
              sanitizedTest.code = typeof test.code === "string" ? test.code : "";
              sanitizedTest.framework = test.framework && ["junit", "unittest"].includes(test.framework)
                ? test.framework
                : "unittest";
            }

            return sanitizedTest;
          }),
          allowStudentCheckAnswer: typeof data.autograder.allowStudentCheckAnswer === "boolean"
            ? data.autograder.allowStudentCheckAnswer
            : false,
        }
      : {
          tests: [],
          allowStudentCheckAnswer: false,
        },
  };

  return sanitized;
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ideBlock: {
      /**
       * Insert an IDE block
       */
      insertIDEBlock: (data?: Partial<IDEBlockData>) => ReturnType;
    };
  }
}

export const IDEBlock = Node.create({
  name: "ideBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  selectable: true,

  // Allow the node view to handle its own selection
  allowGapCursor: false,

  addAttributes() {
    return {
      ideData: {
        default: defaultIDEBlockData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-ide");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);

              // Validate and sanitize the parsed data
              const validation = validateIDEBlockData(parsed);
              if (!validation.isValid) {
                console.warn(
                  "Invalid IDE block data found, sanitizing:",
                  validation.errors
                );
              }

              const sanitizedData = sanitizeIDEBlockData(parsed);

              // Generate new UUID for pasted content to avoid conflicts
              return {
                ...sanitizedData,
                id: generateUUID(),
              };
            } catch (error) {
              console.error("Failed to parse IDE block data, using default:", error);
              return sanitizeIDEBlockData(null);
            }
          }
          return sanitizeIDEBlockData(null);
        },
        renderHTML: (attributes) => {
          // Validate IDE block data before serializing
          const ideData = attributes.ideData || defaultIDEBlockData;
          const validation = validateIDEBlockData(ideData);

          if (!validation.isValid) {
            console.warn(
              "Invalid IDE block data during render, sanitizing:",
              validation.errors
            );
            const sanitizedData = sanitizeIDEBlockData(ideData);
            return {
              "data-ide": JSON.stringify(sanitizedData),
              "data-type": "ide-block",
            };
          }

          return {
            "data-ide": JSON.stringify(ideData),
            "data-type": "ide-block",
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="ide-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const ideData = node.attrs.ideData as IDEBlockData;

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "ide-block",
        class: "ide-block-container",
      }),
      [
        "div",
        { class: "ide-block-placeholder" },
        "IDE Block - Virtual Codespace",
      ],
    ];
  },

  addCommands() {
    return {
      insertIDEBlock:
        (data = {}) =>
        ({ commands }) => {
          const ideData: IDEBlockData = {
            ...defaultIDEBlockData,
            id: generateUUID(),
            ...data,
          };

          return commands.insertContent({
            type: this.name,
            attrs: {
              ideData,
            },
          });
        },
    };
  },

  // Custom clipboard serialization to ensure IDE block data is preserved
  addStorage() {
    return {
      // Store clipboard data validation
      validateClipboardData: (data: any): boolean => {
        if (!data || typeof data !== "object") return false;

        // Check required fields
        const hasId = typeof data.id === "string";
        const hasPoints = typeof data.points === "number";
        const hasTabs =
          data.template &&
          data.modelSolution &&
          data.autoGrading &&
          typeof data.template === "object" &&
          typeof data.modelSolution === "object" &&
          typeof data.autoGrading === "object";

        return hasId && hasPoints && hasTabs;
      },

      // Generate new UUIDs for pasted content to avoid conflicts
      generateNewIds: (data: IDEBlockData): IDEBlockData => {
        return {
          ...data,
          id: generateUUID(),
        };
      },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(IDEBlockEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;

        // Stop ALL keyboard events inside IDE editor to prevent page scrolling
        if (event.type.startsWith("key")) {
          if (target.closest(".ide-editor-wrapper")) {
            return true;
          }
        }

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

        // Stop events on the IDE editor wrapper but not on inputs
        // Also check for Monaco Editor iframe
        if (
          target.closest(".ide-editor-wrapper") &&
          target.tagName !== "INPUT" &&
          target.tagName !== "TEXTAREA" &&
          target.tagName !== "IFRAME" &&
          !target.closest("iframe")
        ) {
          return true;
        }

        return false;
      },
    });
  },
});

export default IDEBlock;

