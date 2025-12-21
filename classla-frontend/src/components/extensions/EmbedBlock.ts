import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import EmbedEditorComponent from "../Blocks/Embed/EmbedEditor";
import { generateUUID } from "./blockUtils";

export interface EmbedData {
  id: string;
  title?: string;
  embedType: "youtube" | "vimeo" | "iframe" | "video";
  url: string;
  embedCode?: string; // For iframe embed code
  startTime?: string; // MM:SS format for videos
  width?: "responsive" | "fixed";
  height?: "auto" | "fixed";
  customWidth?: number;
  customHeight?: number;
  allowFullscreen: boolean;
}

export const defaultEmbedData: EmbedData = {
  id: "",
  embedType: "iframe",
  url: "",
  allowFullscreen: true,
};

export const validateEmbedData = (data: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    errors.push("Embed data must be an object");
    return { isValid: false, errors };
  }
  if (!data.id || typeof data.id !== "string") {
    errors.push("Embed must have a valid ID");
  }
  if (!data.url && !data.embedCode) {
    errors.push("Embed must have a URL or embed code");
  }
  return { isValid: errors.length === 0, errors };
};

export const sanitizeEmbedData = (data: any): EmbedData => {
  return {
    id: data?.id || generateUUID(),
    title: typeof data?.title === "string" ? data.title.trim() : undefined,
    embedType: ["youtube", "vimeo", "iframe", "video"].includes(data?.embedType)
      ? data.embedType
      : "iframe",
    url: typeof data?.url === "string" ? data.url.trim() : "",
    embedCode: typeof data?.embedCode === "string" ? data.embedCode.trim() : undefined,
    startTime: typeof data?.startTime === "string" ? data.startTime : undefined,
    width: data?.width === "fixed" ? "fixed" : "responsive",
    height: data?.height === "fixed" ? "fixed" : "auto",
    customWidth: typeof data?.customWidth === "number" ? data.customWidth : undefined,
    customHeight: typeof data?.customHeight === "number" ? data.customHeight : undefined,
    allowFullscreen: data?.allowFullscreen !== undefined ? !!data.allowFullscreen : true,
  };
};

export const EmbedBlock = Node.create({
  name: "embedBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      embedData: {
        default: defaultEmbedData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-embed-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultEmbedData;
            }
          }
          return defaultEmbedData;
        },
        renderHTML: (attributes) => {
          if (!attributes.embedData) return {};
          return { "data-embed-data": JSON.stringify(attributes.embedData) };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="embed-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "embed-block" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(EmbedEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".embed-editor-wrapper") &&
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

