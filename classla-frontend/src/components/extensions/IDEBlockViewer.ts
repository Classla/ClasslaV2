import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import IDEBlockViewerComponent from "../Blocks/IDE/IDEBlockViewer";
import {
  IDEBlockData,
  validateIDEBlockData,
  sanitizeIDEBlockData,
} from "./IDEBlock";

// Default IDE block data for viewer blocks
const defaultIDEBlockData: IDEBlockData = {
  id: "",
  template: {
    s3_bucket_id: null,
    last_container_id: null,
  },
  modelSolution: {
    s3_bucket_id: null,
    last_container_id: null,
  },
  autoGrading: {
    s3_bucket_id: null,
    last_container_id: null,
  },
  points: 1,
  settings: {
    default_run_file: "main.py",
    // language is intentionally not set - inherited from editor settings
  },
};

export const IDEBlockViewer = Node.create({
  name: "ideBlock",

  group: "block",

  content: "",

  atom: true,

  draggable: false, // Not draggable in viewer mode

  addAttributes() {
    return {
      ideData: {
        default: defaultIDEBlockData,
        parseHTML: (element) => {
          const dataAttr = element.getAttribute("data-ide");
          if (dataAttr) {
            try {
              const parsed = JSON.parse(dataAttr);

              // Validate and sanitize the parsed data
              const validation = validateIDEBlockData(parsed);
              if (!validation.isValid) {
                console.warn(
                  "Invalid IDE block data in viewer, sanitizing:",
                  validation.errors
                );
                return sanitizeIDEBlockData(parsed);
              }

              return parsed;
            } catch (error) {
              console.error("Failed to parse IDE block data in viewer:", error);
              return sanitizeIDEBlockData(null);
            }
          }
          return sanitizeIDEBlockData(null);
        },
        renderHTML: (attributes) => {
          // Validate before rendering
          const ideData = attributes.ideData || defaultIDEBlockData;
          const validation = validateIDEBlockData(ideData);

          if (!validation.isValid) {
            console.warn(
              "Invalid IDE block data during viewer render:",
              validation.errors
            );
            const sanitizedData = sanitizeIDEBlockData(ideData);
            return {
              "data-ide": JSON.stringify(sanitizedData),
              "data-type": "ide-block",
            };
          }

          return {
            "data-ide": JSON.stringify(ideData),
            "data-type": "ide-block",
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="ide-block"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const ideData = node.attrs.ideData as IDEBlockData;

    return [
      "div",
      mergeAttributes(HTMLAttributes, {
        "data-type": "ide-block",
        class: "ide-block-container",
      }),
      [
        "div",
        { class: "ide-block-placeholder" },
        "IDE Block - Virtual Codespace",
      ],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(IDEBlockViewerComponent, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement;

        // Only stop specific events that interfere with ProseMirror
        if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
          return false;
        }

        // Stop events on buttons and other interactive elements
        if (target.tagName === "BUTTON" || target.closest("button")) {
          return true;
        }

        // Stop events on the IDE viewer wrapper but not on inputs
        if (
          target.closest(".ide-viewer-wrapper") &&
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

export default IDEBlockViewer;

