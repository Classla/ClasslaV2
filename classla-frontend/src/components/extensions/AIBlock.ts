import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import AIBlockEditorComponent from "../Blocks/AI/AIBlockEditor";

// AI Block data interface
export interface AIBlockData {
  id: string;
  prompt: string;
  isGenerating: boolean;
}

// Generate a UUID v4 compatible ID
const generateUUID = (): string => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Default AI block data for new blocks
const defaultAIBlockData: AIBlockData = {
  id: generateUUID(),
  prompt: "",
  isGenerating: false,
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    aiBlock: {
      /**
       * Insert an AI block
       */
      insertAIBlock: (data?: Partial<AIBlockData>) => ReturnType;
    };
  }
}

export const AIBlock = Node.create({
  name: "aiBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false,

  selectable: true,

  // Allow the node view to handle its own selection
  allowGapCursor: false,

  addOptions() {
    return {
      assignmentId: "",
    };
  },

  addAttributes() {
    return {
      aiData: {
        default: defaultAIBlockData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-ai");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);
              return {
                id: parsed.id || generateUUID(),
                prompt: parsed.prompt || "",
                isGenerating: parsed.isGenerating || false,
              };
            } catch (error) {
              console.error("Failed to parse AI block data, using default:", error);
              return defaultAIBlockData;
            }
          }
          return defaultAIBlockData;
        },
        renderHTML: (attributes) => {
          const aiData = attributes.aiData || defaultAIBlockData;
          return {
            "data-ai": JSON.stringify(aiData),
            "data-type": "ai-block",
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="ai-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const aiData = node.attrs.aiData as AIBlockData;

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "ai-block",
        class: "ai-block-container",
      }),
      [
        "div",
        { class: "ai-block-prompt" },
        aiData.prompt || "Ask AI to generate content...",
      ],
    ];
  },

  addCommands() {
    return {
      insertAIBlock:
        (data = {}) =>
        ({ commands }) => {
          const aiData: AIBlockData = {
            ...defaultAIBlockData,
            id: generateUUID(),
            ...data,
          };

          return commands.insertContent({
            type: this.name,
            attrs: {
              aiData,
            },
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(AIBlockEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;

        // Stop ALL events from propagating to ProseMirror when inside AI block
        // This prevents ProseMirror from interfering with the AI block's input
        if (target.closest(".ai-block-editor-wrapper")) {
          // Always stop events inside the AI block wrapper
          return true;
        }

        return false;
      },
    });
  },
});

export default AIBlock;

