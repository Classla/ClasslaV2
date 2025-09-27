import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  memo,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import Dropcursor from "@tiptap/extension-dropcursor";
import Gapcursor from "@tiptap/extension-gapcursor";

import { apiClient } from "../lib/api";
import { MCQBlock, validateMCQData } from "./extensions/MCQBlock";
import { useToast } from "../hooks/use-toast";
import {
  useAssignmentOptimization,
  usePerformanceMonitoring,
} from "../hooks/useVirtualScrolling";
import { Assignment } from "../types";
import {
  Plus,
  GripVertical,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Table as TableIcon,
  Code,
  Minus,
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Link as LinkIcon,
  Strikethrough,
  HelpCircle,
} from "lucide-react";

interface AssignmentEditorProps {
  assignment: Assignment;
  onAssignmentUpdated: (assignment: Assignment) => void;
  isReadOnly?: boolean;
}

interface SlashCommandItem {
  title: string;
  description: string;
  icon: React.ReactNode;
  command: (editor: any) => void;
}

interface BlockControlsProps {
  block: HTMLElement;
  onAddBlock: () => void;
}

// Memoize BlockControls to prevent unnecessary re-renders
const BlockControls: React.FC<BlockControlsProps> = memo(
  ({ block, onAddBlock }) => {
    const [position, setPosition] = useState({ top: 0, left: 0 });

    useEffect(() => {
      if (block) {
        const rect = block.getBoundingClientRect();
        const containerRect = block
          .closest(".editor-container")
          ?.getBoundingClientRect();

        if (containerRect) {
          setPosition({
            top: rect.top - containerRect.top,
            left: -60, // Move further left to avoid overlap
          });
        }
      }
    }, [block]);

    return (
      <div
        className="block-controls absolute flex items-center space-x-0.5 z-10"
        style={{
          top: position.top + 2,
          left: position.left + 5, // Move right, closer to text
          paddingRight: "15px", // Smaller hover area
          paddingLeft: "5px",
          paddingTop: "2px",
          paddingBottom: "2px",
        }}
        onMouseEnter={() => {}} // Keep controls visible
        onMouseLeave={() => {}} // Let parent handle hiding
      >
        <button
          className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
          title="Add block below"
          onClick={onAddBlock}
          aria-label="Add block below"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          className="w-5 h-5 rounded flex items-center justify-center text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-all focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
          title="Drag to move"
          aria-label="Drag to move block"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </div>
    );
  }
);

const AssignmentEditor: React.FC<AssignmentEditorProps> = ({
  assignment,
  onAssignmentUpdated,
  isReadOnly = false,
}) => {
  const { toast } = useToast();
  const { shouldOptimize } = useAssignmentOptimization(
    assignment.content?.length || 0
  );
  const { measureRenderTime, updateMCQCount } = usePerformanceMonitoring();

  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ x: 0, y: 0 });
  const [slashMenuQuery, setSlashMenuQuery] = useState("");
  const [hoveredBlock, setHoveredBlock] = useState<HTMLElement | null>(null);
  const [showFloatingToolbar, setShowFloatingToolbar] = useState(false);
  const [floatingToolbarPosition, setFloatingToolbarPosition] = useState({
    x: 0,
    y: 0,
  });

  // Performance optimization: Use refs to avoid unnecessary re-renders
  const editorRef = useRef<any>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const blockHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mouseMoveThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const lastMouseMoveTime = useRef<number>(0);

  // Memoize slash commands to prevent recreation on every render
  const slashCommands: SlashCommandItem[] = useMemo(
    () => [
      {
        title: "Text",
        description: "Just start writing with plain text.",
        icon: <Type className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().setParagraph().run();
        },
      },
      {
        title: "Heading 1",
        description: "Big section heading.",
        icon: <Heading1 className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().toggleHeading({ level: 1 }).run();
        },
      },
      {
        title: "Heading 2",
        description: "Medium section heading.",
        icon: <Heading2 className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().toggleHeading({ level: 2 }).run();
        },
      },
      {
        title: "Heading 3",
        description: "Small section heading.",
        icon: <Heading3 className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().toggleHeading({ level: 3 }).run();
        },
      },
      {
        title: "Bullet List",
        description: "Create a simple bullet list.",
        icon: <List className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().toggleBulletList().run();
        },
      },
      {
        title: "Numbered List",
        description: "Create a list with numbering.",
        icon: <ListOrdered className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().toggleOrderedList().run();
        },
      },
      {
        title: "To-do List",
        description: "Track tasks with a to-do list.",
        icon: <CheckSquare className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().toggleTaskList().run();
        },
      },
      {
        title: "Quote",
        description: "Capture a quote.",
        icon: <Quote className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().toggleBlockquote().run();
        },
      },
      {
        title: "Code",
        description: "Capture a code snippet.",
        icon: <Code className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().toggleCodeBlock().run();
        },
      },
      {
        title: "Table",
        description: "Create a table.",
        icon: <TableIcon className="w-4 h-4" />,
        command: (editor) => {
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
        },
      },
      {
        title: "Divider",
        description: "Visually divide blocks.",
        icon: <Minus className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().setHorizontalRule().run();
        },
      },
      {
        title: "Multiple Choice Question",
        description: "Add an interactive MCQ block.",
        icon: <HelpCircle className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().insertMCQBlock().run();
        },
      },
    ],
    []
  ); // Empty dependency array since commands don't change

  // Memoize filtered commands to avoid filtering on every render
  const filteredCommands = useMemo(
    () =>
      slashCommands.filter((command) =>
        command.title.toLowerCase().includes(slashMenuQuery.toLowerCase())
      ),
    [slashCommands, slashMenuQuery]
  );

  // Memoize editor extensions to prevent recreation
  const editorExtensions = useMemo(
    () => [
      StarterKit.configure({
        bulletList: {
          keepMarks: true,
          keepAttributes: false,
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false,
        },
        dropcursor: false, // We'll add our own
        gapcursor: false, // We'll add our own
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") {
            return "What's the title?";
          }
          return "Type '/' for commands, or just start writing...";
        },
      }),
      Typography,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Dropcursor.configure({
        color: "#8b5cf6",
        width: 2,
      }),
      Gapcursor,
      MCQBlock,
    ],
    []
  );

  const editor = useEditor({
    extensions: editorExtensions,
    content: assignment.content || "",
    editable: !isReadOnly,
    editorProps: {
      attributes: {
        class: "main-prosemirror-editor",
        spellcheck: "false",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "Assignment content editor",
      },
    },
    onUpdate: ({ editor }) => {
      if (!isReadOnly) {
        // Auto-save after 2 seconds of inactivity with improved debouncing
        // Use JSON format instead of HTML for backend compatibility
        debouncedSave(JSON.stringify(editor.getJSON()));
      }
    },
    onSelectionUpdate: ({ editor }) => {
      if (!isReadOnly) {
        const { from, to } = editor.state.selection;

        // Check if selection is within an MCQ block
        const $from = editor.state.doc.resolve(from);
        const $to = editor.state.doc.resolve(to);

        // Check if we're inside an MCQ block by traversing up the node tree
        let isInMCQBlock = false;
        for (let depth = $from.depth; depth >= 0; depth--) {
          const node = $from.node(depth);
          if (node.type.name === "mcqBlock") {
            isInMCQBlock = true;
            break;
          }
        }

        // Also check the end position
        if (!isInMCQBlock) {
          for (let depth = $to.depth; depth >= 0; depth--) {
            const node = $to.node(depth);
            if (node.type.name === "mcqBlock") {
              isInMCQBlock = true;
              break;
            }
          }
        }

        // Handle floating toolbar for text selection (but not in MCQ blocks)
        if (from !== to && !isInMCQBlock) {
          // Text is selected and not in MCQ block
          try {
            const coords = editor.view.coordsAtPos(from);
            const endCoords = editor.view.coordsAtPos(to);
            const centerX = (coords.left + endCoords.left) / 2;

            setFloatingToolbarPosition({
              x: centerX,
              y: coords.top - 10,
            });
            setShowFloatingToolbar(true);
            setShowSlashMenu(false);
          } catch (error) {
            // Handle coordinate calculation errors
            setShowFloatingToolbar(false);
          }
        } else {
          // No text selected or in MCQ block
          setShowFloatingToolbar(false);

          // Handle slash command detection with throttling for performance (but not in MCQ blocks)
          if (!isInMCQBlock) {
            try {
              const text = editor.state.doc.textBetween(from - 10, to, " ");
              const slashIndex = text.lastIndexOf("/");

              if (slashIndex !== -1 && slashIndex === text.length - 1) {
                // Show slash menu
                const coords = editor.view.coordsAtPos(from);
                setSlashMenuPosition({ x: coords.left, y: coords.bottom });
                setSlashMenuQuery("");
                setShowSlashMenu(true);
              } else if (slashIndex !== -1 && slashIndex < text.length - 1) {
                // Update query with throttling
                const query = text.slice(slashIndex + 1);
                setSlashMenuQuery(query);
              } else {
                // Hide slash menu
                setShowSlashMenu(false);
              }
            } catch (error) {
              // Handle text extraction errors
              setShowSlashMenu(false);
            }
          } else {
            // Hide slash menu when in MCQ block
            setShowSlashMenu(false);
          }
        }
      }
    },
  });

  // Store editor reference for cleanup
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor]);

  // Optimized debounced save function with enhanced error handling and performance improvements
  const debouncedSave = useCallback(
    (content: string) => {
      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout
      saveTimeoutRef.current = setTimeout(async () => {
        if (content === assignment.content) return;

        setIsSaving(true);
        try {
          // Optimized validation: only validate if content has MCQ blocks
          // Parse JSON content to check for MCQ blocks
          let parsedContent;
          try {
            parsedContent = JSON.parse(content);
          } catch (parseError) {
            console.error("Invalid JSON content:", parseError);
            throw new Error("Content must be valid JSON");
          }

          // Recursively find MCQ blocks in the JSON structure
          const findMCQBlocks = (node: any): any[] => {
            const mcqBlocks: any[] = [];

            if (node && typeof node === "object") {
              if (node.type === "mcq-block" && node.attrs) {
                mcqBlocks.push(node.attrs);
              }

              if (node.content && Array.isArray(node.content)) {
                for (const child of node.content) {
                  mcqBlocks.push(...findMCQBlocks(child));
                }
              }
            }

            return mcqBlocks;
          };

          const mcqBlocks = findMCQBlocks(parsedContent);

          if (mcqBlocks.length > 0) {
            // Batch validate MCQ blocks for better performance
            const validationPromises = mcqBlocks.map(async (mcqData) => {
              if (mcqData) {
                try {
                  const validation = validateMCQData(mcqData);
                  if (!validation.isValid) {
                    console.warn(
                      "Invalid MCQ data found during save:",
                      validation.errors
                    );
                  }
                } catch (validationError) {
                  console.error(
                    "Failed to validate MCQ data during save:",
                    validationError
                  );
                }
              }
            });

            // Wait for all validations to complete
            await Promise.all(validationPromises);
          }

          await apiClient.updateAssignment(assignment.id, {
            content: content,
          });

          const updatedAssignment = { ...assignment, content: content };
          onAssignmentUpdated(updatedAssignment);
          setLastSaved(new Date());
        } catch (error: any) {
          console.error("Failed to save assignment content:", error);

          // Provide more specific error messages based on error type
          let errorMessage =
            "Your changes could not be saved. Please try again.";
          let errorTitle = "Failed to save";

          if (error.name === "ApiError") {
            switch (error.statusCode) {
              case 400:
                errorTitle = "Invalid Content";
                errorMessage =
                  "The assignment content contains invalid data. Please check your questions and try again.";
                break;
              case 401:
                errorTitle = "Session Expired";
                errorMessage =
                  "Your session has expired. Please sign in again.";
                break;
              case 403:
                errorTitle = "Permission Denied";
                errorMessage =
                  "You don't have permission to edit this assignment.";
                break;
              case 413:
                errorTitle = "Content Too Large";
                errorMessage =
                  "The assignment content is too large. Please reduce the content size.";
                break;
              case 500:
                errorTitle = "Server Error";
                errorMessage =
                  "A server error occurred. Please try again in a few moments.";
                break;
              default:
                errorMessage = error.message || errorMessage;
            }
          } else if (error.message?.includes("Network error")) {
            errorTitle = "Connection Error";
            errorMessage =
              "Unable to connect to the server. Please check your internet connection.";
          } else if (error.message?.includes("timeout")) {
            errorTitle = "Request Timeout";
            errorMessage = "The save request timed out. Please try again.";
          }

          toast({
            title: errorTitle,
            description: errorMessage,
            variant: "destructive",
          });
        } finally {
          setIsSaving(false);
        }
      }, 2000);
    },
    [assignment, onAssignmentUpdated, toast]
  );

  useEffect(() => {
    if (editor && assignment.content) {
      const currentContent = JSON.stringify(editor.getJSON());
      if (assignment.content !== currentContent) {
        measureRenderTime(() => {
          try {
            // Try to parse as JSON first (new format)
            const parsedContent = JSON.parse(assignment.content);
            editor.commands.setContent(parsedContent);
          } catch (error) {
            // Fallback to HTML format (legacy support)
            editor.commands.setContent(assignment.content);
          }

          // Count MCQ blocks for performance monitoring
          const mcqBlocks = (assignment.content || "").match(
            /data-type="mcq-block"/g
          );
          updateMCQCount(mcqBlocks?.length || 0);
        });
      }
    }
  }, [assignment.content, editor, measureRenderTime, updateMCQCount]);

  // Cleanup effect for proper resource management
  useEffect(() => {
    return () => {
      // Clear all timeouts on unmount
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      if (blockHoverTimeoutRef.current) {
        clearTimeout(blockHoverTimeoutRef.current);
      }
      if (mouseMoveThrottleRef.current) {
        clearTimeout(mouseMoveThrottleRef.current);
      }

      // Destroy editor instance if it exists
      if (editorRef.current && !editorRef.current.isDestroyed) {
        try {
          editorRef.current.destroy();
        } catch (error) {
          console.warn("Error destroying editor instance:", error);
        }
      }
    };
  }, []);

  const handleSlashCommand = useCallback(
    (command: SlashCommandItem) => {
      if (!editor) return;

      // Remove the slash and any query text
      const { from, to } = editor.state.selection;
      const text = editor.state.doc.textBetween(from - 10, to, " ");
      const slashIndex = text.lastIndexOf("/");

      if (slashIndex !== -1) {
        const deleteFrom = from - (text.length - slashIndex);
        editor.chain().focus().deleteRange({ from: deleteFrom, to }).run();
      }

      // Execute the command
      command.command(editor);
      setShowSlashMenu(false);
    },
    [editor]
  );

  if (!editor) {
    return null;
  }

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* Save status and performance info - floating */}
      {!isReadOnly && (
        <div className="absolute top-4 right-4 z-10 space-y-2">
          <div className="bg-white/90 backdrop-blur-sm rounded-lg px-3 py-1 text-sm text-gray-500 shadow-sm border">
            {isSaving ? (
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-purple-600 mr-2"></div>
                Saving...
              </div>
            ) : lastSaved ? (
              <span>Saved {formatTimeAgo(lastSaved)}</span>
            ) : (
              <span>Start typing...</span>
            )}
          </div>

          {/* Performance optimization notice */}
          {shouldOptimize && (
            <div className="bg-yellow-50/90 backdrop-blur-sm rounded-lg px-3 py-1 text-xs text-yellow-700 shadow-sm border border-yellow-200">
              <div className="flex items-center">
                <span className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></span>
                Large assignment detected - optimizations active
              </div>
            </div>
          )}
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-8 relative">
          <div
            className="relative editor-container group"
            onMouseMove={(e) => {
              if (!isReadOnly) {
                // Throttle mouse move events for better performance with many MCQ blocks
                const now = Date.now();
                if (now - lastMouseMoveTime.current < 16) return; // ~60fps throttling
                lastMouseMoveTime.current = now;

                if (mouseMoveThrottleRef.current) {
                  clearTimeout(mouseMoveThrottleRef.current);
                }

                mouseMoveThrottleRef.current = setTimeout(() => {
                  const target = e.target as HTMLElement;
                  const block = target.closest(
                    ".ProseMirror > *"
                  ) as HTMLElement;
                  if (block && block !== hoveredBlock) {
                    setHoveredBlock(block);
                  }
                }, 16);
              }
            }}
            onMouseLeave={(e) => {
              // Only hide if we're not hovering over the controls
              const relatedTarget = e.relatedTarget as HTMLElement;
              if (
                !relatedTarget ||
                (typeof relatedTarget.closest === "function" &&
                  !relatedTarget.closest(".block-controls") &&
                  typeof relatedTarget.matches === "function" &&
                  !relatedTarget.matches(".block-controls"))
              ) {
                // Clear existing timeout
                if (blockHoverTimeoutRef.current) {
                  clearTimeout(blockHoverTimeoutRef.current);
                }
                // Add a small delay to prevent flickering
                blockHoverTimeoutRef.current = setTimeout(() => {
                  setHoveredBlock(null);
                }, 100);
              }
            }}
          >
            <EditorContent
              editor={editor}
              className="assignment-editor-content prose prose-lg max-w-none focus:outline-none min-h-[500px]"
              aria-describedby="editor-help"
            />

            {/* Screen reader help text */}
            <div id="editor-help" className="sr-only">
              Rich text editor for assignment content. Type forward slash (/) to
              open command menu for inserting blocks like headings, lists, and
              multiple choice questions. Use Tab to navigate between interactive
              elements. Press Escape to close menus. Use arrow keys to navigate
              through slash commands. Press Enter to select a command.
            </div>

            {/* Block Controls - Plus and Drag Handle */}
            {!isReadOnly && hoveredBlock && (
              <BlockControls
                block={hoveredBlock}
                onAddBlock={() => {
                  // Find the end of the current block
                  const pos = editor.view.posAtDOM(
                    hoveredBlock,
                    hoveredBlock.childNodes.length
                  );

                  // Insert a new paragraph after the current block
                  editor
                    .chain()
                    .focus()
                    .setTextSelection(pos)
                    .insertContent("<p></p>")
                    .run();

                  // Insert the slash and position cursor after it
                  setTimeout(() => {
                    editor.chain().focus().insertContent("/").run();
                  }, 10);
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Slash Command Menu with accessibility improvements */}
      {!isReadOnly && showSlashMenu && (
        <div
          className="fixed z-50 bg-white rounded-lg shadow-lg border border-gray-200 py-2 min-w-[280px] max-h-[400px] overflow-y-auto"
          style={{
            left: slashMenuPosition.x,
            top: slashMenuPosition.y + 5,
          }}
          role="menu"
          aria-label="Insert block menu"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowSlashMenu(false);
              editor?.commands.focus();
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const nextButton = (e.target as HTMLElement)
                .nextElementSibling as HTMLButtonElement;
              nextButton?.focus();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              const prevButton = (e.target as HTMLElement)
                .previousElementSibling as HTMLButtonElement;
              prevButton?.focus();
            }
          }}
        >
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command, index) => (
              <button
                key={command.title}
                className="w-full px-4 py-2 text-left hover:bg-gray-50 focus:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-inset flex items-center space-x-3 transition-colors"
                onClick={() => handleSlashCommand(command)}
                role="menuitem"
                tabIndex={index === 0 ? 0 : -1}
                aria-describedby={`command-desc-${index}`}
              >
                <div
                  className="flex-shrink-0 w-8 h-8 rounded-md bg-gray-100 flex items-center justify-center"
                  aria-hidden="true"
                >
                  {command.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900">
                    {command.title}
                  </div>
                  <div
                    id={`command-desc-${index}`}
                    className="text-xs text-gray-500 truncate"
                  >
                    {command.description}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="px-4 py-2 text-sm text-gray-500" role="status">
              No matching commands
            </div>
          )}
        </div>
      )}

      {/* Floating Toolbar for Text Selection with accessibility improvements */}
      {!isReadOnly && showFloatingToolbar && (
        <div
          className="fixed z-50 bg-white text-gray-700 rounded-lg shadow-lg border border-gray-200 flex items-center divide-x divide-gray-200"
          style={{
            left: floatingToolbarPosition.x,
            top: floatingToolbarPosition.y - 30,
            transform: "translateX(-50%)",
          }}
          role="toolbar"
          aria-label="Text formatting toolbar"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setShowFloatingToolbar(false);
              editor?.commands.focus();
            }
          }}
        >
          <div
            className="flex items-center px-1"
            role="group"
            aria-label="Text style"
          >
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-2 rounded hover:bg-gray-100 focus:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
                editor.isActive("bold") ? "bg-purple-100 text-purple-700" : ""
              }`}
              title="Bold (Ctrl+B)"
              aria-label="Bold"
              aria-pressed={editor.isActive("bold")}
            >
              <Bold className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-2 rounded hover:bg-gray-100 focus:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
                editor.isActive("italic") ? "bg-purple-100 text-purple-700" : ""
              }`}
              title="Italic (Ctrl+I)"
              aria-label="Italic"
              aria-pressed={editor.isActive("italic")}
            >
              <Italic className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`p-2 rounded hover:bg-gray-100 focus:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
                editor.isActive("underline")
                  ? "bg-purple-100 text-purple-700"
                  : ""
              }`}
              title="Underline (Ctrl+U)"
              aria-label="Underline"
              aria-pressed={editor.isActive("underline")}
            >
              <UnderlineIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={`p-2 rounded hover:bg-gray-100 focus:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
                editor.isActive("strike") ? "bg-purple-100 text-purple-700" : ""
              }`}
              title="Strikethrough"
              aria-label="Strikethrough"
              aria-pressed={editor.isActive("strike")}
            >
              <Strikethrough className="w-4 h-4" />
            </button>
          </div>
          <div
            className="flex items-center px-1"
            role="group"
            aria-label="Links and code"
          >
            <button
              onClick={() => {
                const url = window.prompt("Enter URL:");
                if (url) {
                  editor.chain().focus().setLink({ href: url }).run();
                }
              }}
              className={`p-2 rounded hover:bg-gray-100 focus:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
                editor.isActive("link") ? "bg-purple-100 text-purple-700" : ""
              }`}
              title="Add Link (Ctrl+K)"
              aria-label="Add Link"
              aria-pressed={editor.isActive("link")}
            >
              <LinkIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={`p-2 rounded hover:bg-gray-100 focus:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-purple-500 transition-colors ${
                editor.isActive("code") ? "bg-purple-100 text-purple-700" : ""
              }`}
              title="Inline Code"
              aria-label="Inline Code"
              aria-pressed={editor.isActive("code")}
            >
              <Code className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// Utility functions
function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) {
    return "just now";
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
  } else {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours > 1 ? "s" : ""} ago`;
  }
}

export default AssignmentEditor;
