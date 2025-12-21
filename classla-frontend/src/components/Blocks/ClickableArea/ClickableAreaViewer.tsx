import React, { useState, useEffect, memo, useMemo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  ClickableAreaData,
  validateClickableAreaData,
  sanitizeClickableAreaData,
} from "../../extensions/ClickableAreaBlock";
import { AlertTriangle } from "lucide-react";

interface ClickableAreaViewerProps {
  node: any;
  editor: any;
  onAnswerChange?: (blockId: string, selectedLines: number[]) => void;
}

interface BlockAnswerState {
  selectedLines: number[];
  timestamp: Date;
}

const ClickableAreaViewer: React.FC<ClickableAreaViewerProps> = memo(
  ({ node, editor, onAnswerChange }) => {
    const rawClickableAreaData = node.attrs.clickableAreaData as ClickableAreaData;
    const [selectedLines, setSelectedLines] = useState<number[]>([]);
    const [isAnswerChanged, setIsAnswerChanged] = useState(false);
    const [hasDataError, setHasDataError] = useState(false);
    const [clickableAreaData, setClickableAreaData] = useState<ClickableAreaData>(rawClickableAreaData);

    // Validate and sanitize data on mount (student view mode)
    useEffect(() => {
      const validation = validateClickableAreaData(rawClickableAreaData, true);
      if (!validation.isValid) {
        console.warn(
          "Invalid Clickable Area data in viewer, sanitizing:",
          validation.errors
        );
        const sanitizedData = sanitizeClickableAreaData(rawClickableAreaData);
        setClickableAreaData(sanitizedData);
        setHasDataError(true);
      } else {
        setClickableAreaData(rawClickableAreaData);
        setHasDataError(false);
      }
    }, [rawClickableAreaData]);

    // Load initial state from editor storage
    useEffect(() => {
      const getBlockAnswerState = (editor?.storage as any)?.getBlockAnswerState;

      if (getBlockAnswerState && clickableAreaData.id) {
        const blockState: BlockAnswerState = getBlockAnswerState(
          clickableAreaData.id
        );
        if (blockState) {
          setSelectedLines(blockState.selectedLines || []);
        }
      }
    }, [editor, clickableAreaData.id]);

    // Auto-save answer state when it changes
    useEffect(() => {
      if (!isAnswerChanged || !clickableAreaData.id) return;

      const setBlockAnswerState = (editor?.storage as any)?.setBlockAnswerState;
      if (setBlockAnswerState) {
        setBlockAnswerState(clickableAreaData.id, {
          selectedLines,
          timestamp: new Date(),
        });
      }

      // Notify parent component
      const callback =
        (editor?.storage as any)?.clickableAreaAnswerCallback ||
        onAnswerChange;
      callback?.(clickableAreaData.id, selectedLines);

      setIsAnswerChanged(false);
    }, [selectedLines, clickableAreaData.id, editor, onAnswerChange, isAnswerChanged]);

    const handleLineClick = useCallback(
      (lineNumber: number) => {
        if ((editor?.storage as any)?.isReadOnly) return;

        setSelectedLines((prev) => {
          const isSelected = prev.includes(lineNumber);
          let newSelection: number[];

          if (isSelected) {
            newSelection = prev.filter((num) => num !== lineNumber);
          } else {
            newSelection = [...prev, lineNumber].sort((a, b) => a - b);
          }

          setIsAnswerChanged(true);
          return newSelection;
        });
      },
      [editor]
    );

    // Parse content into lines if not already parsed
    const lines = useMemo(() => {
      if (clickableAreaData.lines && clickableAreaData.lines.length > 0) {
        return clickableAreaData.lines;
      }

      // Parse content into lines
      const contentLines = (clickableAreaData.content || "").split("\n");
      return contentLines.map((content, index) => ({
        lineNumber: index + 1,
        content,
        isCorrect: false,
        isClickable: true,
      }));
    }, [clickableAreaData.lines, clickableAreaData.content]);


    return (
      <NodeViewWrapper
        className="clickable-area-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div className="clickable-area-viewer border border-gray-200 rounded-lg p-4 bg-white shadow-sm my-4">
          {hasDataError && (
            <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
              <AlertTriangle className="w-4 h-4 inline mr-1" />
              This block has some configuration issues but is still functional.
            </div>
          )}

          {clickableAreaData.instruction && (
            <div className="mb-3 text-sm text-gray-700">
              {clickableAreaData.instruction}
            </div>
          )}

          <div className="space-y-1 font-mono text-sm">
            {lines.map((line) => {
              const isSelected = selectedLines.includes(line.lineNumber);
              const isReadOnly = (editor?.storage as any)?.isReadOnly;
              const showAnswer = false; // Removed - attempts are handled by outer assignment

              // Determine background color
              const bgColor = isSelected ? "bg-blue-100" : "bg-gray-50";
              const borderColor = isSelected ? "border-blue-400" : "border-transparent";

              return (
                <div
                  key={line.lineNumber}
                  onClick={() => line.isClickable && !isReadOnly && handleLineClick(line.lineNumber)}
                  className={`flex items-start gap-2 p-2 rounded transition-colors ${
                    isReadOnly || !line.isClickable
                      ? "cursor-default"
                      : "cursor-pointer hover:bg-gray-100"
                  } ${bgColor} border-2 ${borderColor}`}
                >
                  {clickableAreaData.showLineNumbers && (
                    <span className="text-gray-500 select-none min-w-[2rem]">
                      {line.lineNumber}
                    </span>
                  )}
                  <span className="flex-1">{line.content || " "}</span>
                  {isSelected && (
                    <span className="text-blue-600">✓</span>
                  )}
                </div>
              );
            })}
          </div>

          {selectedLines.length > 0 && (
            <div className="mt-3 text-xs text-gray-500">
              {selectedLines.length} line{selectedLines.length !== 1 ? "s" : ""} selected
            </div>
          )}

        </div>
      </NodeViewWrapper>
    );
  }
);

ClickableAreaViewer.displayName = "ClickableAreaViewer";

export default ClickableAreaViewer;

