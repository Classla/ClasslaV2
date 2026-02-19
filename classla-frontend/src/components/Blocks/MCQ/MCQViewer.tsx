import React, { useCallback, useState, useEffect, memo, useMemo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  MCQBlockData,
  validateMCQData,
  sanitizeMCQData,
} from "../../extensions/MCQBlock";
import { Check, AlertTriangle } from "lucide-react";

interface MCQViewerProps {
  node: any;
  editor: any;
  onAnswerChange?: (blockId: string, selectedOptions: string[]) => void;
}

interface BlockAnswerState {
  selectedOptions: string[];
  timestamp: Date;
}

const MCQViewer: React.FC<MCQViewerProps> = memo(
  ({ node, editor, onAnswerChange }) => {
    const rawMcqData = node.attrs.mcqData as MCQBlockData;
    const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
    const [isAnswerChanged, setIsAnswerChanged] = useState(false);
    const [hasDataError, setHasDataError] = useState(false);
    const [mcqData, setMcqData] = useState<MCQBlockData>(rawMcqData);

    // Memoize expensive computations
    const inputType = useMemo(
      () => (mcqData.allowMultiple ? "checkbox" : "radio"),
      [mcqData.allowMultiple]
    );

    const selectedCount = useMemo(
      () => selectedOptions.length,
      [selectedOptions.length]
    );

    // Validate and sanitize MCQ data on mount (student view mode)
    useEffect(() => {
      const validation = validateMCQData(rawMcqData, true);
      if (!validation.isValid) {
        console.warn(
          "Invalid MCQ data in viewer, sanitizing:",
          validation.errors
        );
        const sanitizedData = sanitizeMCQData(rawMcqData);
        setMcqData(sanitizedData);
        setHasDataError(true);
      } else {
        setMcqData(rawMcqData);
        setHasDataError(false);
      }
    }, [rawMcqData]);

    // Load initial state from editor storage (persistent state)
    // Re-load when answerStateVersion changes (for submission switching)
    useEffect(() => {
      const getBlockAnswerState = (editor?.storage as any)?.getBlockAnswerState;

      if (getBlockAnswerState && mcqData.id) {
        const blockState: BlockAnswerState = getBlockAnswerState(mcqData.id);
        console.log("[MCQViewer] Loading answer state for block:", {
          blockId: mcqData.id,
          blockState,
          selectedOptions: blockState?.selectedOptions,
        });
        setSelectedOptions(blockState?.selectedOptions ?? []);
      }
    }, [editor, mcqData.id]);

    // Poll for answer state changes (for submission switching)
    useEffect(() => {
      if (!editor || !mcqData.id) return;

      const checkForUpdates = () => {
        const getBlockAnswerState = (editor.storage as any)
          ?.getBlockAnswerState;
        const currentVersion = (editor.storage as any)?.answerStateVersion;
        const lastVersion = (editor.storage as any)?._lastProcessedVersion;

        if (
          currentVersion &&
          currentVersion !== lastVersion &&
          getBlockAnswerState
        ) {
          const blockState: BlockAnswerState = getBlockAnswerState(mcqData.id);
          console.log("[MCQViewer] Detected answer state change:", {
            blockId: mcqData.id,
            blockState,
            currentVersion,
            lastVersion,
          });
          setSelectedOptions(blockState?.selectedOptions ?? []);
          (editor.storage as any)._lastProcessedVersion = currentVersion;
        }
      };

      const interval = setInterval(checkForUpdates, 100);
      return () => clearInterval(interval);
    }, [editor, mcqData.id]);

    // Watch for block scores updates
    const [blockScoresVersion, setBlockScoresVersion] = useState(0);
    useEffect(() => {
      if (!editor) return;

      const updateHandler = ({ transaction }: any) => {
        if (transaction.getMeta("blockScoresUpdate")) {
          setBlockScoresVersion((v) => v + 1);
        }
      };

      editor.on("transaction", updateHandler);

      return () => {
        editor.off("transaction", updateHandler);
      };
    }, [editor]);

    const handleOptionSelect = useCallback(
      (optionId: string) => {
        // Check if editor is read-only
        const isReadOnly = (editor?.storage as any)?.isReadOnly;
        if (isReadOnly) {
          return; // Don't allow changes when read-only
        }

        let newSelection: string[];

        if (mcqData.allowMultiple) {
          // Multiple choice: toggle the option
          if (selectedOptions.includes(optionId)) {
            newSelection = selectedOptions.filter((id) => id !== optionId);
          } else {
            newSelection = [...selectedOptions, optionId];
          }
        } else {
          // Single choice: select only this option
          newSelection = [optionId];
        }

        setSelectedOptions(newSelection);
        setIsAnswerChanged(true);

        // Provide visual feedback by briefly showing the change
        setTimeout(() => setIsAnswerChanged(false), 300);

        // Try to get the callback from the editor's storage or use the prop
        const callback =
          (editor?.storage as any)?.mcqAnswerCallback || onAnswerChange;
        callback?.(mcqData.id, newSelection);
      },
      [
        mcqData.allowMultiple,
        mcqData.id,
        selectedOptions,
        onAnswerChange,
        editor,
      ]
    );

    const isOptionSelected = useCallback(
      (optionId: string) => selectedOptions.includes(optionId),
      [selectedOptions]
    );

    // Get block score from editor storage (for instructor view)
    // Use blockScoresVersion to trigger re-render when scores change
    const blockScores = useMemo(() => {
      return (editor?.storage as any)?.blockScores || {};
    }, [editor, blockScoresVersion]);

    const blockScore = blockScores[mcqData.id];
    const hasScore = blockScore !== undefined;

    console.log("[MCQViewer] Block scores:", {
      blockId: mcqData.id,
      blockScores,
      blockScore,
      hasScore,
      blockScoresVersion,
    });

    return (
      <NodeViewWrapper
        className="mcq-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div
          className={`mcq-viewer border border-border rounded-lg p-3 bg-card shadow-sm transition-all duration-300 select-none ${
            selectedCount > 0 ? "border-blue-300 shadow-md" : ""
          } ${isAnswerChanged ? "ring-2 ring-blue-200" : ""}`}
          role="group"
          aria-label="Multiple choice question"
          style={{ cursor: "default" }}
        >
          {/* Header with matching style to MCQEditor */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  hasDataError
                    ? "bg-red-100 text-red-600"
                    : selectedOptions.length > 0
                    ? "bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-sm"
                    : "bg-gradient-to-br from-blue-500 to-purple-600 text-white shadow-sm opacity-70"
                }`}
              >
                {hasDataError ? (
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
              {hasDataError && (
                <span className="text-xs text-red-600 bg-red-50 px-2 py-1 rounded-full font-medium border border-red-200 select-none">
                  Data recovered
                </span>
              )}
              {selectedOptions.length > 0 && (
                <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full font-medium border border-blue-200 select-none">
                  Answered
                </span>
              )}
            </div>
          </div>

          {/* Question with rich text display */}
          <div className="mb-3">
            <div className="text-sm font-medium text-foreground mb-1 block select-none">
              Question
            </div>
            <div
              className="rich-text-content text-base font-medium text-foreground leading-relaxed select-text"
              dangerouslySetInnerHTML={{
                __html: mcqData.question || "Question text not available",
              }}
            />
          </div>

          {/* Options with matching style to MCQEditor */}
          <div className="space-y-1 mb-3">
            <div className="text-sm font-medium text-foreground select-none mb-1">
              Answer Options
            </div>
            {mcqData.options.map((option, index) => {
              const isSelected = isOptionSelected(option.id);
              const isReadOnly = (editor?.storage as any)?.isReadOnly;

              return (
                <div
                  key={option.id}
                  className={`flex items-center gap-2 p-1 border rounded-md transition-all duration-200 ${
                    isReadOnly
                      ? "cursor-not-allowed opacity-75"
                      : "cursor-pointer"
                  } ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 shadow-sm"
                      : "border-border bg-muted hover:bg-accent"
                  } ${isAnswerChanged && isSelected ? "animate-pulse" : ""}`}
                  onClick={() => !isReadOnly && handleOptionSelect(option.id)}
                  role={mcqData.allowMultiple ? "checkbox" : "radio"}
                  aria-checked={isSelected}
                  aria-disabled={isReadOnly}
                  tabIndex={isReadOnly ? -1 : 0}
                  onKeyDown={(e) => {
                    if (!isReadOnly && (e.key === "Enter" || e.key === " ")) {
                      e.preventDefault();
                      handleOptionSelect(option.id);
                    }
                  }}
                  aria-label={`${option.text || `Option ${index + 1}`}${
                    isSelected ? " (selected)" : ""
                  }${isReadOnly ? " (locked)" : ""}`}
                >
                  {/* Selection indicator matching MCQEditor style */}
                  <div className="p-1">
                    <div
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                        isSelected
                          ? "bg-blue-500 border-blue-500 text-white shadow-md scale-110"
                          : "border-border hover:border-blue-400 hover:bg-blue-50"
                      }`}
                    >
                      {isSelected && <Check className="w-4 h-4" />}
                    </div>
                  </div>

                  {/* Option text with rich text display */}
                  <div className="flex-1 select-text">
                    <div
                      className={`rich-text-content text-sm transition-colors ${
                        isSelected
                          ? "text-blue-900 font-medium"
                          : "text-foreground"
                      }`}
                      dangerouslySetInnerHTML={{
                        __html: option.text || `Option ${index + 1}`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Footer info matching MCQEditor style */}
          <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground space-y-2 select-none">
            <div className="flex justify-between items-center">
              <span
                className={`transition-colors ${
                  selectedCount > 0
                    ? "text-blue-600 font-medium"
                    : "text-muted-foreground"
                }`}
                aria-live="polite"
              >
                {selectedCount > 0
                  ? `${selectedCount} selected`
                  : "No selection"}
              </span>
              {hasScore ? (
                <span
                  className={`px-3 py-1 rounded-md font-bold text-white ${
                    blockScore.awarded === blockScore.possible
                      ? "bg-green-600"
                      : blockScore.awarded > 0
                      ? "bg-yellow-600"
                      : "bg-red-600"
                  }`}
                >
                  {blockScore.awarded} / {blockScore.possible} pts
                </span>
              ) : (
                <span>{mcqData.points} points</span>
              )}
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default MCQViewer;
