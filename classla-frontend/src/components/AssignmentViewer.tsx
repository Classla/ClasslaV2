import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
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
import Underline from "@tiptap/extension-underline";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Assignment } from "../types";
import { MCQBlockViewer } from "./extensions/MCQBlockViewer";
import { validateMCQData, sanitizeMCQData } from "./extensions/MCQBlock";
import { Button } from "./ui/button";

interface AssignmentViewerProps {
  assignment: Assignment;
  onAnswerChange?: (blockId: string, answer: any) => void;
}

// Answer state management for MCQ blocks
interface AnswerState {
  [blockId: string]: {
    selectedOptions: string[];
    timestamp: Date;
  };
}

// Session storage key for answer persistence
const getAnswerStorageKey = (assignmentId: string) =>
  `assignment_answers_${assignmentId}`;

const AssignmentViewer: React.FC<AssignmentViewerProps> = ({
  assignment,
  onAnswerChange,
}) => {
  const [answerState, setAnswerState] = useState<AnswerState>({});
  const [contentError, setContentError] = useState<string | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);

  // Performance optimization: Use refs to avoid unnecessary re-renders
  const editorRef = useRef<any>(null);
  const answerStateRef = useRef<AnswerState>({});

  // Load answer state from session storage on component mount
  useEffect(() => {
    const storageKey = getAnswerStorageKey(assignment.id.toString());
    const savedAnswers = sessionStorage.getItem(storageKey);

    if (savedAnswers) {
      try {
        const parsedAnswers = JSON.parse(savedAnswers);
        // Convert timestamp strings back to Date objects
        const restoredAnswers: AnswerState = {};
        Object.keys(parsedAnswers).forEach((blockId) => {
          restoredAnswers[blockId] = {
            ...parsedAnswers[blockId],
            timestamp: new Date(parsedAnswers[blockId].timestamp),
          };
        });
        setAnswerState(restoredAnswers);
      } catch (error) {
        console.error("Failed to load saved answers:", error);
      }
    }
  }, [assignment.id]);

  // Save answer state to session storage whenever it changes
  const saveAnswerState = useCallback(
    (newAnswerState: AnswerState) => {
      const storageKey = getAnswerStorageKey(assignment.id.toString());
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(newAnswerState));
      } catch (error) {
        console.error("Failed to save answers to session storage:", error);
        // Fallback: try to clear some space and retry
        try {
          // Clear old answer data for other assignments
          const keysToRemove: string[] = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (
              key &&
              key.startsWith("assignment_answers_") &&
              key !== storageKey
            ) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach((key) => sessionStorage.removeItem(key));

          // Retry saving
          sessionStorage.setItem(storageKey, JSON.stringify(newAnswerState));
        } catch (retryError) {
          console.error(
            "Failed to save answers even after cleanup:",
            retryError
          );
          // Continue without saving - answers will be lost on page refresh
        }
      }
    },
    [assignment.id]
  );

  const handleMCQAnswerChange = useCallback(
    (blockId: string, selectedOptions: string[]) => {
      try {
        // Validate the blockId and selectedOptions
        if (!blockId || typeof blockId !== "string") {
          console.error(
            "Invalid blockId provided to handleMCQAnswerChange:",
            blockId
          );
          return;
        }

        if (!Array.isArray(selectedOptions)) {
          console.error(
            "Invalid selectedOptions provided to handleMCQAnswerChange:",
            selectedOptions
          );
          return;
        }

        const newAnswerState = {
          ...answerState,
          [blockId]: {
            selectedOptions: selectedOptions.filter(
              (opt) => typeof opt === "string"
            ), // Ensure all options are strings
            timestamp: new Date(),
          },
        };

        setAnswerState(newAnswerState);
        saveAnswerState(newAnswerState);
        onAnswerChange?.(blockId, selectedOptions);
      } catch (error) {
        console.error("Error handling MCQ answer change:", error);
        // Continue without updating state to prevent crashes
      }
    },
    [answerState, saveAnswerState, onAnswerChange]
  );

  // Function to get answer state for a specific block - optimized with ref
  const getBlockAnswerState = useCallback((blockId: string) => {
    return (
      answerStateRef.current[blockId] || {
        selectedOptions: [],
        timestamp: new Date(),
      }
    );
  }, []);

  // Update ref when answerState changes
  useEffect(() => {
    answerStateRef.current = answerState;
  }, [answerState]);

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
            return "Assignment content will appear here...";
          }
          return "Assignment content will appear here...";
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
      Underline,
      MCQBlockViewer, // Add MCQ viewer extension
    ],
    []
  );

  const editor = useEditor({
    extensions: editorExtensions,
    content: "", // Start with empty content, we'll set it properly in useEffect
    editable: false, // Read-only mode
    onCreate: ({ editor }) => {
      // Store the answer change callback and state getter in the editor's storage
      (editor.storage as any).mcqAnswerCallback = handleMCQAnswerChange;
      (editor.storage as any).getBlockAnswerState = getBlockAnswerState;
    },
    // No onUpdate handler since this is read-only
    // No onSelectionUpdate handler since we don't need editing features
  });

  // Store editor reference for cleanup
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor]);

  // Optimized content validation and setting with better error handling
  useEffect(() => {
    if (editor) {
      if (!assignment.content) {
        editor.commands.setContent("");
        setContentError(null);
        return;
      }
      try {
        // Try to parse as JSON first (new format), fallback to HTML (legacy support)
        try {
          const parsedContent = JSON.parse(assignment.content);
          editor.commands.setContent(parsedContent);
          setContentError(null);
        } catch (jsonError) {
          // Handle HTML content with MCQ validation
          if (assignment.content.includes('data-type="mcq-block"')) {
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = assignment.content;
            const mcqBlocks = tempDiv.querySelectorAll(
              '[data-type="mcq-block"]'
            );

            let hasErrors = false;
            let recoveredContent = assignment.content;

            // Batch process MCQ blocks for better performance
            const processedBlocks = Array.from(mcqBlocks).map((block) => {
              const mcqDataAttr = block.getAttribute("data-mcq");
              if (mcqDataAttr) {
                try {
                  const mcqData = JSON.parse(mcqDataAttr);
                  const validation = validateMCQData(mcqData);
                  if (!validation.isValid) {
                    console.warn(
                      "Invalid MCQ data found in content:",
                      validation.errors
                    );
                    hasErrors = true;

                    // Attempt to sanitize the data
                    const sanitizedData = sanitizeMCQData(mcqData);
                    block.setAttribute(
                      "data-mcq",
                      JSON.stringify(sanitizedData)
                    );
                    return { block, success: true };
                  }
                  return { block, success: true };
                } catch (parseError) {
                  console.error(
                    "Failed to parse MCQ data in content:",
                    parseError
                  );
                  hasErrors = true;

                  // Create error replacement
                  const errorDiv = document.createElement("div");
                  errorDiv.className =
                    "p-4 bg-red-50 border border-red-200 rounded-md my-4";
                  errorDiv.innerHTML = `
                    <div class="flex items-center gap-2 text-red-800">
                      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
                      </svg>
                      <span class="font-medium">Question data corrupted</span>
                    </div>
                    <p class="text-sm text-red-700 mt-1">This question contains invalid data and cannot be displayed properly.</p>
                  `;
                  return { block, errorDiv, success: false };
                }
              }
              return { block, success: true };
            });

            // Apply error replacements
            processedBlocks.forEach(({ block, errorDiv, success }) => {
              if (!success && errorDiv) {
                block.parentNode?.replaceChild(errorDiv, block);
              }
            });

            if (hasErrors) {
              recoveredContent = tempDiv.innerHTML;
              setContentError(
                "Some questions had invalid data and were recovered or removed."
              );
            } else {
              setContentError(null);
            }

            editor.commands.setContent(recoveredContent);
          } else {
            // No MCQ blocks, set content directly
            editor.commands.setContent(assignment.content);
            setContentError(null);
          }
        }
      } catch (error) {
        console.error("Failed to set assignment content:", error);
        setContentError(
          "Failed to load assignment content. The content may be corrupted."
        );
        editor.commands.setContent(`
          <div class="p-4 bg-red-50 border border-red-200 rounded-md my-4" role="alert">
            <div class="flex items-center gap-2 text-red-800">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
              </svg>
              <span class="font-medium">Content Error</span>
            </div>
            <p class="text-sm text-red-700 mt-1">The assignment content could not be loaded properly. Please contact your instructor.</p>
          </div>
        `);
      }
    }
  }, [assignment.content, editor]);

  // Update editor storage when callbacks change
  useEffect(() => {
    if (editor) {
      (editor.storage as any).mcqAnswerCallback = handleMCQAnswerChange;
      (editor.storage as any).getBlockAnswerState = getBlockAnswerState;
    }
  }, [editor, handleMCQAnswerChange, getBlockAnswerState]);

  // Cleanup effect for proper resource management
  useEffect(() => {
    return () => {
      // Destroy editor instance if it exists
      if (editorRef.current && !editorRef.current.isDestroyed) {
        try {
          editorRef.current.destroy();
        } catch (error) {
          console.warn("Error destroying viewer editor instance:", error);
        }
      }
    };
  }, []);

  if (!editor) {
    return null;
  }

  const handleRecoverContent = useCallback(async () => {
    setIsRecovering(true);
    try {
      // Attempt to reload the assignment content
      window.location.reload();
    } catch (error) {
      console.error("Failed to recover content:", error);
    } finally {
      setIsRecovering(false);
    }
  }, []);

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* Content Error Banner */}
      {contentError && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              <div>
                <p className="text-sm font-medium text-yellow-800">
                  Content Recovery
                </p>
                <p className="text-sm text-yellow-700">{contentError}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecoverContent}
              disabled={isRecovering}
              className="border-yellow-300 text-yellow-700 hover:bg-yellow-100"
            >
              {isRecovering ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Reloading...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reload Page
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Editor Content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-4xl mx-auto p-8 relative">
          <div className="relative editor-container">
            <EditorContent
              editor={editor}
              className="prose prose-lg max-w-none focus:outline-none min-h-[500px] [&_.ProseMirror]:cursor-default [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ml-8 [&_ol]:ml-8 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:pl-2"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AssignmentViewer;
