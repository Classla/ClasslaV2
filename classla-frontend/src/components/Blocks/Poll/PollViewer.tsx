import React, { useState, memo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { PollData } from "../../extensions/PollBlock";
import { Button } from "../../ui/button";
import { Check } from "lucide-react";

interface PollViewerProps {
  node: any;
  editor: any;
}

const PollViewer: React.FC<PollViewerProps> = memo(({ node }) => {
  const pollData = node.attrs.pollData as PollData;
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [hasVoted, setHasVoted] = useState(false);
  const [showResults, setShowResults] = useState(
    pollData.showResults === "immediately"
  );

  const handleOptionToggle = (optionId: string) => {
    if (hasVoted && !pollData.allowAnswerChange) return;

    if (pollData.selectionType === "single") {
      setSelectedOptions([optionId]);
    } else {
      setSelectedOptions((prev) =>
        prev.includes(optionId)
          ? prev.filter((id) => id !== optionId)
          : [...prev, optionId]
      );
    }
  };

  const handleSubmit = () => {
    if (selectedOptions.length === 0) return;
    setHasVoted(true);
    if (pollData.showResults === "after-voting") {
      setShowResults(true);
    }
  };

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
                } ${hasVoted && !pollData.allowAnswerChange ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <input
                  type={pollData.selectionType === "single" ? "radio" : "checkbox"}
                  checked={isSelected}
                  onChange={() => handleOptionToggle(option.id)}
                  disabled={hasVoted && !pollData.allowAnswerChange}
                  className="text-blue-600"
                />
                <span className="flex-1">{option.text}</span>
                {showResults && hasVoted && (
                  <span className="text-xs text-gray-500">0%</span>
                )}
              </label>
            );
          })}
        </div>
        {!hasVoted && (
          <Button
            onClick={handleSubmit}
            disabled={selectedOptions.length === 0}
            className="w-full"
          >
            Submit
          </Button>
        )}
        {hasVoted && (
          <div className="text-sm text-green-600 flex items-center gap-2">
            <Check className="w-4 h-4" />
            Thank you for your response!
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
});

export default PollViewer;

