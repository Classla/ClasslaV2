import React, { useCallback, useState, useEffect, memo, useMemo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  MCQBlockData,
  validateMCQData,
  sanitizeMCQData,
} from "./extensions/MCQBlock";
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

    // Validate and sanitize MCQ data on mount
    useEffect(() => {
      const validation = validateMCQData(rawMcqData);
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
    useEffect(() => {
      const getBlockAnswerState = (editor?.storage as any)?.getBlockAnswerState;
      if (getBlockAnswerState && mcqData.id) {
        const blockState: BlockAnswerState = getBlockAnswerState(mcqData.id);
        if (blockState.selectedOptions.length > 0) {
          setSelectedOptions(blockState.selectedOptions);
        }
      }
    }, [editor, mcqData.id]);

    const handleOptionSelect = useCallback(
      (optionId: string) => {
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

    return (
      <NodeViewWrapper
        className="mcq-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div
          className={`mcq-viewer border border-gray-200 rounded-lg p-3 bg-white shadow-sm transition-all duration-300 select-none ${
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
                <div className="text-sm font-medium text-gray-900">
                  Multiple Choice Question
                </div>
                <div className="text-xs text-gray-500">
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
            <div className="text-sm font-medium text-gray-700 mb-1 block select-none">
              Question
            </div>
            <div
              className="text-base font-medium text-gray-900 leading-relaxed select-text"
              dangerouslySetInnerHTML={{
                __html: mcqData.question || "Question text not available",
              }}
            />
          </div>

          {/* Options with matching style to MCQEditor */}
          <div className="space-y-1 mb-3">
            <div className="text-sm font-medium text-gray-700 select-none mb-1">
              Answer Options
            </div>
            {mcqData.options.map((option, index) => {
              const isSelected = isOptionSelected(option.id);

              return (
                <div
                  key={option.id}
                  className={`flex items-center gap-2 p-1 border rounded-md transition-all duration-200 cursor-pointer ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 shadow-sm"
                      : "border-gray-200 bg-gray-50 hover:bg-gray-100"
                  } ${isAnswerChanged && isSelected ? "animate-pulse" : ""}`}
                  onClick={() => handleOptionSelect(option.id)}
                  role={mcqData.allowMultiple ? "checkbox" : "radio"}
                  aria-checked={isSelected}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleOptionSelect(option.id);
                    }
                  }}
                  aria-label={`${option.text || `Option ${index + 1}`}${
                    isSelected ? " (selected)" : ""
                  }`}
                >
                  {/* Selection indicator matching MCQEditor style */}
                  <div className="p-1">
                    <div
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 ${
                        isSelected
                          ? "bg-blue-500 border-blue-500 text-white shadow-md scale-110"
                          : "border-gray-300 hover:border-blue-400 hover:bg-blue-50"
                      }`}
                    >
                      {isSelected && <Check className="w-4 h-4" />}
                    </div>
                  </div>

                  {/* Option text with rich text display */}
                  <div className="flex-1 select-text">
                    <div
                      className={`text-sm transition-colors ${
                        isSelected
                          ? "text-blue-900 font-medium"
                          : "text-gray-700"
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
          <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-500 space-y-2 select-none">
            <div className="flex justify-between items-center">
              <span
                className={`transition-colors ${
                  selectedCount > 0
                    ? "text-blue-600 font-medium"
                    : "text-gray-500"
                }`}
                aria-live="polite"
              >
                {selectedCount > 0
                  ? `${selectedCount} selected`
                  : "No selection"}
              </span>
              <span>{mcqData.points} points</span>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default MCQViewer;
