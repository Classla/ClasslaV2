import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
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

// Non-graded block extensions (editor)
import { ImageBlock } from "../../../components/extensions/ImageBlock";
import { TabbedContentBlock } from "../../../components/extensions/TabbedContentBlock";
import { RevealContentBlock } from "../../../components/extensions/RevealContentBlock";
import { EmbedBlock } from "../../../components/extensions/EmbedBlock";
// Non-graded block extensions (viewer)
import { ImageBlockViewer } from "../../../components/extensions/ImageBlockViewer";
import { TabbedContentBlockViewer } from "../../../components/extensions/TabbedContentBlockViewer";
import { RevealContentBlockViewer } from "../../../components/extensions/RevealContentBlockViewer";
import { EmbedBlockViewer } from "../../../components/extensions/EmbedBlockViewer";

import { generateUUID } from "../../../components/extensions/blockUtils";

import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import { Course } from "../../../types";
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
  Image as ImageLucideIcon,
  ChevronDown,
  Columns,
  Play,
} from "lucide-react";

interface CourseEditorProps {
  course: Course;
  setCourse: (course: Course) => void;
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

const BlockControls: React.FC<BlockControlsProps> = ({ block, onAddBlock }) => {
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
        className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all"
        title="Add block below"
        onClick={onAddBlock}
      >
        <Plus className="w-4 h-4" />
      </button>
      <button
        className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-all"
        title="Drag to move"
      >
        <GripVertical className="w-4 h-4" />
      </button>
    </div>
  );
};

const CourseEditor: React.FC<CourseEditorProps> = ({
  course,
  setCourse,
  isReadOnly = false,
}) => {
  const { toast } = useToast();
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const isSelfSaveRef = useRef(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashMenuPosition, setSlashMenuPosition] = useState({ x: 0, y: 0 });
  const [slashMenuQuery, setSlashMenuQuery] = useState("");
  const [slashMenuOpensUpward, setSlashMenuOpensUpward] = useState(false);
  const [hoveredBlock, setHoveredBlock] = useState<HTMLElement | null>(null);
  const [showFloatingToolbar, setShowFloatingToolbar] = useState(false);
  const [floatingToolbarPosition, setFloatingToolbarPosition] = useState({
    x: 0,
    y: 0,
  });

  const slashCommands: SlashCommandItem[] = [
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
      title: "Image",
      description: "Add an image (supports GIFs).",
      icon: <ImageLucideIcon className="w-4 h-4" />,
      command: (editor) => {
        editor.chain().focus().insertContent({
          type: "imageBlock",
          attrs: {
            imageData: {
              id: generateUUID(),
              s3Key: "",
              assignmentId: "",
              alt: "",
              width: 0,
              alignment: "center",
              courseId: course.id,
            },
          },
        }).run();
      },
    },
    {
      title: "Tabbed Content",
      description: "Add a tabbed content block.",
      icon: <Columns className="w-4 h-4" />,
      command: (editor) => {
        editor.chain().focus().insertContent({
          type: "tabbedContentBlock",
          attrs: {
            tabbedContentData: {
              id: generateUUID(),
              tabs: [],
              tabPosition: "top",
            },
          },
        }).run();
      },
    },
    {
      title: "Reveal/Collapsible",
      description: "Add a collapsible content section.",
      icon: <ChevronDown className="w-4 h-4" />,
      command: (editor) => {
        editor.chain().focus().insertContent({
          type: "revealContentBlock",
          attrs: {
            revealContentData: {
              id: generateUUID(),
              buttonText: "Show Hint",
              content: "",
              initiallyVisible: false,
              showHideButton: true,
              buttonStyle: "default",
            },
          },
        }).run();
      },
    },
    {
      title: "Embed",
      description: "Add a video or iframe embed.",
      icon: <Play className="w-4 h-4" />,
      command: (editor) => {
        editor.chain().focus().insertContent({
          type: "embedBlock",
          attrs: {
            embedData: {
              id: generateUUID(),
              embedType: "iframe",
              url: "",
              allowFullscreen: true,
            },
          },
        }).run();
      },
    },
  ];

  const filteredCommands = slashCommands.filter((command) =>
    command.title.toLowerCase().includes(slashMenuQuery.toLowerCase())
  );

  // Use editor extensions when editable, viewer extensions when read-only
  const blockExtensions = useMemo(() => {
    if (isReadOnly) {
      return [ImageBlockViewer, TabbedContentBlockViewer, RevealContentBlockViewer, EmbedBlockViewer];
    }
    return [ImageBlock, TabbedContentBlock, RevealContentBlock, EmbedBlock];
  }, [isReadOnly]);

  const editor = useEditor({
    extensions: [
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
      ...blockExtensions,
    ],
    content: course.summary_content || "",
    editable: !isReadOnly,
    onUpdate: ({ editor }) => {
      if (!isReadOnly) {
        // Auto-save after 2 seconds of inactivity
        debouncedSave(editor.getHTML());
      }
    },
    onSelectionUpdate: ({ editor }) => {
      if (!isReadOnly) {
        const { from, to } = editor.state.selection;

        // Handle floating toolbar for text selection
        if (from !== to) {
          // Text is selected
          const coords = editor.view.coordsAtPos(from);
          const endCoords = editor.view.coordsAtPos(to);
          const centerX = (coords.left + endCoords.left) / 2;

          setFloatingToolbarPosition({
            x: centerX,
            y: coords.top - 10,
          });
          setShowFloatingToolbar(true);
          setShowSlashMenu(false);
        } else {
          // No text selected
          setShowFloatingToolbar(false);

          // Handle slash command detection
          const text = editor.state.doc.textBetween(from - 10, to, " ");
          const slashIndex = text.lastIndexOf("/");

          if (slashIndex !== -1 && slashIndex === text.length - 1) {
            // Show slash menu
            const coords = editor.view.coordsAtPos(from);
            const viewportHeight = window.innerHeight;
            const menuMaxHeight = 400; // max-h-[400px]
            const spaceBelow = viewportHeight - coords.bottom;
            const spaceAbove = coords.top;
            const opensUpward = spaceBelow < menuMaxHeight && spaceAbove > spaceBelow;
            
            setSlashMenuPosition({ 
              x: coords.left, 
              y: opensUpward ? coords.top : coords.bottom 
            });
            setSlashMenuOpensUpward(opensUpward);
            setSlashMenuQuery("");
            setShowSlashMenu(true);
          } else if (slashIndex !== -1 && slashIndex < text.length - 1) {
            // Update query
            const query = text.slice(slashIndex + 1);
            setSlashMenuQuery(query);
          } else {
            // Hide slash menu
            setShowSlashMenu(false);
          }
        }
      }
    },
  });

  // Debounced save function
  const debouncedSave = React.useCallback(
    debounce(async (content: string) => {
      if (content === course.summary_content) return;

      setIsSaving(true);
      try {
        await apiClient.updateCourse(course.id, {
          summary_content: content,
        });

        isSelfSaveRef.current = true;
        setCourse({ ...course, summary_content: content });
        setLastSaved(new Date());
      } catch (error: any) {
        console.error("Failed to save course content:", error);
        toast({
          title: "Failed to save",
          description: "Your changes could not be saved. Please try again.",
          variant: "destructive",
        });
      } finally {
        setIsSaving(false);
      }
    }, 2000),
    [course, setCourse, toast]
  );

  useEffect(() => {
    if (isSelfSaveRef.current) {
      isSelfSaveRef.current = false;
      return;
    }
    if (editor && course.summary_content !== editor.getHTML()) {
      editor.commands.setContent(course.summary_content || "");
    }
  }, [course.summary_content, editor]);

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
    <div className="h-full flex flex-col relative bg-muted/50">
      {/* Save status - floating */}
      {!isReadOnly && (
        <div className="absolute top-4 right-4 z-10">
          <div className="bg-card/90 backdrop-blur-sm rounded-lg px-3 py-1 text-sm text-muted-foreground shadow-sm border">
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
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto mt-4 p-8 relative bg-card rounded-t-lg shadow-md border border-border/50 border-b-0 min-h-[calc(100%-1rem)]">
          <div
            className="relative editor-container group"
            onMouseMove={(e) => {
              if (!isReadOnly) {
                const target = e.target as HTMLElement;
                const block = target.closest(".ProseMirror > *") as HTMLElement;
                if (block && block !== hoveredBlock) {
                  setHoveredBlock(block);
                }
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
                // Add a small delay to prevent flickering
                setTimeout(() => {
                  setHoveredBlock(null);
                }, 100);
              }
            }}
          >
            <EditorContent
              editor={editor}
              className="prose prose-lg max-w-none focus:outline-none min-h-[500px]"
            />

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

      {/* Slash Command Menu */}
      {!isReadOnly && showSlashMenu && (
        <div
          className="fixed z-50 bg-card rounded-lg shadow-lg border border-border py-2 min-w-[280px] max-h-[400px] overflow-y-auto"
          style={{
            left: slashMenuPosition.x,
            top: slashMenuOpensUpward 
              ? slashMenuPosition.y - 5 
              : slashMenuPosition.y + 5,
            transform: slashMenuOpensUpward ? "translateY(-100%)" : "none",
          }}
        >
          {filteredCommands.length > 0 ? (
            filteredCommands.map((command) => (
              <button
                key={command.title}
                className="w-full px-4 py-2 text-left hover:bg-accent flex items-center space-x-3 transition-colors"
                onClick={() => handleSlashCommand(command)}
              >
                <div className="flex-shrink-0 w-8 h-8 rounded-md bg-muted flex items-center justify-center">
                  {command.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {command.title}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {command.description}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="px-4 py-2 text-sm text-muted-foreground">
              No matching commands
            </div>
          )}
        </div>
      )}

      {/* Floating Toolbar for Text Selection */}
      {!isReadOnly && showFloatingToolbar && (
        <div
          className="fixed z-50 bg-card text-foreground rounded-lg shadow-lg border border-border flex items-center divide-x divide-border"
          style={{
            left: floatingToolbarPosition.x,
            top: floatingToolbarPosition.y - 30,
            transform: "translateX(-50%)",
          }}
        >
          <div className="flex items-center px-1">
            <button
              onClick={() => editor.chain().focus().toggleBold().run()}
              className={`p-2 rounded hover:bg-accent transition-colors ${
                editor.isActive("bold") ? "bg-primary/20 text-primary" : ""
              }`}
              title="Bold"
            >
              <Bold className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-2 rounded hover:bg-accent transition-colors ${
                editor.isActive("italic") ? "bg-primary/20 text-primary" : ""
              }`}
              title="Italic"
            >
              <Italic className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`p-2 rounded hover:bg-accent transition-colors ${
                editor.isActive("underline")
                  ? "bg-primary/20 text-primary"
                  : ""
              }`}
              title="Underline"
            >
              <UnderlineIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleStrike().run()}
              className={`p-2 rounded hover:bg-accent transition-colors ${
                editor.isActive("strike") ? "bg-primary/20 text-primary" : ""
              }`}
              title="Strikethrough"
            >
              <Strikethrough className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center px-1">
            <button
              onClick={() => {
                const url = window.prompt("Enter URL:");
                if (url) {
                  editor.chain().focus().setLink({ href: url }).run();
                }
              }}
              className={`p-2 rounded hover:bg-accent transition-colors ${
                editor.isActive("link") ? "bg-primary/20 text-primary" : ""
              }`}
              title="Add Link"
            >
              <LinkIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={`p-2 rounded hover:bg-accent transition-colors ${
                editor.isActive("code") ? "bg-primary/20 text-primary" : ""
              }`}
              title="Inline Code"
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

export default CourseEditor;
