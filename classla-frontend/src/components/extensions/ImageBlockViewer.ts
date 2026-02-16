import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import ImageBlockViewerComponent from "../Blocks/Image/ImageBlockViewer";
import { ImageBlockData, defaultImageBlockData } from "./ImageBlock";

export const ImageBlockViewer = Node.create({
  name: "imageBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      imageData: {
        default: defaultImageBlockData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-image-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultImageBlockData;
            }
          }
          return defaultImageBlockData;
        },
        renderHTML: (attributes) => {
          if (!attributes.imageData) return {};
          return { "data-image-data": JSON.stringify(attributes.imageData) };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="image-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "image-block" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ImageBlockViewerComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".image-viewer-wrapper") &&
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
