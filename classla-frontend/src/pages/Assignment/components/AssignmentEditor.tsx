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

import { apiClient } from "../../../lib/api";
import { MCQBlock, validateMCQData } from "../../../components/extensions/MCQBlock";
import { IDEBlock } from "../../../components/extensions/IDEBlock";
import { FillInTheBlankBlock } from "../../../components/extensions/FillInTheBlankBlock";
import { ShortAnswerBlock } from "../../../components/extensions/ShortAnswerBlock";
import { ParsonsProblemBlock } from "../../../components/extensions/ParsonsProblemBlock";
import { ClickableAreaBlock } from "../../../components/extensions/ClickableAreaBlock";
import { DragDropMatchingBlock } from "../../../components/extensions/DragDropMatchingBlock";
import { TabbedContentBlock } from "../../../components/extensions/TabbedContentBlock";
import { RevealContentBlock } from "../../../components/extensions/RevealContentBlock";
import { PollBlock } from "../../../components/extensions/PollBlock";
import { EmbedBlock } from "../../../components/extensions/EmbedBlock";
import { AlertBlock } from "../../../components/extensions/AlertBlock";
import { ImageBlock } from "../../../components/extensions/ImageBlock";
import { DiscussionBlock } from "../../../components/extensions/DiscussionBlock";
import { generateUUID } from "../../../components/extensions/blockUtils";
import { useToast } from "../../../hooks/use-toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip";
import {
  useAssignmentOptimization,
  usePerformanceMonitoring,
} from "../../../hooks/useVirtualScrolling";
import { Assignment } from "../../../types";
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
  Columns,
  Rows,
  Merge,
  Split,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Eye,
  EyeOff,
  Image as ImageLucideIcon,
  Info,
  AlertTriangle,
  OctagonAlert,
} from "lucide-react";

interface AssignmentEditorProps {
  assignment: Assignment;
  onAssignmentUpdated: (assignment: Assignment) => void;
  isReadOnly?: boolean;
  isPreviewMode?: boolean;
  onTogglePreview?: () => void;
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
  onDragStart: (e: React.MouseEvent, block: HTMLElement) => void;
  isDragging: boolean;
}

interface TableControlsProps {
  table: HTMLElement;
  editor: any;
  onHoverChange: (isHovering: boolean) => void;
}

interface TableContextMenuProps {
  position: { x: number; y: number };
  editor: any;
  onClose: () => void;
}

// Memoize BlockControls to prevent unnecessary re-renders
const BlockControls: React.FC<BlockControlsProps> = memo(
  ({ block, onAddBlock, onDragStart, isDragging }) => {
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

    if (isDragging) return null;

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
          className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          title="Add block below"
          onClick={onAddBlock}
          aria-label="Add block below"
        >
          <Plus className="w-4 h-4" />
        </button>
        <button
          className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          title="Drag to move"
          aria-label="Drag to move block"
          onMouseDown={(e) => onDragStart(e, block)}
        >
          <GripVertical className="w-4 h-4" />
        </button>
      </div>
    );
  }
);

// Drop indicator for drag-to-reorder
const DropIndicator: React.FC<{ top: number }> = memo(({ top }) => {
  if (top < 0) return null;
  return (
    <div
      className="drop-indicator absolute left-0 right-0 z-20 pointer-events-none"
      style={{ top }}
    >
      <div className="h-0.5 bg-purple-500 rounded-full mx-2" />
    </div>
  );
});

// Table Controls Component
const TableControls: React.FC<TableControlsProps> = memo(
  ({ table, editor, onHoverChange }) => {
    // Calculate position immediately to avoid "flying in" effect
    const position = useMemo(() => {
      if (!table) return { top: 0, left: 0 };

      const rect = table.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;

      // Position touching the bottom edge of the table, centered horizontally
      let top = rect.bottom; // Touching the bottom edge
      let left = rect.left + rect.width / 2; // Center horizontally

      // Adjust if popup would go off screen horizontally
      const popupWidth = 350; // Approximate width of controls (reduced since no table section)
      const popupHeight = 50; // Approximate height of controls

      if (left + popupWidth / 2 > viewportWidth - 16) {
        left = viewportWidth - popupWidth / 2 - 16;
      }
      if (left - popupWidth / 2 < 16) {
        left = popupWidth / 2 + 16;
      }

      // If no room below, show above the table
      if (top + popupHeight > viewportHeight - 16) {
        top = rect.top - popupHeight; // Touching the top edge
      }

      return {
        top,
        left: left - popupWidth / 2, // Center the popup
      };
    }, [table]);

    return (
      <TooltipProvider>
        <div
          className="table-controls visible fixed z-50 flex items-center px-4 py-2"
          style={{
            top: position.top,
            left: position.left,
          }}
          onMouseEnter={() => {
            onHoverChange(true);
          }}
          onMouseLeave={() => {
            onHoverChange(false);
          }}
        >
          {/* Small arrow pointing up to connect to table */}
          <div className="absolute -top-1 left-1/2 transform -translate-x-1/2 w-2 h-2 bg-card border-l border-t border-border rotate-45"></div>
          {/* Rows Section */}
          <div className="flex flex-col items-center">
            <div className="text-xs text-muted-foreground mb-1 font-medium">Rows</div>
            <div className="flex items-center space-x-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-2 rounded hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring text-muted-foreground transition-colors"
                    onClick={() => editor.chain().focus().addRowBefore().run()}
                  >
                    <div className="flex items-center">
                      <ArrowUp className="w-3 h-3" />
                      <Plus className="w-3 h-3" />
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add row before</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-2 rounded hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring text-muted-foreground transition-colors"
                    onClick={() => editor.chain().focus().addRowAfter().run()}
                  >
                    <div className="flex items-center">
                      <ArrowDown className="w-3 h-3" />
                      <Plus className="w-3 h-3" />
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add row after</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-950/30 focus:outline-none focus:ring-2 focus:ring-ring text-red-600 transition-colors"
                    onClick={() => editor.chain().focus().deleteRow().run()}
                  >
                    <div className="flex items-center">
                      <Rows className="w-3 h-3" />
                      <Trash2 className="w-3 h-3" />
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Delete row</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div className="w-px h-8 bg-accent mx-3"></div>

          {/* Columns Section */}
          <div className="flex flex-col items-center">
            <div className="text-xs text-muted-foreground mb-1 font-medium">
              Columns
            </div>
            <div className="flex items-center space-x-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-2 rounded hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring text-muted-foreground transition-colors"
                    onClick={() =>
                      editor.chain().focus().addColumnBefore().run()
                    }
                  >
                    <div className="flex items-center">
                      <ArrowLeft className="w-3 h-3" />
                      <Plus className="w-3 h-3" />
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add column before</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-2 rounded hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring text-muted-foreground transition-colors"
                    onClick={() =>
                      editor.chain().focus().addColumnAfter().run()
                    }
                  >
                    <div className="flex items-center">
                      <ArrowRight className="w-3 h-3" />
                      <Plus className="w-3 h-3" />
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Add column after</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="p-2 rounded hover:bg-red-50 dark:hover:bg-red-950/30 focus:outline-none focus:ring-2 focus:ring-ring text-red-600 transition-colors"
                    onClick={() => editor.chain().focus().deleteColumn().run()}
                  >
                    <div className="flex items-center">
                      <Columns className="w-3 h-3" />
                      <Trash2 className="w-3 h-3" />
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Delete column</p>
                </TooltipContent>
              </Tooltip>
            </div>
          </div>
        </div>
      </TooltipProvider>
    );
  }
);

// Table Context Menu Component
const TableContextMenu: React.FC<TableContextMenuProps> = memo(
  ({ position, editor, onClose }) => {
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
        const target = event.target as HTMLElement;
        if (!target.closest(".table-context-menu")) {
          onClose();
        }
      };

      const handleEscape = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          onClose();
        }
      };

      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);

      return () => {
        document.removeEventListener("mousedown", handleClickOutside);
        document.removeEventListener("keydown", handleEscape);
      };
    }, [onClose]);

    const menuItems = [
      {
        label: "Add row above",
        icon: <Rows className="w-4 h-4" />,
        action: () => editor.chain().focus().addRowBefore().run(),
      },
      {
        label: "Add row below",
        icon: <Rows className="w-4 h-4" />,
        action: () => editor.chain().focus().addRowAfter().run(),
      },
      { type: "separator" },
      {
        label: "Add column before",
        icon: <Columns className="w-4 h-4" />,
        action: () => editor.chain().focus().addColumnBefore().run(),
      },
      {
        label: "Add column after",
        icon: <Columns className="w-4 h-4" />,
        action: () => editor.chain().focus().addColumnAfter().run(),
      },
      { type: "separator" },
      {
        label: "Merge cells",
        icon: <Merge className="w-4 h-4" />,
        action: () => editor.chain().focus().mergeCells().run(),
        disabled: !editor.can().mergeCells(),
      },
      {
        label: "Split cell",
        icon: <Split className="w-4 h-4" />,
        action: () => editor.chain().focus().splitCell().run(),
        disabled: !editor.can().splitCell(),
      },
      { type: "separator" },
      {
        label: "Delete row",
        icon: <Minus className="w-4 h-4" />,
        action: () => editor.chain().focus().deleteRow().run(),
        className: "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30",
      },
      {
        label: "Delete column",
        icon: <Minus className="w-4 h-4" />,
        action: () => editor.chain().focus().deleteColumn().run(),
        className: "text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30",
      },
    ];

    return (
      <div
        className="table-context-menu fixed z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[180px]"
        style={{
          left: position.x,
          top: position.y,
        }}
        role="menu"
        aria-label="Table context menu"
      >
        {menuItems.map((item, index) => {
          if (item.type === "separator") {
            return (
              <div key={index} className="border-t border-border my-1" />
            );
          }

          return (
            <button
              key={index}
              className={`w-full px-3 py-2 text-left text-sm flex items-center space-x-2 hover:bg-accent focus:bg-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed ${
                item.className || ""
              }`}
              onClick={() => {
                if (!item.disabled && item.action) {
                  item.action();
                  onClose();
                }
              }}
              disabled={item.disabled}
              role="menuitem"
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    );
  }
);

const AssignmentEditor: React.FC<AssignmentEditorProps> = ({
  assignment,
  onAssignmentUpdated,
  isReadOnly = false,
  isPreviewMode = false,
  onTogglePreview,
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
  const [slashMenuOpensUpward, setSlashMenuOpensUpward] = useState(false);
  const [hoveredBlock, setHoveredBlock] = useState<HTMLElement | null>(null);
  const [showFloatingToolbar, setShowFloatingToolbar] = useState(false);
  const [floatingToolbarPosition, setFloatingToolbarPosition] = useState({
    x: 0,
    y: 0,
  });
  const [hoveredTable, setHoveredTable] = useState<HTMLElement | null>(null);
  const [showTableContextMenu, setShowTableContextMenu] = useState(false);
  const [tableContextMenuPosition, setTableContextMenuPosition] = useState({
    x: 0,
    y: 0,
  });
  const [isHoveringTableControls, setIsHoveringTableControls] = useState(false);

  // Performance optimization: Use refs to avoid unnecessary re-renders
  const editorRef = useRef<any>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const blockHoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const mouseMoveThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const lastMouseMoveTime = useRef<number>(0);

  // Drag-to-reorder state and refs
  const isDraggingRef = useRef(false);
  const dragStartYRef = useRef(0);
  const dragThresholdMetRef = useRef(false);
  const draggedBlockRef = useRef<HTMLElement | null>(null);
  const draggedBlockIndexRef = useRef(-1);
  const dragScrollRAFRef = useRef<number>(0);
  const dragScrollSpeedRef = useRef<number>(0);
  const dragScrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const dragGhostRef = useRef<HTMLDivElement | null>(null);
  const [isDraggingState, setIsDraggingState] = useState(false);
  const [dropIndicatorTop, setDropIndicatorTop] = useState(-1);
  const dropGapIndexRef = useRef(-1);

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
      {
        title: "Fill-in-the-Blank",
        description: "Add a fill-in-the-blank question block.",
        icon: <Type className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().insertContent({
            type: "fillInTheBlankBlock",
            attrs: {
              fillInTheBlankData: {
                id: generateUUID(),
                question: "",
                blanks: [],
                points: 1,
                pointsPerBlank: false,
                attempts: 3,
                showHintAfterAttempts: 1,
                showAnswerAfterAttempts: 3,
                generalFeedback: "",
              },
            },
          }).run();
        },
      },
      {
        title: "Short Answer",
        description: "Add a short answer question block.",
        icon: <Type className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().insertContent({
            type: "shortAnswerBlock",
            attrs: {
              shortAnswerData: {
                id: generateUUID(),
                prompt: "",
                minWords: undefined,
                maxWords: undefined,
                points: 1,
                sampleAnswer: "",
              },
            },
          }).run();
        },
      },
      {
        title: "IDE Block",
        description: "Add a virtual codespace IDE block.",
        icon: <Code className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().insertIDEBlock().run();
        },
      },
      {
        title: "Parsons Problem",
        description: "Add a Parsons problem block for code ordering.",
        icon: <Code className="w-4 h-4" />,
        command: (editor) => {
          // Use direct insertContent - extension should be loaded
          editor.chain().focus().insertContent({
            type: "parsonsProblemBlock",
            attrs: {
              parsonsProblemData: {
                id: generateUUID(),
                instruction: "",
                correctSolution: "",
                blocks: [],
                distractorBlocks: [],
                enableIndentation: true,
                indentSpaces: 4,
                showLineNumbers: true,
                feedbackMode: "immediate",
                points: 1,
              },
            },
          }).run();
        },
      },
      {
        title: "Code Selection",
        description: "Add a code selection block for selecting lines.",
        icon: <Code className="w-4 h-4" />,
        command: (editor) => {
          // Use direct insertContent - extension should be loaded
          editor.chain().focus().insertContent({
            type: "clickableAreaBlock",
            attrs: {
              clickableAreaData: {
                id: generateUUID(),
                instruction: "",
                content: "",
                lines: [],
                showLineNumbers: true,
                allowMultipleAttempts: true,
                showCorrectAfterAttempts: 3,
                points: 1,
                partialCredit: true,
              },
            },
          }).run();
        },
      },
      {
        title: "Drag-and-Drop Matching",
        description: "Add a drag-and-drop matching block.",
        icon: <GripVertical className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().insertContent({
            type: "dragDropMatchingBlock",
            attrs: {
              dragDropMatchingData: {
                id: generateUUID(),
                instruction: "",
                sourceItems: [],
                targetZones: [],
                matchType: "one-to-one",
                randomizeItems: false,
                points: 1,
                partialCredit: true,
              },
            },
          }).run();
        },
      },
      {
        title: "Tabbed Content",
        description: "Add a tabbed content block.",
        icon: <List className="w-4 h-4" />,
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
        title: "Reveal/Collapsible Content",
        description: "Add a reveal/collapsible content block.",
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
        title: "Poll/Survey",
        description: "Add a poll/survey block.",
        icon: <CheckSquare className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().insertContent({
            type: "pollBlock",
            attrs: {
              pollData: {
                id: generateUUID(),
                question: "",
                options: [{ id: generateUUID(), text: "" }],
                selectionType: "single",
                showResults: "after-voting",
                allowAnswerChange: false,
              },
            },
          }).run();
        },
      },
      {
        title: "Embed",
        description: "Add an embed block for videos/iframes.",
        icon: <Code className="w-4 h-4" />,
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
      {
        title: "Info",
        description: "Add an info callout.",
        icon: <Info className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().insertContent({
            type: "alertBlock",
            attrs: {
              alertData: {
                id: generateUUID(),
                alertType: "info",
                title: "",
                content: "",
              },
            },
          }).run();
        },
      },
      {
        title: "Alert",
        description: "Add an alert callout.",
        icon: <OctagonAlert className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().insertContent({
            type: "alertBlock",
            attrs: {
              alertData: {
                id: generateUUID(),
                alertType: "alert",
                title: "",
                content: "",
              },
            },
          }).run();
        },
      },
      {
        title: "Warning",
        description: "Add a warning callout.",
        icon: <AlertTriangle className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().insertContent({
            type: "alertBlock",
            attrs: {
              alertData: {
                id: generateUUID(),
                alertType: "warning",
                title: "",
                content: "",
              },
            },
          }).run();
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
              },
            },
          }).run();
        },
      },
      {
        title: "Discussion/Forum",
        description: "Add a discussion/forum block.",
        icon: <Quote className="w-4 h-4" />,
        command: (editor) => {
          editor.chain().focus().insertContent({
            type: "discussionBlock",
            attrs: {
              discussionData: {
                id: generateUUID(),
                prompt: "",
                allowAnonymous: false,
                requireModeration: false,
                enableReplies: true,
                enableVoting: false,
              },
            },
          }).run();
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
          HTMLAttributes: {
            class: "tiptap-bullet-list",
          },
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false,
          HTMLAttributes: {
            class: "tiptap-ordered-list",
          },
        },
        listItem: {
          HTMLAttributes: {
            class: "tiptap-list-item",
          },
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
      FillInTheBlankBlock,
      ShortAnswerBlock,
      ParsonsProblemBlock,
      ClickableAreaBlock,
      DragDropMatchingBlock,
      TabbedContentBlock,
      RevealContentBlock,
      PollBlock,
      EmbedBlock,
      AlertBlock,
      ImageBlock,
      DiscussionBlock,
      IDEBlock,
    ],
    [assignment.id]
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
    onCreate: ({ editor }) => {
      // Debug: Log all registered extensions
      console.log("[AssignmentEditor] Editor created with extensions:", 
        editor.extensionManager.extensions.map(ext => ext.name).sort()
      );
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

        isSavingRef.current = true;
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

          // Mark this content as the last saved to prevent sync loop
          lastSavedContentRef.current = content;
          
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
          isSavingRef.current = false;
          setIsSaving(false);
        }
      }, 2000);
    },
    [assignment, onAssignmentUpdated, toast]
  );

  // Track if we're currently saving to prevent sync loop
  const isSavingRef = useRef(false);
  const lastSavedContentRef = useRef<string | null>(null);
  const lastAssignmentIdRef = useRef<string | null>(null);

  // Update editor content when assignment changes
  useEffect(() => {
    if (!editor) return;

    // If assignment ID changed, always update the content
    const assignmentIdChanged = lastAssignmentIdRef.current !== assignment.id;
    if (assignmentIdChanged) {
      lastAssignmentIdRef.current = assignment.id;
      lastSavedContentRef.current = null; // Reset saved content ref for new assignment
    }

    if (assignment.content) {
      const currentContent = JSON.stringify(editor.getJSON());
      
      // Sync if:
      // 1. Assignment ID changed (force update)
      // 2. Content actually changed AND we're not currently saving AND it's different from what we just saved
      const shouldSync = assignmentIdChanged || (
        assignment.content !== currentContent &&
        !isSavingRef.current &&
        assignment.content !== lastSavedContentRef.current
      );

      if (shouldSync) {
        measureRenderTime(() => {
          // Temporarily disable the onUpdate handler to prevent save loop
          const wasSaving = isSavingRef.current;
          isSavingRef.current = true;
          
          try {
            // Try to parse as JSON first (new format)
            const parsedContent = JSON.parse(assignment.content);
            editor.commands.setContent(parsedContent);
          } catch (error) {
            // Fallback to HTML format (legacy support)
            editor.commands.setContent(assignment.content);
          } finally {
            // Restore the saving state after a brief delay
            setTimeout(() => {
              isSavingRef.current = wasSaving;
            }, 100);
          }

          // Count MCQ blocks for performance monitoring
          const mcqBlocks = (assignment.content || "").match(
            /data-type="mcq-block"/g
          );
          updateMCQCount(mcqBlocks?.length || 0);
        });
      }
    }
  }, [assignment.id, assignment.content, editor, measureRenderTime, updateMCQCount]);

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
      if (dragScrollRAFRef.current) {
        cancelAnimationFrame(dragScrollRAFRef.current);
      }
      if (dragGhostRef.current) {
        dragGhostRef.current.remove();
        dragGhostRef.current = null;
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

  // --- Drag-to-reorder handlers ---

  const getDraggedBlockIndex = useCallback((block: HTMLElement): number => {
    const proseMirror = block.closest('.ProseMirror');
    if (!proseMirror) return -1;
    const children = Array.from(proseMirror.children);
    return children.indexOf(block);
  }, []);

  const getBlockPositions = useCallback(() => {
    const editorContainer = document.querySelector('.editor-container');
    const proseMirror = editorContainer?.querySelector('.ProseMirror');
    if (!proseMirror || !editorContainer) return [];

    const containerRect = editorContainer.getBoundingClientRect();
    const children = Array.from(proseMirror.children) as HTMLElement[];

    return children.map(child => {
      const rect = child.getBoundingClientRect();
      return {
        top: rect.top - containerRect.top,
        bottom: rect.bottom - containerRect.top,
      };
    });
  }, []);

  const findScrollableAncestor = useCallback((element: HTMLElement | null): HTMLElement | null => {
    let el = element?.parentElement;
    while (el) {
      if (el.scrollHeight > el.clientHeight) {
        const style = window.getComputedStyle(el);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return el;
        }
      }
      el = el.parentElement;
    }
    return null;
  }, []);

  const getBlockTypeName = useCallback((blockIndex: number): string => {
    if (!editor) return 'Block';
    try {
      const node = editor.state.doc.child(blockIndex);
      const typeMap: Record<string, string> = {
        'paragraph': 'Paragraph',
        'bulletList': 'Bullet List',
        'orderedList': 'Numbered List',
        'taskList': 'Task List',
        'blockquote': 'Quote',
        'codeBlock': 'Code Block',
        'horizontalRule': 'Divider',
        'table': 'Table',
        'mcqBlock': 'Multiple Choice',
        'mcq-block': 'Multiple Choice',
        'ideBlock': 'IDE Block',
        'ide-block': 'IDE Block',
        'fillInTheBlankBlock': 'Fill in the Blank',
        'shortAnswerBlock': 'Short Answer',
        'parsonsProblemBlock': 'Parsons Problem',
        'clickableAreaBlock': 'Code Selection',
        'dragDropMatchingBlock': 'Drag & Drop',
        'tabbedContentBlock': 'Tabbed Content',
        'revealContentBlock': 'Reveal Content',
        'pollBlock': 'Poll',
        'embedBlock': 'Embed',
        'imageBlock': 'Image',
        'discussionBlock': 'Discussion',
      };
      if (node.type.name === 'heading') {
        return `Heading ${node.attrs?.level || ''}`;
      }
      return typeMap[node.type.name] || node.type.name;
    } catch {
      return 'Block';
    }
  }, [editor]);

  const executeDragMove = useCallback((fromIndex: number, toGapIndex: number) => {
    if (!editor) return;

    // No-op if dropping at same position
    if (toGapIndex === fromIndex || toGapIndex === fromIndex + 1) return;

    try {
      const json = editor.getJSON();
      if (!json.content || fromIndex < 0 || fromIndex >= json.content.length) return;

      const reordered = [...json.content];
      const [moved] = reordered.splice(fromIndex, 1);
      const insertAt = toGapIndex > fromIndex ? toGapIndex - 1 : toGapIndex;
      reordered.splice(insertAt, 0, moved);

      editor.commands.setContent({ ...json, content: reordered });
    } catch (err) {
      console.error('[DragReorder] Failed to reorder:', err);
    }
  }, [editor]);

  const handleDragStart = useCallback((e: React.MouseEvent, block: HTMLElement) => {
    e.preventDefault();
    e.stopPropagation();

    isDraggingRef.current = true;
    dragStartYRef.current = e.clientY;
    dragThresholdMetRef.current = false;
    draggedBlockRef.current = block;
    draggedBlockIndexRef.current = getDraggedBlockIndex(block);
    dropGapIndexRef.current = -1;

    // Cache the scrollable ancestor for auto-scroll
    dragScrollContainerRef.current = findScrollableAncestor(block) || scrollContainerRef.current;

    // Pre-compute block type name for the ghost
    const blockTypeName = getBlockTypeName(draggedBlockIndexRef.current);

    const handleMove = (moveEvent: MouseEvent) => {
      const deltaY = Math.abs(moveEvent.clientY - dragStartYRef.current);

      if (!dragThresholdMetRef.current) {
        if (deltaY < 5) return;
        dragThresholdMetRef.current = true;
        setIsDraggingState(true);

        // Dim the dragged block
        if (draggedBlockRef.current) {
          draggedBlockRef.current.style.opacity = '0.4';
          draggedBlockRef.current.style.transition = 'opacity 0.15s ease';
        }

        // Create ghost element
        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = blockTypeName;
        ghost.style.left = `${moveEvent.clientX + 14}px`;
        ghost.style.top = `${moveEvent.clientY + 14}px`;
        document.body.appendChild(ghost);
        dragGhostRef.current = ghost;

        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }

      // Position ghost
      if (dragGhostRef.current) {
        dragGhostRef.current.style.left = `${moveEvent.clientX + 14}px`;
        dragGhostRef.current.style.top = `${moveEvent.clientY + 14}px`;
      }

      // Calculate closest gap between blocks
      const positions = getBlockPositions();
      if (positions.length === 0) return;

      const editorContainer = document.querySelector('.editor-container');
      if (!editorContainer) return;
      const containerRect = editorContainer.getBoundingClientRect();
      const mouseRelY = moveEvent.clientY - containerRect.top;

      // Find the closest gap
      let closestGap = 0;
      let closestDist = Infinity;

      for (let i = 0; i <= positions.length; i++) {
        let gapY: number;
        if (i === 0) {
          gapY = positions[0].top;
        } else if (i === positions.length) {
          gapY = positions[positions.length - 1].bottom;
        } else {
          gapY = (positions[i - 1].bottom + positions[i].top) / 2;
        }

        const dist = Math.abs(mouseRelY - gapY);
        if (dist < closestDist) {
          closestDist = dist;
          closestGap = i;
        }
      }

      dropGapIndexRef.current = closestGap;

      // Calculate indicator top position
      let indicatorTop: number;
      if (closestGap === 0) {
        indicatorTop = positions[0].top - 1;
      } else if (closestGap === positions.length) {
        indicatorTop = positions[positions.length - 1].bottom + 1;
      } else {
        indicatorTop = (positions[closestGap - 1].bottom + positions[closestGap].top) / 2;
      }

      // Don't show indicator at same position (no-op drop)
      const dragIdx = draggedBlockIndexRef.current;
      if (closestGap === dragIdx || closestGap === dragIdx + 1) {
        setDropIndicatorTop(-1);
      } else {
        setDropIndicatorTop(indicatorTop);
      }

      // Auto-scroll when near edges — update speed ref, start loop once
      const scrollContainer = dragScrollContainerRef.current;
      if (scrollContainer) {
        const scrollRect = scrollContainer.getBoundingClientRect();
        const edgeZone = 60;
        const maxSpeed = 15;

        if (moveEvent.clientY < scrollRect.top + edgeZone) {
          const proximity = Math.min(1, 1 - (moveEvent.clientY - scrollRect.top) / edgeZone);
          dragScrollSpeedRef.current = -Math.max(1, maxSpeed * proximity);
        } else if (moveEvent.clientY > scrollRect.bottom - edgeZone) {
          const proximity = Math.min(1, 1 - (scrollRect.bottom - moveEvent.clientY) / edgeZone);
          dragScrollSpeedRef.current = Math.max(1, maxSpeed * proximity);
        } else {
          dragScrollSpeedRef.current = 0;
        }

        // Start scroll loop if needed (runs until speed is 0)
        if (dragScrollSpeedRef.current !== 0 && !dragScrollRAFRef.current) {
          const scrollLoop = () => {
            const container = dragScrollContainerRef.current;
            if (container && dragScrollSpeedRef.current !== 0) {
              container.scrollTop += dragScrollSpeedRef.current;
              dragScrollRAFRef.current = requestAnimationFrame(scrollLoop);
            } else {
              dragScrollRAFRef.current = 0;
            }
          };
          dragScrollRAFRef.current = requestAnimationFrame(scrollLoop);
        } else if (dragScrollSpeedRef.current === 0 && dragScrollRAFRef.current) {
          cancelAnimationFrame(dragScrollRAFRef.current);
          dragScrollRAFRef.current = 0;
        }
      }
    };

    const handleEnd = () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleEnd);

      // Cancel auto-scroll
      dragScrollSpeedRef.current = 0;
      if (dragScrollRAFRef.current) {
        cancelAnimationFrame(dragScrollRAFRef.current);
        dragScrollRAFRef.current = 0;
      }

      // Remove ghost
      if (dragGhostRef.current) {
        dragGhostRef.current.remove();
        dragGhostRef.current = null;
      }

      // Restore styles
      document.body.style.userSelect = '';
      document.body.style.cursor = '';

      if (draggedBlockRef.current) {
        draggedBlockRef.current.style.opacity = '';
        draggedBlockRef.current.style.transition = '';
      }

      // Execute move if threshold was met and we have a valid drop target
      if (dragThresholdMetRef.current && dropGapIndexRef.current >= 0) {
        executeDragMove(draggedBlockIndexRef.current, dropGapIndexRef.current);
      }

      // Reset state
      isDraggingRef.current = false;
      dragThresholdMetRef.current = false;
      draggedBlockRef.current = null;
      draggedBlockIndexRef.current = -1;
      dropGapIndexRef.current = -1;
      dragScrollContainerRef.current = null;
      setIsDraggingState(false);
      setDropIndicatorTop(-1);
    };

    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleEnd);
  }, [getDraggedBlockIndex, getBlockTypeName, getBlockPositions, executeDragMove, findScrollableAncestor]);

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
    <div className="h-full flex flex-col bg-muted/50 relative">
      {/* Save status, preview toggle, and performance info - floating */}
      {!isReadOnly && (
        <div className="absolute top-4 right-4 z-10 space-y-2">
          <div className="flex items-center gap-2">
            {/* Student Preview Button */}
            {onTogglePreview && (
              <button
                onClick={onTogglePreview}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-sm font-medium shadow-sm border transition-colors ${
                  isPreviewMode
                    ? "bg-amber-500 text-white border-amber-500 hover:bg-amber-600"
                    : "bg-card/90 backdrop-blur-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
                title={isPreviewMode ? "Exit student preview" : "Preview as student"}
              >
                {isPreviewMode ? (
                  <>
                    <EyeOff className="w-3.5 h-3.5" />
                    <span>Exit Preview</span>
                  </>
                ) : (
                  <>
                    <Eye className="w-3.5 h-3.5" />
                    <span>Student Preview</span>
                  </>
                )}
              </button>
            )}

            {/* Saved Indicator */}
            <div className="bg-card/90 backdrop-blur-sm rounded-lg px-3 py-1 text-sm text-muted-foreground shadow-sm border">
              {isSaving ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-purple-600 mr-2"></div>
                  Saving...
                </div>
              ) : (
                <span>Saved</span>
              )}
            </div>
          </div>

          {/* Performance optimization notice */}
          {shouldOptimize && (
            <div className="bg-yellow-50/90 dark:bg-yellow-950/30 backdrop-blur-sm rounded-lg px-3 py-1 text-xs text-yellow-700 dark:text-yellow-400 shadow-sm border border-yellow-200 dark:border-yellow-800">
              <div className="flex items-center">
                <span className="w-2 h-2 bg-yellow-500 rounded-full mr-2"></span>
                Large assignment detected - optimizations active
              </div>
            </div>
          )}
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-auto" ref={scrollContainerRef}>
        <div className="max-w-4xl mx-auto mt-4 p-8 relative bg-card rounded-t-lg shadow-md border border-border/50 border-b-0 min-h-[calc(100%-1rem)]">
          <div
            className={`relative editor-container group${isDraggingState ? ' is-dragging' : ''}`}
            onMouseMove={(e) => {
              if (!isReadOnly && !isDraggingRef.current) {
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

                  // Check for table hover
                  const table = target.closest("table") as HTMLElement;
                  const tableControls = target.closest(
                    ".table-controls"
                  ) as HTMLElement;

                  if (table && table !== hoveredTable) {
                    setHoveredTable(table);
                  } else if (!table && !tableControls && hoveredTable) {
                    // Add a small delay before hiding to allow moving to controls
                    setTimeout(() => {
                      // Double-check that we're still not hovering over controls
                      if (!isHoveringTableControls) {
                        setHoveredTable(null);
                      }
                    }, 150); // Increased delay for better UX
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
                  !relatedTarget.closest(".table-controls") &&
                  typeof relatedTarget.matches === "function" &&
                  !relatedTarget.matches(".block-controls") &&
                  !relatedTarget.matches(".table-controls"))
              ) {
                // Clear existing timeout
                if (blockHoverTimeoutRef.current) {
                  clearTimeout(blockHoverTimeoutRef.current);
                }
                // Add a small delay to prevent flickering
                blockHoverTimeoutRef.current = setTimeout(() => {
                  setHoveredBlock(null);
                  if (!isHoveringTableControls) {
                    setHoveredTable(null);
                  }
                }, 100);
              }
            }}
            onContextMenu={(e) => {
              if (!isReadOnly) {
                const target = e.target as HTMLElement;
                const tableCell = target.closest("td, th") as HTMLElement;

                if (tableCell) {
                  e.preventDefault();
                  setTableContextMenuPosition({
                    x: e.clientX,
                    y: e.clientY,
                  });
                  setShowTableContextMenu(true);
                  setShowSlashMenu(false);
                  setShowFloatingToolbar(false);
                }
              }
            }}
          >
            <EditorContent
              editor={editor}
              className="assignment-editor-content prose prose-lg max-w-none focus:outline-none min-h-[500px] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ml-8 [&_ol]:ml-8 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:pl-2"
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
            {!isReadOnly && hoveredBlock && !isDraggingState && (
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
                onDragStart={handleDragStart}
                isDragging={isDraggingState}
              />
            )}

            {/* Drop indicator for drag-to-reorder */}
            {isDraggingState && <DropIndicator top={dropIndicatorTop} />}

            {/* Table Controls */}
            {!isReadOnly && hoveredTable && (
              <TableControls
                table={hoveredTable}
                editor={editor}
                onHoverChange={setIsHoveringTableControls}
              />
            )}
          </div>
        </div>
      </div>

      {/* Slash Command Menu with accessibility improvements */}
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
                className="w-full px-4 py-2 text-left hover:bg-accent focus:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset flex items-center space-x-3 transition-colors"
                onClick={() => handleSlashCommand(command)}
                role="menuitem"
                tabIndex={index === 0 ? 0 : -1}
                aria-describedby={`command-desc-${index}`}
              >
                <div
                  className="flex-shrink-0 w-8 h-8 rounded-md bg-muted flex items-center justify-center"
                  aria-hidden="true"
                >
                  {command.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground">
                    {command.title}
                  </div>
                  <div
                    id={`command-desc-${index}`}
                    className="text-xs text-muted-foreground truncate"
                  >
                    {command.description}
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="px-4 py-2 text-sm text-muted-foreground" role="status">
              No matching commands
            </div>
          )}
        </div>
      )}

      {/* Floating Toolbar for Text Selection with accessibility improvements */}
      {!isReadOnly && showFloatingToolbar && (
        <div
          className="fixed z-50 bg-card text-foreground rounded-lg shadow-lg border border-border flex items-center divide-x divide-border"
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
              className={`p-2 rounded hover:bg-accent focus:bg-accent focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                editor.isActive("bold") ? "bg-primary/20 text-primary" : ""
              }`}
              title="Bold (Ctrl+B)"
              aria-label="Bold"
              aria-pressed={editor.isActive("bold")}
            >
              <Bold className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleItalic().run()}
              className={`p-2 rounded hover:bg-accent focus:bg-accent focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                editor.isActive("italic") ? "bg-primary/20 text-primary" : ""
              }`}
              title="Italic (Ctrl+I)"
              aria-label="Italic"
              aria-pressed={editor.isActive("italic")}
            >
              <Italic className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleUnderline().run()}
              className={`p-2 rounded hover:bg-accent focus:bg-accent focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                editor.isActive("underline")
                  ? "bg-primary/20 text-primary"
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
              className={`p-2 rounded hover:bg-accent focus:bg-accent focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                editor.isActive("strike") ? "bg-primary/20 text-primary" : ""
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
              className={`p-2 rounded hover:bg-accent focus:bg-accent focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                editor.isActive("link") ? "bg-primary/20 text-primary" : ""
              }`}
              title="Add Link (Ctrl+K)"
              aria-label="Add Link"
              aria-pressed={editor.isActive("link")}
            >
              <LinkIcon className="w-4 h-4" />
            </button>
            <button
              onClick={() => editor.chain().focus().toggleCode().run()}
              className={`p-2 rounded hover:bg-accent focus:bg-accent focus:outline-none focus:ring-2 focus:ring-ring transition-colors ${
                editor.isActive("code") ? "bg-primary/20 text-primary" : ""
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

      {/* Table Context Menu */}
      {!isReadOnly && showTableContextMenu && (
        <TableContextMenu
          position={tableContextMenuPosition}
          editor={editor}
          onClose={() => setShowTableContextMenu(false)}
        />
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
