import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import AlertEditorComponent from "../Blocks/Alert/AlertEditor";
import { generateUUID } from "./blockUtils";

export interface AlertData {
  id: string;
  alertType: "info" | "warning" | "alert";
  title: string;
  content: string;
}

export const defaultAlertData: AlertData = {
  id: "",
  alertType: "info",
  title: "",
  content: "",
};

export const validateAlertData = (data: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    errors.push("Alert data must be an object");
    return { isValid: false, errors };
  }
  if (!data.id || typeof data.id !== "string") {
    errors.push("Alert must have a valid ID");
  }
  return { isValid: errors.length === 0, errors };
};

export const sanitizeAlertData = (data: any): AlertData => {
  return {
    id: data?.id || generateUUID(),
    alertType: ["info", "warning", "alert"].includes(data?.alertType)
      ? data.alertType
      : "info",
    title: typeof data?.title === "string" ? data.title.trim() : "",
    content: typeof data?.content === "string" ? data.content.trim() : "",
  };
};

export const AlertBlock = Node.create({
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
    return ReactNodeViewRenderer(AlertEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".alert-editor-wrapper") &&
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
