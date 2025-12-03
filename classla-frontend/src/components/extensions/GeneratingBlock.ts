import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import GeneratingBlockComponent from "../Blocks/AI/GeneratingBlockView";

export interface GeneratingBlockData {
  blockType: string;
  blockIndex: number;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    generatingBlock: {
      insertGeneratingBlock: (data: GeneratingBlockData) => ReturnType;
    };
  }
}

export const GeneratingBlock = Node.create({
  name: "generatingBlock",
  group: "block",
  content: "",
  atom: true,
  draggable: false,
  selectable: true,
  allowGapCursor: false,

  addAttributes() {
    return {
      blockType: {
        default: "paragraph",
        parseHTML: (element) => element.getAttribute("data-block-type") || "paragraph",
        renderHTML: (attributes) => {
          return {
            "data-block-type": attributes.blockType,
          };
        },
      },
      blockIndex: {
        default: 0,
        parseHTML: (element) => {
          const index = element.getAttribute("data-block-index");
          return index ? parseInt(index, 10) : 0;
        },
        renderHTML: (attributes) => {
          return {
            "data-block-index": attributes.blockIndex.toString(),
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="generating-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "generating-block",
        class: "generating-block-container",
      }),
      `Generating ${node.attrs.blockType}...`,
    ];
  },

  addCommands() {
    return {
      insertGeneratingBlock:
        (data: GeneratingBlockData) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: {
              blockType: data.blockType,
              blockIndex: data.blockIndex,
            },
          });
        },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(GeneratingBlockComponent);
  },
});

export default GeneratingBlock;

