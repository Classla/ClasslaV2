import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import PollEditorComponent from "../Blocks/Poll/PollEditor";
import { generateUUID, isEmptyContent } from "./blockUtils";

export interface PollOption {
  id: string;
  text: string;
}

export interface PollData {
  id: string;
  question: string;
  options: PollOption[];
  selectionType: "single" | "multiple";
  showResults: "never" | "after-voting" | "after-close" | "immediately";
  allowAnswerChange: boolean;
  closeDate?: string; // ISO date string
}

export const defaultPollData: PollData = {
  id: "",
  question: "",
  options: [{ id: generateUUID(), text: "" }],
  selectionType: "single",
  showResults: "after-voting",
  allowAnswerChange: false,
};

export const validatePollData = (data: any): { isValid: boolean; errors: string[] } => {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    errors.push("Poll data must be an object");
    return { isValid: false, errors };
  }
  if (!data.id || typeof data.id !== "string") {
    errors.push("Poll must have a valid ID");
  }
  if (typeof data.question !== "string" || isEmptyContent(data.question)) {
    errors.push("Poll must have a question");
  }
  if (!Array.isArray(data.options) || data.options.length < 2) {
    errors.push("Poll must have at least 2 options");
  }
  // Check for empty option text (including empty HTML like <p></p>)
  const hasEmptyOptions = data.options?.some((opt: any) =>
    !opt.text || isEmptyContent(opt.text)
  );
  if (hasEmptyOptions) {
    errors.push("All options must have text");
  }
  return { isValid: errors.length === 0, errors };
};

export const sanitizePollData = (data: any): PollData => {
  return {
    id: data?.id || generateUUID(),
    question: typeof data?.question === "string" ? data.question.trim() : "",
    options: Array.isArray(data?.options)
      ? data.options.map((opt: any) => ({
          id: opt?.id || generateUUID(),
          text: typeof opt?.text === "string" ? opt.text.trim() : "",
        }))
      : [],
    selectionType: data?.selectionType === "multiple" ? "multiple" : "single",
    showResults: ["never", "after-voting", "after-close", "immediately"].includes(data?.showResults)
      ? data.showResults
      : "after-voting",
    allowAnswerChange: !!data?.allowAnswerChange,
    closeDate: typeof data?.closeDate === "string" ? data.closeDate : undefined,
  };
};

export const PollBlock = Node.create({
  name: "pollBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return {
      pollData: {
        default: defaultPollData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-poll-data");
          if (dataAttr) {
            try {
              return JSON.parse(dataAttr);
            } catch {
              return defaultPollData;
            }
          }
          return defaultPollData;
        },
        renderHTML: (attributes) => {
          if (!attributes.pollData) return {};
          return { "data-poll-data": JSON.stringify(attributes.pollData) };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-type="poll-block"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-type": "poll-block" }),
      0,
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(PollEditorComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".poll-editor-wrapper") &&
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

