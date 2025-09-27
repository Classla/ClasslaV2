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
      <NodeViewWrapper className="mcq-viewer-wrapper">
        <div
          className={`mcq-viewer border rounded-lg p-4 my-4 bg-white shadow-sm transition-all duration-300 ${
            selectedCount > 0 ? "border-blue-300 shadow-md" : "border-gray-200"
          } ${isAnswerChanged ? "ring-2 ring-blue-200" : ""}`}
          role="group"
          aria-label="Multiple choice question"
        >
          {/* Header */}
          <div className="flex items-center gap-2 mb-4">
            <div
              className={`w-6 h-6 rounded flex items-center justify-center transition-colors ${
                hasDataError
                  ? "bg-yellow-100 text-yellow-600"
                  : selectedOptions.length > 0
                  ? "bg-blue-500 text-white"
                  : "bg-blue-100 text-blue-600"
              }`}
            >
              {hasDataError ? (
                <AlertTriangle className="w-4 h-4" />
              ) : (
                <span className="text-sm font-medium">Q</span>
              )}
            </div>
            <span className="text-sm font-medium text-gray-700">
              Multiple Choice Question
            </span>
            {hasDataError && (
              <span className="text-xs text-yellow-700 bg-yellow-50 px-2 py-1 rounded font-medium">
                Data recovered
              </span>
            )}
            {mcqData.allowMultiple && (
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                Select all that apply
              </span>
            )}
            {selectedOptions.length > 0 && (
              <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded font-medium">
                Answered
              </span>
            )}
          </div>

          {/* Question */}
          <div className="mb-4">
            <h3
              id="mcq-question"
              className="text-base font-medium text-gray-900 leading-relaxed"
            >
              {mcqData.question || "Question text not available"}
            </h3>
          </div>

          {/* Options */}
          <div
            className="space-y-2 mb-4"
            role="radiogroup"
            aria-labelledby="mcq-question"
          >
            {mcqData.options.map((option, index) => {
              const isSelected = isOptionSelected(option.id);

              return (
                <div
                  key={option.id}
                  className={`flex items-center gap-3 p-3 border rounded-md cursor-pointer transition-all duration-200 hover:bg-gray-50 focus-within:ring-2 focus-within:ring-blue-500 focus-within:ring-offset-2 ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 shadow-sm"
                      : "border-gray-200 hover:border-gray-300"
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
                  {/* Selection indicator */}
                  <div
                    className={`relative flex items-center justify-center transition-colors ${
                      inputType === "checkbox"
                        ? "w-5 h-5 border-2 rounded"
                        : "w-5 h-5 border-2 rounded-full"
                    } ${
                      isSelected
                        ? "bg-blue-500 border-blue-500"
                        : "border-gray-300"
                    }`}
                  >
                    {isSelected && (
                      <>
                        {inputType === "checkbox" ? (
                          <Check className="w-3 h-3 text-white" />
                        ) : (
                          <div className="w-2 h-2 bg-white rounded-full" />
                        )}
                      </>
                    )}
                  </div>

                  {/* Option text */}
                  <label
                    className={`flex-1 text-sm cursor-pointer select-none ${
                      isSelected ? "text-blue-900 font-medium" : "text-gray-700"
                    }`}
                  >
                    {option.text || `Option ${index + 1}`}
                  </label>
                </div>
              );
            })}
          </div>

          {/* Footer info */}
          <div className="pt-3 border-t border-gray-200 text-xs flex justify-between items-center">
            <span
              className={`transition-colors ${
                selectedCount > 0
                  ? "text-blue-600 font-medium"
                  : "text-gray-500"
              }`}
              aria-live="polite"
            >
              {selectedCount > 0 ? `${selectedCount} selected` : "No selection"}
            </span>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">{mcqData.points} points</span>
              {selectedCount > 0 && (
                <div
                  className="w-2 h-2 bg-green-500 rounded-full animate-pulse"
                  aria-hidden="true"
                ></div>
              )}
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default MCQViewer;
