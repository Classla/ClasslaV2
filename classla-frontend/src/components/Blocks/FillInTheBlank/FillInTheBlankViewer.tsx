import React, {
  useCallback,
  useState,
  useEffect,
  memo,
  useMemo,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  FillInTheBlankData,
  validateFillInTheBlankData,
  sanitizeFillInTheBlankData,
} from "../../extensions/FillInTheBlankBlock";
import { AlertTriangle } from "lucide-react";

interface FillInTheBlankViewerProps {
  node: any;
  editor: any;
  onAnswerChange?: (blockId: string, answers: Record<string, string>) => void;
}

interface BlockAnswerState {
  answers: Record<string, string>;
  attempts: Record<string, number>;
  timestamp: Date;
}


const FillInTheBlankViewer: React.FC<FillInTheBlankViewerProps> = memo(
  ({ node, editor, onAnswerChange }) => {
    const rawFillInTheBlankData = node.attrs
      .fillInTheBlankData as FillInTheBlankData;
    const [answers, setAnswers] = useState<Record<string, string>>({});
    const [isAnswerChanged, setIsAnswerChanged] = useState(false);
    const [hasDataError, setHasDataError] = useState(false);
    const [fillInTheBlankData, setFillInTheBlankData] =
      useState<FillInTheBlankData>(rawFillInTheBlankData);

    // Validate and sanitize data on mount
    useEffect(() => {
      const validation = validateFillInTheBlankData(rawFillInTheBlankData, true);
      if (!validation.isValid) {
        console.warn(
          "Invalid Fill-in-the-Blank data in viewer, sanitizing:",
          validation.errors
        );
        const sanitizedData = sanitizeFillInTheBlankData(rawFillInTheBlankData);
        setFillInTheBlankData(sanitizedData);
        setHasDataError(true);
      } else {
        setFillInTheBlankData(rawFillInTheBlankData);
        setHasDataError(false);
      }
    }, [rawFillInTheBlankData]);

    // Load initial state from editor storage
    useEffect(() => {
      const getBlockAnswerState = (editor?.storage as any)?.getBlockAnswerState;

      if (getBlockAnswerState && fillInTheBlankData.id) {
        const blockState: BlockAnswerState = getBlockAnswerState(
          fillInTheBlankData.id
        );
        if (blockState) {
          setAnswers(blockState.answers || {});
        }
      }
    }, [editor, fillInTheBlankData.id]);

    // Extract blank markers from question (extract text from HTML first)
    const blankMarkers = useMemo(() => {
      const markers: { id: string; index: number }[] = [];
      // Extract text content from HTML
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = fillInTheBlankData.question || "";
      const questionText = tempDiv.textContent || tempDiv.innerText || "";
      
      // Match [BLANK1], [BLANK2], etc. or legacy [BLANK:id]
      const regex = /\[BLANK(\d+)\]|\[BLANK:([^\]]+)\]/g;
      let match;
      while ((match = regex.exec(questionText)) !== null) {
        const id = match[1] ? `blank${match[1]}` : match[2]; // Convert BLANK1 to blank1, or use legacy id
        markers.push({ id, index: match.index });
      }
      return markers;
    }, [fillInTheBlankData.question]);

    // Render question with input fields
    const renderQuestionWithInputs = useCallback(() => {
      // Extract text content from HTML for parsing
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = fillInTheBlankData.question || "";
      const questionText = tempDiv.textContent || tempDiv.innerText || "";
      
      const elements: React.ReactNode[] = [];
      let lastIndex = 0;

      // Sort markers by index
      const sortedMarkers = [...blankMarkers].sort(
        (a, b) => a.index - b.index
      );

      sortedMarkers.forEach((marker, markerIndex) => {
        // Add text before this blank (render as HTML)
        const textBefore = questionText.substring(
          lastIndex,
          marker.index
        );
        if (textBefore) {
          // Find the corresponding HTML segment
          // This is a simplified approach - we'll render the HTML and replace [BLANK] markers
          elements.push(
            <span
              key={`text-${markerIndex}`}
              dangerouslySetInnerHTML={{ 
                __html: textBefore.replace(/\[BLANK:[^\]]+\]/g, '') 
              }}
            />
          );
        }

        // Add input field for blank
        const blankAnswer = answers[marker.id] || "";

        elements.push(
          <span 
            key={`blank-${marker.id}`} 
            className="inline-flex items-center mx-1"
          >
            <input
              type="text"
              value={blankAnswer}
              onChange={(e) => {
                const newAnswers = { ...answers, [marker.id]: e.target.value };
                setAnswers(newAnswers);
                setIsAnswerChanged(true);
                
                // Auto-save to editor storage
                const setBlockAnswerState = (editor?.storage as any)?.setBlockAnswerState;
                if (setBlockAnswerState && fillInTheBlankData.id) {
                  setBlockAnswerState(fillInTheBlankData.id, {
                    answers: newAnswers,
                    timestamp: new Date(),
                  });
                }

                // Notify parent component
                const callback =
                  (editor?.storage as any)?.fillInTheBlankAnswerCallback ||
                  onAnswerChange;
                callback?.(fillInTheBlankData.id, newAnswers);
              }}
              onFocus={(e) => {
                e.stopPropagation();
              }}
              onBlur={(e) => {
                e.stopPropagation();
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
              }}
              onKeyUp={(e) => {
                e.stopPropagation();
              }}
              onMouseDown={(e) => {
                e.stopPropagation();
              }}
              onClick={(e) => {
                e.stopPropagation();
              }}
              disabled={(editor?.storage as any)?.isReadOnly}
              className={`px-2 py-1 border rounded min-w-[100px] text-sm border-border ${
                (editor?.storage as any)?.isReadOnly
                  ? "opacity-50 cursor-not-allowed"
                  : ""
              }`}
              placeholder="___"
            />
          </span>
        );

        lastIndex = marker.index + marker.id.length + 8; // [BLANK: + id + ]
      });

      // Add remaining text
      const remainingText = questionText.substring(lastIndex);
      if (remainingText) {
        elements.push(
          <span
            key="text-end"
            dangerouslySetInnerHTML={{ 
              __html: remainingText.replace(/\[BLANK:[^\]]+\]/g, '') 
            }}
          />
        );
      }

      return elements;
    }, [
      fillInTheBlankData.question,
      blankMarkers,
      answers,
      fillInTheBlankData.id,
      editor,
      onAnswerChange,
    ]);

    // Auto-save answers when they change
    useEffect(() => {
      if (!isAnswerChanged || !fillInTheBlankData.id) return;

      const setBlockAnswerState = (editor?.storage as any)?.setBlockAnswerState;
      if (setBlockAnswerState) {
        setBlockAnswerState(fillInTheBlankData.id, {
          answers,
          timestamp: new Date(),
        });
      }

      setIsAnswerChanged(false);
    }, [answers, fillInTheBlankData.id, editor, isAnswerChanged]);

    const isReadOnly = (editor?.storage as any)?.isReadOnly;
    const totalBlanks = fillInTheBlankData.blanks.length;

    return (
      <NodeViewWrapper
        className="fill-in-the-blank-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div
          className="fill-in-the-blank-viewer border border-border rounded-lg p-3 bg-card shadow-sm select-none"
          role="group"
          aria-label="Fill-in-the-blank question"
          style={{ cursor: "default" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  hasDataError
                    ? "bg-red-100 dark:bg-red-900/40 text-red-600"
                    : "bg-gradient-to-br from-green-500 to-teal-600 text-white shadow-sm opacity-70"
                }`}
              >
                {hasDataError ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <span className="text-sm font-bold">F</span>
                )}
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-foreground">
                  Fill-in-the-Blank Question
                </div>
                <div className="text-xs text-muted-foreground">
                  {totalBlanks} blank{totalBlanks !== 1 ? "s" : ""}
                </div>
              </div>
            </div>
          </div>

          {/* Question with input fields */}
          <div className="mb-3">
            <div className="text-sm font-medium text-foreground mb-2 block select-none">
              Question
            </div>
            <div className="text-base font-medium text-foreground leading-relaxed select-text">
              {renderQuestionWithInputs()}
            </div>
          </div>

          {/* Footer */}
          <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground space-y-2 select-none">
            <div className="flex justify-between items-center">
              <span>Fill in all blanks</span>
              <span>{fillInTheBlankData.points} points</span>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default FillInTheBlankViewer;

