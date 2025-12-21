import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import DragDropMatchingEditorComponent from "../Blocks/DragDropMatching/DragDropMatchingEditor";
import { generateUUID } from "./blockUtils";

export interface DragDropMatchingItem {
  id: string;
  text: string;
  imageUrl?: string;
}

export interface DragDropMatchingTarget {
  id: string;
  label: string;
  correctItemIds: string[]; // Array of item IDs that match this target
}

export interface DragDropMatchingData {
  id: string;
  instruction: string;
  sourceItems: DragDropMatchingItem[];
  targetZones: DragDropMatchingTarget[];
  matchType: "one-to-one" | "many-to-one"; // One item to one zone, or multiple items to same zone
  randomizeItems: boolean;
  points: number;
  partialCredit: boolean;
}

export const defaultDragDropMatchingData: DragDropMatchingData = {
  id: "",
  instruction: "",
  sourceItems: [],
  targetZones: [],
  matchType: "one-to-one",
  randomizeItems: false,
  points: 1,
  partialCredit: true,
};

export const validateDragDropMatchingData = (
  data: any
): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];

  if (!data || typeof data !== "object") {
    errors.push("Drag-and-drop matching data must be an object");
    return { isValid: false, errors };
  }

  if (!data.id || typeof data.id !== "string") {
    errors.push("Drag-and-drop matching must have a valid ID");
  }

  if (typeof data.instruction !== "string") {
    errors.push("Drag-and-drop matching must have instruction text");
  }

  if (!Array.isArray(data.sourceItems)) {
    errors.push("Drag-and-drop matching must have a sourceItems array");
  } else {
    if (data.sourceItems.length < 2) {
      errors.push("Drag-and-drop matching must have at least 2 source items");
    }
    data.sourceItems.forEach((item: any, index: number) => {
      if (!item.id || typeof item.id !== "string") {
        errors.push(`Source item ${index + 1} must have a valid ID`);
      }
      if (typeof item.text !== "string" || item.text.trim() === "") {
        errors.push(`Source item ${index + 1} must have text`);
      }
    });
  }

  if (!Array.isArray(data.targetZones)) {
    errors.push("Drag-and-drop matching must have a targetZones array");
  } else {
    if (data.targetZones.length < 1) {
      errors.push("Drag-and-drop matching must have at least 1 target zone");
    }
    data.targetZones.forEach((zone: any, index: number) => {
      if (!zone.id || typeof zone.id !== "string") {
        errors.push(`Target zone ${index + 1} must have a valid ID`);
      }
      if (typeof zone.label !== "string" || zone.label.trim() === "") {
        errors.push(`Target zone ${index + 1} must have a label`);
      }
      if (!Array.isArray(zone.correctItemIds)) {
        errors.push(`Target zone ${index + 1} must have a correctItemIds array`);
      }
    });
  }

  if (data.matchType !== "one-to-one" && data.matchType !== "many-to-one") {
    errors.push("Match type must be 'one-to-one' or 'many-to-one'");
  }

  if (typeof data.points !== "number" || data.points < 0) {
    errors.push("Points must be a non-negative number");
  }

  return { isValid: errors.length === 0, errors };
};

export const sanitizeDragDropMatchingData = (
  data: any
): DragDropMatchingData => {
  const sanitized: DragDropMatchingData = {
    id: data?.id || generateUUID(),
    instruction: data?.instruction || "",
    sourceItems: Array.isArray(data?.sourceItems)
      ? data.sourceItems.map((item: any) => ({
          id: item?.id || generateUUID(),
          text: typeof item?.text === "string" ? item.text.trim() : "",
          imageUrl: typeof item?.imageUrl === "string" ? item.imageUrl : undefined,
        }))
      : [],
    targetZones: Array.isArray(data?.targetZones)
      ? data.targetZones.map((zone: any) => ({
          id: zone?.id || generateUUID(),
          label: typeof zone?.label === "string" ? zone.label.trim() : "",
          correctItemIds: Array.isArray(zone?.correctItemIds)
            ? zone.correctItemIds.filter((id: any) => typeof id === "string")
            : [],
        }))
      : [],
    matchType: data?.matchType === "many-to-one" ? "many-to-one" : "one-to-one",
    randomizeItems: !!data?.randomizeItems,
    points: typeof data?.points === "number" && data.points >= 0 ? data.points : 1,
    partialCredit: data?.partialCredit !== undefined ? !!data.partialCredit : true,
  };

  return sanitized;
};

export const DragDropMatchingBlock = Node.create({
  name: "dragDropMatchingBlock",

  group: "block",

  atom: true,

  addAttributes() {
    return {
      dragDropMatchingData: {
        default: defaultDragDropMatchingData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-drag-drop-matching-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultDragDropMatchingData;
            }
          }
          return defaultDragDropMatchingData;
        },
        renderHTML: (attributes) => {
          if (!attributes.dragDropMatchingData) {
            return {};
          }
          return {
            "data-drag-drop-matching-data": JSON.stringify(
              attributes.dragDropMatchingData
            ),
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="drag-drop-matching-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "drag-drop-matching-block",
      }),
      0,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DragDropMatchingEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".drag-drop-matching-editor-wrapper") &&
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

