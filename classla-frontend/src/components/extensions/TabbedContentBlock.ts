import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import TabbedContentEditorComponent from "../Blocks/TabbedContent/TabbedContentEditor";
import { generateUUID } from "./blockUtils";

export interface TabbedContentTab {
  id: string;
  label: string;
  icon?: string;
  content: string; // HTML content
}

export interface TabbedContentData {
  id: string;
  tabs: TabbedContentTab[];
  defaultActiveTab?: string; // ID of default active tab
  tabPosition: "top" | "left"; // Tab position
}

export const defaultTabbedContentData: TabbedContentData = {
  id: "",
  tabs: [],
  defaultActiveTab: undefined,
  tabPosition: "top",
};

export const validateTabbedContentData = (
  data: any
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Tabbed content data must be an object");
    return { isValid: false, errors };
  }

  if (!data.id || typeof data.id !== "string") {
    errors.push("Tabbed content must have a valid ID");
  }

  if (!Array.isArray(data.tabs)) {
    errors.push("Tabbed content must have a tabs array");
  } else {
    if (data.tabs.length < 1) {
      errors.push("Tabbed content must have at least 1 tab");
    }
    data.tabs.forEach((tab: any, index: number) => {
      if (!tab.id || typeof tab.id !== "string") {
        errors.push(`Tab ${index + 1} must have a valid ID`);
      }
      if (typeof tab.label !== "string" || tab.label.trim() === "") {
        errors.push(`Tab ${index + 1} must have a label`);
      }
    });
  }

  if (
    data.tabPosition !== undefined &&
    data.tabPosition !== "top" &&
    data.tabPosition !== "left"
  ) {
    errors.push("Tab position must be 'top' or 'left'");
  }

  return { isValid: errors.length === 0, errors };
};

export const sanitizeTabbedContentData = (
  data: any
): TabbedContentData => {
  const sanitized: TabbedContentData = {
    id: data?.id || generateUUID(),
    tabs: Array.isArray(data?.tabs)
      ? data.tabs.map((tab: any) => ({
          id: tab?.id || generateUUID(),
          label: typeof tab?.label === "string" ? tab.label.trim() : "",
          icon: typeof tab?.icon === "string" ? tab.icon : undefined,
          content: typeof tab?.content === "string" ? tab.content : "",
        }))
      : [],
    defaultActiveTab:
      typeof data?.defaultActiveTab === "string"
        ? data.defaultActiveTab
        : undefined,
    tabPosition:
      data?.tabPosition === "left" ? "left" : "top",
  };

  return sanitized;
};

export const TabbedContentBlock = Node.create({
  name: "tabbedContentBlock",

  group: "block",

  atom: true,

  addAttributes() {
    return {
      tabbedContentData: {
        default: defaultTabbedContentData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-tabbed-content-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultTabbedContentData;
            }
          }
          return defaultTabbedContentData;
        },
        renderHTML: (attributes) => {
          if (!attributes.tabbedContentData) {
            return {};
          }
          return {
            "data-tabbed-content-data": JSON.stringify(
              attributes.tabbedContentData
            ),
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="tabbed-content-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "tabbed-content-block",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TabbedContentEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".tabbed-content-editor-wrapper") &&
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

