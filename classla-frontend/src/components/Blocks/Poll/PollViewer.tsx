import React, { useState, memo, useEffect, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { PollData } from "../../extensions/PollBlock";
import { Check } from "lucide-react";

interface PollViewerProps {
  node: any;
  editor: any;
  onAnswerChange?: (blockId: string, answer: any) => void;
}

const PollViewer: React.FC<PollViewerProps> = memo(({ node, editor, onAnswerChange }) => {
  const pollData = node.attrs.pollData as PollData;
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [showResults, setShowResults] = useState(
    pollData.showResults === "immediately"
  );

  // Load initial state from editor storage
  useEffect(() => {
    const getBlockAnswerState = (editor?.storage as any)?.getBlockAnswerState;
    if (getBlockAnswerState && pollData.id) {
      const blockState = getBlockAnswerState(pollData.id);
      if (blockState && blockState.selectedOptions) {
        setSelectedOptions(blockState.selectedOptions);
        if (pollData.showResults === "after-voting" && blockState.selectedOptions.length > 0) {
          setShowResults(true);
        }
      }
    }
  }, [editor, pollData.id, pollData.showResults]);

  // Auto-save answer state when it changes
  useEffect(() => {
    if (selectedOptions.length === 0) return;

    const setBlockAnswerState = (editor?.storage as any)?.setBlockAnswerState;
    if (setBlockAnswerState && pollData.id) {
      setBlockAnswerState(pollData.id, {
        selectedOptions,
        timestamp: new Date(),
      });
    }

    // Notify parent component
    const callback =
      (editor?.storage as any)?.pollAnswerCallback || onAnswerChange;
    callback?.(pollData.id, { selectedOptions });

    if (pollData.showResults === "after-voting" && selectedOptions.length > 0) {
      setShowResults(true);
    }
  }, [selectedOptions, pollData.id, pollData.showResults, editor, onAnswerChange]);

  const handleOptionToggle = useCallback((optionId: string) => {
    const isReadOnly = (editor?.storage as any)?.isReadOnly;
    if (isReadOnly) return;

    if (pollData.selectionType === "single") {
      setSelectedOptions([optionId]);
    } else {
      setSelectedOptions((prev) =>
        prev.includes(optionId)
          ? prev.filter((id) => id !== optionId)
          : [...prev, optionId]
      );
    }
  }, [pollData.selectionType, editor]);

  return (
    <NodeViewWrapper
      className="poll-viewer-wrapper"
      as="div"
      draggable={false}
      contentEditable={false}
    >
      <div className="poll-viewer border border-gray-200 rounded-lg p-4 bg-white">
        <div
          className="prose max-w-none mb-4"
          dangerouslySetInnerHTML={{ __html: pollData.question }}
        />
        <div className="space-y-2 mb-4">
          {pollData.options.map((option) => {
            const isSelected = selectedOptions.includes(option.id);
            return (
              <label
                key={option.id}
                className={`flex items-center gap-2 p-3 rounded border cursor-pointer ${
                  isSelected
                    ? "bg-blue-50 border-blue-400"
                    : "bg-gray-50 border-gray-300 hover:bg-gray-100"
                } ${(editor?.storage as any)?.isReadOnly ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type={pollData.selectionType === "single" ? "radio" : "checkbox"}
                  checked={isSelected}
                  onChange={() => handleOptionToggle(option.id)}
                  disabled={(editor?.storage as any)?.isReadOnly}
                  className="text-blue-600"
                />
                <span className="flex-1">{option.text}</span>
                {showResults && selectedOptions.length > 0 && (
                  <span className="text-xs text-gray-500">0%</span>
                )}
              </label>
            );
          })}
        </div>
        {selectedOptions.length > 0 && (
          <div className="text-sm text-green-600 flex items-center gap-2 mt-2">
            <Check className="w-4 h-4" />
            Response saved
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
});

export default PollViewer;

