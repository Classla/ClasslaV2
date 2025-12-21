import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import PollViewerComponent from "../Blocks/Poll/PollViewer";
import {
  PollData,
  defaultPollData,
  sanitizePollData,
} from "./PollBlock";

export const PollBlockViewer = Node.create({
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
    return ReactNodeViewRenderer(PollViewerComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }
        if (
          target.closest(".poll-viewer-wrapper") &&
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

