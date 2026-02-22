import React, {
  useCallback,
  useState,
  useEffect,
  memo,
  useMemo,
  useRef,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  MCQBlockData,
  MCQOption,
  validateMCQData,
} from "../../extensions/MCQBlock";
import {
  Plus,
  Trash2,
  GripVertical,
  Settings,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Checkbox } from "../../ui/checkbox";
import { Popover } from "../../ui/popover";
import { useToast } from "../../../hooks/use-toast";
import RichTextEditor from "../../RichTextEditor";
import { getAssignmentIdFromUrl } from "../../extensions/blockUtils";

interface MCQEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

// Utility function to check if HTML content is empty
const isEmptyContent = (html: string): boolean => {
  if (!html || html.trim() === "") return true;
  // Check for empty paragraph tags or just whitespace
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  const textContent = tempDiv.textContent || tempDiv.innerText || "";
  return textContent.trim() === "";
};

const MCQEditor: React.FC<MCQEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const mcqData = node.attrs.mcqData as MCQBlockData;
    const { toast } = useToast();
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [isValidating, setIsValidating] = useState(false);

    // No longer need refs since RichTextEditor handles its own DOM

    // Memoize expensive computations
    const hasCorrectAnswers = useMemo(
      () => mcqData.options.filter((opt) => opt.isCorrect).length,
      [mcqData.options]
    );

    const canRemoveOptions = useMemo(
      () => mcqData.options.length > 2,
      [mcqData.options.length]
    );

    const updateMCQData = useCallback(
      (updates: Partial<MCQBlockData>) => {
        const newData = { ...mcqData, ...updates };

        // Store current selection/cursor position before update
        const activeElement = document.activeElement as
          | HTMLInputElement
          | HTMLTextAreaElement;
        const selectionStart = activeElement?.selectionStart;
        const selectionEnd = activeElement?.selectionEnd;

        // Validate the new data
        setIsValidating(true);
        const validation = validateMCQData(newData);
        setValidationErrors(validation.errors);
        setIsValidating(false);

        // Show validation errors as toast if there are critical issues
        if (
          !validation.isValid &&
          validation.errors.some(
            (error) =>
              error.includes("must have at least") ||
              error.includes("must be an object")
          )
        ) {
          toast({
            title: "Validation Error",
            description: validation.errors[0],
            variant: "destructive",
          });
        }

        updateAttributes({ mcqData: newData });

        // Restore cursor position after React re-render
        requestAnimationFrame(() => {
          if (activeElement && document.body.contains(activeElement)) {
            activeElement.focus();
            if (selectionStart !== undefined && selectionEnd !== undefined) {
              activeElement.setSelectionRange(selectionStart, selectionEnd);
            }
          }
        });
      },
      [mcqData, updateAttributes, toast]
    );

    // Validate on mount and when mcqData changes
    useEffect(() => {
      const validation = validateMCQData(mcqData);
      setValidationErrors(validation.errors);
    }, [mcqData]);

    const updateQuestion = useCallback(
      (question: string) => {
        updateMCQData({ question });
      },
      [updateMCQData]
    );

    const updateOptionText = useCallback(
      (optionId: string, text: string) => {
        updateMCQData({
          options: mcqData.options.map((opt) =>
            opt.id === optionId ? { ...opt, text } : opt
          ),
        });
      },
      [mcqData.options, updateMCQData]
    );

    const addOption = useCallback(() => {
      const newOption: MCQOption = {
        id: `opt-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
        text: "",
        isCorrect: false,
      };
      updateMCQData({
        options: [...mcqData.options, newOption],
      });

      // Focus the new option editor after it's rendered
      setTimeout(() => {
        // Find the last rich text editor and focus it
        const richTextEditors = document.querySelectorAll(
          ".rich-text-editor .ProseMirror"
        );
        const lastEditor = richTextEditors[
          richTextEditors.length - 1
        ] as HTMLElement;
        lastEditor?.focus();
      }, 100);
    }, [mcqData.options, updateMCQData]);

    const removeOption = useCallback(
      (optionId: string) => {
        if (mcqData.options.length <= 2) return; // Minimum 2 options
        updateMCQData({
          options: mcqData.options.filter((opt) => opt.id !== optionId),
        });
      },
      [mcqData.options, updateMCQData]
    );

    const updateOption = useCallback(
      (optionId: string, updates: Partial<MCQOption>) => {
        updateMCQData({
          options: mcqData.options.map((opt) =>
            opt.id === optionId ? { ...opt, ...updates } : opt
          ),
        });
      },
      [mcqData.options, updateMCQData]
    );

    const toggleCorrectAnswer = useCallback(
      (optionId: string) => {
        if (mcqData.allowMultiple) {
          // Multiple choice: toggle the option
          updateOption(optionId, {
            isCorrect: !mcqData.options.find((opt) => opt.id === optionId)
              ?.isCorrect,
          });
        } else {
          // Single choice: set this as the only correct answer
          updateMCQData({
            options: mcqData.options.map((opt) => ({
              ...opt,
              isCorrect: opt.id === optionId,
            })),
          });
        }
      },
      [mcqData.allowMultiple, mcqData.options, updateOption, updateMCQData]
    );

    const moveOption = useCallback(
      (fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex) return;

        const newOptions = [...mcqData.options];
        const [movedOption] = newOptions.splice(fromIndex, 1);
        newOptions.splice(toIndex, 0, movedOption);
        updateMCQData({ options: newOptions });
      },
      [mcqData.options, updateMCQData]
    );

    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    // Handle mouse events to prevent ProseMirror interference while allowing normal text editing
    const handleInputMouseDown = useCallback((e: React.MouseEvent) => {
      // Only stop propagation to prevent ProseMirror from handling the event
      // Don't prevent default to allow normal cursor positioning and text selection
      e.stopPropagation();
    }, []);

    const handleInputEvent = useCallback((e: React.SyntheticEvent) => {
      // Stop propagation for all input-related events to prevent ProseMirror interference
      e.stopPropagation();
    }, []);

    // Keyboard shortcuts
    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent, optionId?: string, optionIndex?: number) => {
        // Add option with Ctrl/Cmd + Enter
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
          e.preventDefault();
          addOption();
          return;
        }

        // Remove option with Ctrl/Cmd + Backspace (only if option is empty)
        if (
          (e.ctrlKey || e.metaKey) &&
          e.key === "Backspace" &&
          optionId &&
          optionIndex !== undefined &&
          canRemoveOptions
        ) {
          const option = mcqData.options.find((opt) => opt.id === optionId);
          if (option && isEmptyContent(option.text)) {
            e.preventDefault();
            removeOption(optionId);
            // Focus previous option or question
            setTimeout(() => {
              const richTextEditors = document.querySelectorAll(
                ".rich-text-editor .ProseMirror"
              );
              if (optionIndex > 0 && richTextEditors[optionIndex]) {
                (richTextEditors[optionIndex] as HTMLElement).focus();
              } else if (richTextEditors[0]) {
                // Focus the question editor (first rich text editor)
                (richTextEditors[0] as HTMLElement).focus();
              }
            }, 10);
          }
        }

        // Toggle correct answer with Ctrl/Cmd + Space
        if ((e.ctrlKey || e.metaKey) && e.key === " " && optionId) {
          e.preventDefault();
          toggleCorrectAnswer(optionId);
        }
      },
      [
        addOption,
        canRemoveOptions,
        mcqData.options,
        removeOption,
        toggleCorrectAnswer,
      ]
    );

    return (
      <NodeViewWrapper
        className="mcq-editor-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div
          className="mcq-editor border border-border rounded-lg p-3 bg-card shadow-sm select-none"
          role="group"
          aria-label="Multiple choice question editor"
          style={{ cursor: "default" }}
          // Allow all events to bubble normally for popover outside click detection
          // ProseMirror interference is handled by the NodeViewWrapper instead
        >
          {/* Header with settings */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  validationErrors.length > 0
                    ? "bg-red-100 dark:bg-red-900/40 text-red-600"
                    : "bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-sm"
                }`}
              >
                {validationErrors.length > 0 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <span className="text-sm font-bold">Q</span>
                )}
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-foreground">
                  Multiple Choice Question
                </div>
                <div className="text-xs text-muted-foreground">
                  {mcqData.allowMultiple
                    ? "Multiple answers allowed"
                    : "Single answer only"}
                </div>
              </div>
              {validationErrors.length > 0 && (
                <span className="text-xs text-red-600 bg-red-50 dark:bg-red-950/30 px-2 py-1 rounded-full font-medium border border-red-200 dark:border-red-800 select-none">
                  {validationErrors.length} error
                  {validationErrors.length > 1 ? "s" : ""}
                </span>
              )}
              {isValidating && (
                <div className="w-4 h-4 animate-spin rounded-full border-2 border-border border-t-blue-600"></div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Popover
                align="right"
                trigger={
                  <Button variant="ghost" size="sm">
                    <Settings className="w-4 h-4" />
                  </Button>
                }
                content={
                  <div className="p-4 space-y-4">
                    <div>
                      <Label htmlFor="points">Points</Label>
                      <Input
                        id="points"
                        type="number"
                        min="0"
                        step="0.5"
                        value={mcqData.points}
                        onChange={(e) =>
                          updateMCQData({
                            points: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="mt-1"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="allowMultiple"
                        checked={mcqData.allowMultiple}
                        onCheckedChange={(checked) =>
                          updateMCQData({ allowMultiple: !!checked })
                        }
                      />
                      <Label htmlFor="allowMultiple">
                        Allow multiple correct answers
                      </Label>
                    </div>
                    <div>
                      <Label htmlFor="explanation">
                        Explanation (optional)
                      </Label>
                      <Input
                        id="explanation"
                        value={mcqData.explanation || ""}
                        onChange={(e) =>
                          updateMCQData({ explanation: e.target.value })
                        }
                        placeholder="Explain the correct answer..."
                        className="mt-1"
                      />
                    </div>
                  </div>
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={deleteNode}
                className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Validation Errors */}
          {validationErrors.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md select-none">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span className="text-sm font-medium text-red-800 dark:text-red-400">
                  Validation Issues
                </span>
              </div>
              <ul className="text-sm text-red-700 dark:text-red-400 space-y-1">
                {validationErrors.map((error, index) => (
                  <li key={index} className="flex items-start gap-1">
                    <span className="text-red-500 mt-0.5">•</span>
                    <span>{error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Question editor */}
          <div className="mb-3">
            <Label className="text-sm font-medium text-foreground mb-1 block select-none">
              Question
            </Label>
            <div className="select-text">
              <RichTextEditor
                content={mcqData.question || ""}
                onChange={updateQuestion}
                placeholder="Enter your question..."
                className={`w-full ${
                  validationErrors.some((error) => error.includes("question"))
                    ? "border-red-300 focus-within:border-red-500 focus-within:ring-red-200"
                    : ""
                }`}
                onKeyDown={handleKeyDown}
                minHeight="32px"
                maxHeight="300px"
                showToolbar={true}
                assignmentId={getAssignmentIdFromUrl() || undefined}
              />
            </div>
          </div>

          {/* Options */}
          <div className="space-y-1 mb-3">
            <Label className="text-sm font-medium text-foreground select-none">
              Answer Options
            </Label>
            {mcqData.options.map((option, index) => (
              <div
                key={option.id}
                className={`flex items-center gap-2 p-1 border rounded-md transition-all duration-200 ${
                  draggedIndex === index
                    ? "opacity-50 bg-blue-50 dark:bg-blue-950/30 border-blue-300"
                    : dragOverIndex === index && draggedIndex !== null
                    ? "bg-blue-50 dark:bg-blue-950/30 border-blue-300 border-dashed"
                    : "border-border bg-muted hover:bg-accent"
                }`}
                draggable={false} // Disable dragging on the option div
                onDragStart={(e) => {
                  // Only allow drag from the drag handle, not from input fields
                  const target = e.target as HTMLElement;
                  if (
                    target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA"
                  ) {
                    e.preventDefault();
                    return;
                  }
                  setDraggedIndex(index);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setDragOverIndex(index);
                }}
                onDragLeave={(e) => {
                  // Only clear if we're leaving the entire option div
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverIndex(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (draggedIndex !== null && draggedIndex !== index) {
                    moveOption(draggedIndex, index);
                  }
                  setDraggedIndex(null);
                  setDragOverIndex(null);
                }}
              >
                {/* Drag handle */}
                <div
                  className="text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing p-1 select-none"
                  title="Drag to reorder"
                  draggable
                  onDragStart={(e) => {
                    setDraggedIndex(index);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                >
                  <GripVertical className="w-4 h-4" />
                </div>

                {/* Correct answer toggle */}
                <button
                  onClick={() => toggleCorrectAnswer(option.id)}
                  className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 ${
                    option.isCorrect
                      ? "bg-green-500 border-green-500 text-white shadow-md scale-110"
                      : "border-border hover:border-green-400 hover:bg-green-50 dark:hover:bg-green-950/30"
                  }`}
                  title={
                    option.isCorrect
                      ? "Correct answer (Ctrl+Space to toggle)"
                      : "Mark as correct (Ctrl+Space to toggle)"
                  }
                  aria-label={`${option.isCorrect ? "Unmark" : "Mark"} option ${
                    index + 1
                  } as correct`}
                  aria-pressed={option.isCorrect}
                >
                  {option.isCorrect && <Check className="w-4 h-4" />}
                </button>

                {/* Option text editor with rich text support */}
                <div className="flex-1 select-text">
                  <RichTextEditor
                    content={option.text || ""}
                    onChange={(text) => updateOptionText(option.id, text)}
                    placeholder={`Option ${index + 1}`}
                    className=""
                    onKeyDown={(e) => handleKeyDown(e, option.id, index)}
                    minHeight="28px"
                    maxHeight="150px"
                    showToolbar={true}
                    assignmentId={getAssignmentIdFromUrl() || undefined}
                  />
                </div>

                {/* Remove option */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeOption(option.id)}
                  disabled={!canRemoveOptions}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                  aria-label={`Remove option ${index + 1}`}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          {/* Add option button */}
          <Button
            variant="outline"
            size="sm"
            onClick={addOption}
            className="w-full focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
            aria-label="Add new answer option"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Option
          </Button>

          {/* Footer info */}
          <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground space-y-2 select-none">
            <div className="flex justify-between items-center">
              <span>
                {hasCorrectAnswers} correct answer
                {hasCorrectAnswers !== 1 ? "s" : ""}
              </span>
              <span>{mcqData.points} points</span>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default MCQEditor;
