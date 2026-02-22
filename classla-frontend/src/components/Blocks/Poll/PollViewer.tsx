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

  // Poll for answer state changes (for submission switching / async loading)
  useEffect(() => {
    if (!editor || !pollData.id) return;

    const checkForUpdates = () => {
      const getBlockAnswerState = (editor.storage as any)?.getBlockAnswerState;
      const currentVersion = (editor.storage as any)?.answerStateVersion;
      const lastVersion = (editor.storage as any)?._lastPollProcessedVersion;

      if (currentVersion && currentVersion !== lastVersion && getBlockAnswerState) {
        const blockState = getBlockAnswerState(pollData.id);
        const newOptions = blockState?.selectedOptions ?? [];
        setSelectedOptions(newOptions);
        if (pollData.showResults === "after-voting" && newOptions.length > 0) {
          setShowResults(true);
        }
        (editor.storage as any)._lastPollProcessedVersion = currentVersion;
      }
    };

    const interval = setInterval(checkForUpdates, 100);
    return () => clearInterval(interval);
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
      <div className="poll-viewer border border-border rounded-lg p-4 bg-card">
        <div
          className="prose max-w-none mb-4"
          dangerouslySetInnerHTML={{ __html: pollData.question }}
        />
        <div className="space-y-2 mb-4">
          {pollData.options.map((option, index) => {
            const isSelected = selectedOptions.includes(option.id);
            return (
              <label
                key={option.id}
                className={`flex items-center gap-2 p-3 rounded border cursor-pointer ${
                  isSelected
                    ? "bg-blue-50 border-blue-400"
                    : "bg-muted border-border hover:bg-accent"
                } ${(editor?.storage as any)?.isReadOnly ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type={pollData.selectionType === "single" ? "radio" : "checkbox"}
                  checked={isSelected}
                  onChange={() => handleOptionToggle(option.id)}
                  disabled={(editor?.storage as any)?.isReadOnly}
                  className="text-blue-600"
                />
                <div
                  className="flex-1 select-text"
                  dangerouslySetInnerHTML={{
                    __html: option.text || `Option ${index + 1}`
                  }}
                />
                {isSelected && (
                  <Check className="w-4 h-4 text-blue-600" />
                )}
              </label>
            );
          })}
        </div>
      </div>
    </NodeViewWrapper>
  );
});

export default PollViewer;

