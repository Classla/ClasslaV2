import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import IDEBlockEditorComponent from "../Blocks/IDE/IDEBlockEditor";

// IDE Block data interface
export interface IDEBlockTabData {
  s3_bucket_id: string | null;
  last_container_id: string | null;
}

export interface IDEBlockSettings {
  default_run_file: string;
}

export interface IDEBlockData {
  id: string;
  template: IDEBlockTabData;
  modelSolution: IDEBlockTabData;
  autoGrading: IDEBlockTabData;
  points: number;
  settings: IDEBlockSettings;
}

// Generate a UUID v4 compatible ID
const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

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
          : "main.py",
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

  // Ensure proper clipboard serialization
  addProseMirrorPlugins() {
    return [];
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
        if (
          target.closest(".ide-editor-wrapper") &&
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

export default IDEBlock;

