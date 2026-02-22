import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import InlineImageNode from "../Blocks/InlineImage/InlineImageNode";

export const InlineImage = Node.create({
  name: "inlineImage",
  inline: true,
  group: "inline",
  atom: true,

  addAttributes() {
    return {
      s3Key: { default: "" },
      assignmentId: { default: "" },
      width: { default: 0 },
      alt: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "img[data-s3-key]",
        getAttrs: (el) => {
          const element = el as HTMLElement;
          return {
            s3Key: element.getAttribute("data-s3-key") || "",
            assignmentId: element.getAttribute("data-assignment-id") || "",
            width: parseInt(element.getAttribute("data-width") || "0", 10),
            alt: element.getAttribute("alt") || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const { s3Key, assignmentId, width, alt } = HTMLAttributes;
    return [
      "img",
      mergeAttributes({
        "data-s3-key": s3Key,
        "data-assignment-id": assignmentId,
        "data-width": String(width || 0),
        alt: alt || "",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineImageNode, {
      className: "inline-image-wrapper",
      as: "span",
    });
  },
});
