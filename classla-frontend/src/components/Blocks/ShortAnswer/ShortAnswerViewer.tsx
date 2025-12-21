import React, { useCallback, useState, useEffect, memo, useMemo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  ShortAnswerData,
  validateShortAnswerData,
  sanitizeShortAnswerData,
} from "../../extensions/ShortAnswerBlock";
import { AlertTriangle, Save, Send } from "lucide-react";
import { Button } from "../../ui/button";

interface ShortAnswerViewerProps {
  node: any;
  editor: any;
  onAnswerChange?: (blockId: string, answer: string) => void;
}

interface BlockAnswerState {
  answer: string;
  timestamp: Date;
}

const ShortAnswerViewer: React.FC<ShortAnswerViewerProps> = memo(
  ({ node, editor, onAnswerChange }) => {
    const rawShortAnswerData = node.attrs.shortAnswerData as ShortAnswerData;
    const [answer, setAnswer] = useState<string>("");
    const [wordCount, setWordCount] = useState<number>(0);
    const [hasDataError, setHasDataError] = useState(false);
    const [isSubmitted, setIsSubmitted] = useState(false);
    const [shortAnswerData, setShortAnswerData] =
      useState<ShortAnswerData>(rawShortAnswerData);

    useEffect(() => {
      const validation = validateShortAnswerData(rawShortAnswerData, true);
      if (!validation.isValid) {
        console.warn(
          "Invalid Short Answer data in viewer, sanitizing:",
          validation.errors
        );
        const sanitizedData = sanitizeShortAnswerData(rawShortAnswerData);
        setShortAnswerData(sanitizedData);
        setHasDataError(true);
      } else {
        setShortAnswerData(rawShortAnswerData);
        setHasDataError(false);
      }
    }, [rawShortAnswerData]);

    useEffect(() => {
      const getBlockAnswerState = (editor?.storage as any)?.getBlockAnswerState;

      if (getBlockAnswerState && shortAnswerData.id) {
        const blockState: BlockAnswerState = getBlockAnswerState(
          shortAnswerData.id
        );
        if (blockState) {
          setAnswer(blockState.answer || "");
        }
      }
    }, [editor, shortAnswerData.id]);

    useEffect(() => {
      const words = answer.trim().split(/\s+/).filter((w) => w.length > 0);
      setWordCount(words.length);
    }, [answer]);

    const handleAnswerChange = useCallback(
      (newAnswer: string) => {
        setAnswer(newAnswer);
        const callback =
          (editor?.storage as any)?.shortAnswerCallback || onAnswerChange;
        callback?.(shortAnswerData.id, newAnswer);

        // Auto-save to editor storage
        const setBlockAnswerState = (editor?.storage as any)
          ?.setBlockAnswerState;
        if (setBlockAnswerState && shortAnswerData.id) {
          setBlockAnswerState(shortAnswerData.id, {
            answer: newAnswer,
            timestamp: new Date(),
          });
        }
      },
      [shortAnswerData.id, onAnswerChange, editor]
    );

    const handleSaveDraft = useCallback(() => {
      const setBlockAnswerState = (editor?.storage as any)?.setBlockAnswerState;
      if (setBlockAnswerState && shortAnswerData.id) {
        setBlockAnswerState(shortAnswerData.id, {
          answer,
          timestamp: new Date(),
        });
      }
    }, [shortAnswerData.id, answer, editor]);

    const handleSubmit = useCallback(() => {
      setIsSubmitted(true);
      handleSaveDraft();
    }, [handleSaveDraft]);

    const isReadOnly = (editor?.storage as any)?.isReadOnly;
    const minWords = shortAnswerData.minWords;
    const maxWords = shortAnswerData.maxWords;
    const wordCountValid =
      (!minWords || wordCount >= minWords) &&
      (!maxWords || wordCount <= maxWords);

    return (
      <NodeViewWrapper
        className="short-answer-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div
          className={`short-answer-viewer border border-gray-200 rounded-lg p-3 bg-white shadow-sm transition-all duration-300 select-none ${
            answer.trim() ? "border-blue-300 shadow-md" : ""
          }`}
          role="group"
          aria-label="Short answer question"
          style={{ cursor: "default" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  hasDataError
                    ? "bg-red-100 text-red-600"
                    : answer.trim()
                    ? "bg-gradient-to-br from-orange-500 to-red-600 text-white shadow-sm"
                    : "bg-gradient-to-br from-orange-500 to-red-600 text-white shadow-sm opacity-70"
                }`}
              >
                {hasDataError ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <span className="text-sm font-bold">A</span>
                )}
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-gray-900">
                  Short Answer Question
                </div>
                <div className="text-xs text-gray-500">
                  {isSubmitted ? "Submitted" : "Type your answer"}
                </div>
              </div>
              {isSubmitted && (
                <span className="text-xs text-green-600 bg-green-50 px-2 py-1 rounded-full font-medium border border-green-200 select-none">
                  Submitted
                </span>
              )}
            </div>
          </div>

          <div className="mb-3">
            <div className="text-sm font-medium text-gray-700 mb-1 block select-none">
              Prompt
            </div>
            <div
              className="text-base font-medium text-gray-900 leading-relaxed select-text"
              dangerouslySetInnerHTML={{
                __html: shortAnswerData.prompt || "Prompt not available",
              }}
            />
          </div>

          <div className="mb-3">
            <textarea
              value={answer}
              onChange={(e) => handleAnswerChange(e.target.value)}
              disabled={isReadOnly || isSubmitted}
              placeholder="Type your answer here..."
              className={`w-full p-3 border rounded-md resize-y min-h-[120px] ${
                isReadOnly || isSubmitted
                  ? "opacity-50 cursor-not-allowed"
                  : "border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
              } ${!wordCountValid ? "border-yellow-500" : ""}`}
            />
            <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
              <span>
                {wordCount} word{wordCount !== 1 ? "s" : ""}
                {minWords && ` (min: ${minWords})`}
                {maxWords && ` (max: ${maxWords})`}
              </span>
              {!wordCountValid && (
                <span className="text-yellow-600">
                  Word count requirement not met
                </span>
              )}
            </div>
          </div>

          {!isReadOnly && !isSubmitted && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handleSaveDraft}>
                <Save className="w-4 h-4 mr-1" />
                Save Draft
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleSubmit}
                disabled={!answer.trim() || !wordCountValid}
              >
                <Send className="w-4 h-4 mr-1" />
                Submit
              </Button>
            </div>
          )}

          {isSubmitted && (
            <div className="mb-3 p-2 bg-green-50 border border-green-200 rounded text-sm text-green-800">
              Answer submitted successfully.
            </div>
          )}

          <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-500 select-none">
            <div className="flex justify-between items-center">
              <span>
                {answer.trim()
                  ? `${wordCount} word${wordCount !== 1 ? "s" : ""}`
                  : "No answer yet"}
              </span>
              <span>{shortAnswerData.points} points</span>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default ShortAnswerViewer;

