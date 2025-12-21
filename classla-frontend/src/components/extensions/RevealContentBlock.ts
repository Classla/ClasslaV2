import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import RevealContentEditorComponent from "../Blocks/RevealContent/RevealContentEditor";
import { generateUUID } from "./blockUtils";

export interface RevealContentData {
  id: string;
  buttonText: string;
  buttonIcon?: string;
  content: string; // HTML content
  initiallyVisible: boolean;
  showHideButton: boolean;
  buttonStyle: "default" | "accent" | "custom";
}

export const defaultRevealContentData: RevealContentData = {
  id: "",
  buttonText: "Show Hint",
  content: "",
  initiallyVisible: false,
  showHideButton: true,
  buttonStyle: "default",
};

export const validateRevealContentData = (
  data: any
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Reveal content data must be an object");
    return { isValid: false, errors };
  }

  if (!data.id || typeof data.id !== "string") {
    errors.push("Reveal content must have a valid ID");
  }

  if (typeof data.buttonText !== "string" || data.buttonText.trim() === "") {
    errors.push("Reveal content must have button text");
  }

  return { isValid: errors.length === 0, errors };
};

export const sanitizeRevealContentData = (
  data: any
): RevealContentData => {
  return {
    id: data?.id || generateUUID(),
    buttonText: typeof data?.buttonText === "string" ? data.buttonText.trim() : "Show Hint",
    buttonIcon: typeof data?.buttonIcon === "string" ? data.buttonIcon : undefined,
    content: typeof data?.content === "string" ? data.content : "",
    initiallyVisible: !!data?.initiallyVisible,
    showHideButton: data?.showHideButton !== undefined ? !!data.showHideButton : true,
    buttonStyle: data?.buttonStyle === "accent" || data?.buttonStyle === "custom" ? data.buttonStyle : "default",
  };
};

export const RevealContentBlock = Node.create({
  name: "revealContentBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      revealContentData: {
        default: defaultRevealContentData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-reveal-content-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultRevealContentData;
            }
          }
          return defaultRevealContentData;
        },
        renderHTML: (attributes) => {
          if (!attributes.revealContentData) {
            return {};
          }
          return {
            "data-reveal-content-data": JSON.stringify(attributes.revealContentData),
          };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="reveal-content-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "reveal-content-block" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(RevealContentEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".reveal-content-editor-wrapper") &&
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

