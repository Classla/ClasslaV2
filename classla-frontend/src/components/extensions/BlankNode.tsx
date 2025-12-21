import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import React from "react";

export interface BlankNodeAttributes {
  blankId: string;
}

// React component for rendering the blank node
const BlankNodeComponent: React.FC<{ node: any }> = ({ node }) => {
  const blankId = node.attrs.blankId;
  return (
    <span
      className="inline-block px-2 py-1 mx-1 bg-yellow-100 border-2 border-dashed border-yellow-400 rounded text-sm font-mono cursor-default"
      data-blank-id={blankId}
      contentEditable={false}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => e.preventDefault()}
    >
      [BLANK]
    </span>
  );
};

export const BlankNode = Node.create({
  name: "blankNode",

  group: "inline",

  inline: true,

  atom: true,

  selectable: false,

  addAttributes() {
    return {
      blankId: {
        default: "",
        parseHTML: (element) => element.getAttribute("data-blank-id") || "",
        renderHTML: (attributes) => {
          return {
            "data-blank-id": attributes.blankId,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-blank-id]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        class: "blank-node",
        "data-blank-id": HTMLAttributes.blankId,
      }),
      "[BLANK]",
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(BlankNodeComponent);
  },
});

export default BlankNode;

