import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import AlertViewerComponent from "../Blocks/Alert/AlertViewer";
import { defaultAlertData } from "./AlertBlock";

export const AlertBlockViewer = Node.create({
  name: "alertBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      alertData: {
        default: defaultAlertData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-alert-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultAlertData;
            }
          }
          return defaultAlertData;
        },
        renderHTML: (attributes) => {
          if (!attributes.alertData) return {};
          return { "data-alert-data": JSON.stringify(attributes.alertData) };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="alert-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "alert-block" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(AlertViewerComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".alert-viewer-wrapper") &&
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
