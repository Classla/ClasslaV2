import React, {
  memo,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  ClickableAreaData,
  ClickableAreaLine,
  validateClickableAreaData,
} from "../../extensions/ClickableAreaBlock";
import {
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  CheckSquare,
  Square,
} from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import { Checkbox } from "../../ui/checkbox";
import { useToast } from "../../../hooks/use-toast";

interface ClickableAreaEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const ClickableAreaEditor: React.FC<ClickableAreaEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const clickableAreaData = node.attrs.clickableAreaData as ClickableAreaData;
    const { toast } = useToast();
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [showGradingSetup, setShowGradingSetup] = useState(false);

    // Event handlers to prevent ProseMirror from interfering with inputs
    const handleInputMouseDown = useCallback((e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      // Don't preventDefault for textareas - allows normal cursor positioning
      // Only preventDefault for regular inputs if needed
      if ((e.target as HTMLElement).tagName === "TEXTAREA") {
        // Allow default behavior for textareas so cursor positioning works
        return;
      }
      e.preventDefault(); // Prevent ProseMirror from handling for inputs
      // Manually focus the input after preventing default
      setTimeout(() => {
        (e.target as HTMLInputElement | HTMLTextAreaElement)?.focus();
      }, 0);
    }, []);

    const handleInputClick = useCallback((e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      (e.target as HTMLInputElement | HTMLTextAreaElement)?.focus();
    }, []);

    const handleInputEvent = useCallback((e: React.SyntheticEvent) => {
      e.stopPropagation();
    }, []);

    const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      // Allow default paste behavior for inputs/textareas
    }, []);

    const updateClickableAreaData = useCallback(
      (updates: Partial<ClickableAreaData>) => {
        const newData = { ...clickableAreaData, ...updates };
        const validation = validateClickableAreaData(newData);
        setValidationErrors(validation.errors);
        updateAttributes({ clickableAreaData: newData });
      },
      [clickableAreaData, updateAttributes]
    );

    // Handle Tab key in textareas to insert spaces for indentation
    const handleTextareaKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      e.stopPropagation();
      if (e.key === "Tab") {
        e.preventDefault();
        const textarea = e.target as HTMLTextAreaElement;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const value = textarea.value;
        const indentSpaces = 4; // Default 4 spaces
        const indent = " ".repeat(indentSpaces);

        if (e.shiftKey) {
          // Shift+Tab: unindent
          const lines = value.split("\n");
          let currentLine = 0;
          let charCount = 0;
          let selectionStart = start;
          let selectionEnd = end;

          for (let i = 0; i < lines.length; i++) {
            const lineLength = lines[i].length + 1; // +1 for newline
            if (charCount <= start && start < charCount + lineLength) {
              currentLine = i;
              break;
            }
            charCount += lineLength;
          }

          // Unindent current line
          if (lines[currentLine].startsWith(" ")) {
            const spacesToRemove = Math.min(
              indentSpaces,
              lines[currentLine].match(/^ */)?.[0].length || 0
            );
            lines[currentLine] = lines[currentLine].substring(spacesToRemove);
            if (selectionStart > charCount) {
              selectionStart = Math.max(charCount, selectionStart - spacesToRemove);
            }
            if (selectionEnd > charCount) {
              selectionEnd = Math.max(charCount, selectionEnd - spacesToRemove);
            }
          }

          const newValue = lines.join("\n");
          updateClickableAreaData({ content: newValue });
          setTimeout(() => {
            textarea.setSelectionRange(selectionStart, selectionEnd);
            textarea.focus();
          }, 0);
        } else {
          // Tab: indent
          const lines = value.split("\n");
          let currentLine = 0;
          let charCount = 0;

          for (let i = 0; i < lines.length; i++) {
            const lineLength = lines[i].length + 1;
            if (charCount <= start && start < charCount + lineLength) {
              currentLine = i;
              break;
            }
            charCount += lineLength;
          }

          // Insert indent at cursor position or indent the line
          if (start === end) {
            // Single cursor: insert spaces
            const newValue = value.substring(0, start) + indent + value.substring(end);
            updateClickableAreaData({ content: newValue });
            setTimeout(() => {
              textarea.setSelectionRange(start + indent.length, start + indent.length);
              textarea.focus();
            }, 0);
          } else {
            // Selection: indent the line
            lines[currentLine] = indent + lines[currentLine];
            const newValue = lines.join("\n");
            updateClickableAreaData({ content: newValue });
            setTimeout(() => {
              textarea.setSelectionRange(start + indent.length, end + indent.length);
              textarea.focus();
            }, 0);
          }
        }
      }
    }, [updateClickableAreaData]);

    useEffect(() => {
      const validation = validateClickableAreaData(clickableAreaData);
      setValidationErrors(validation.errors);
    }, [clickableAreaData]);

    // Parse content into lines
    const parseContentIntoLines = useCallback(() => {
      if (!clickableAreaData.content.trim()) {
        toast({
          title: "No content to parse",
          description: "Please enter content first.",
          variant: "destructive",
        });
        return;
      }

      const lines = clickableAreaData.content.split("\n").map((line, index) => ({
        lineNumber: index + 1,
        content: line,
        isCorrect: false,
        isClickable: true,
      }));

      updateClickableAreaData({ lines });
      toast({
        title: "Content parsed",
        description: `Created ${lines.length} lines.`,
      });
    }, [clickableAreaData.content, updateClickableAreaData, toast]);

    const updateLine = useCallback(
      (lineNumber: number, updates: Partial<ClickableAreaLine>) => {
        updateClickableAreaData({
          lines: clickableAreaData.lines.map((line) =>
            line.lineNumber === lineNumber ? { ...line, ...updates } : line
          ),
        });
      },
      [clickableAreaData.lines, updateClickableAreaData]
    );

    const toggleLineClickable = useCallback(
      (lineNumber: number) => {
        const line = clickableAreaData.lines.find(
          (l) => l.lineNumber === lineNumber
        );
        if (line) {
          updateLine(lineNumber, { isClickable: !line.isClickable });
        }
      },
      [clickableAreaData.lines, updateLine]
    );

    const toggleLineCorrect = useCallback(
      (lineNumber: number) => {
        const line = clickableAreaData.lines.find(
          (l) => l.lineNumber === lineNumber
        );
        if (line) {
          updateLine(lineNumber, { isCorrect: !line.isCorrect });
        }
      },
      [clickableAreaData.lines, updateLine]
    );

    const correctCount = useMemo(
      () => clickableAreaData.lines.filter((l) => l.isCorrect).length,
      [clickableAreaData.lines]
    );

    return (
      <NodeViewWrapper
        className="clickable-area-editor-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
        onMouseDown={(e: React.MouseEvent) => {
          // Only stop if not clicking on an input
          const target = e.target as HTMLElement;
          if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.closest("input") && !target.closest("textarea")) {
            e.stopPropagation();
          }
        }}
        onClick={(e: React.MouseEvent) => {
          const target = e.target as HTMLElement;
          if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.closest("input") && !target.closest("textarea")) {
            e.stopPropagation();
          }
        }}
        onPaste={(e: React.ClipboardEvent) => {
          // Only stop if not pasting into an input
          const target = e.target as HTMLElement;
          if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA" && !target.closest("input") && !target.closest("textarea")) {
            e.stopPropagation();
          }
        }}
      >
        <div className="clickable-area-editor border border-border rounded-lg p-3 bg-card shadow-sm select-none">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-purple-500 to-pink-600 text-white shadow-sm">
                <span className="text-sm font-bold">C</span>
              </div>
              <div>
                <div className="text-sm font-medium text-foreground">
                  Code Selection Block
                </div>
                <div className="text-xs text-muted-foreground">
                  Line selection exercise
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteNode}
              className="text-red-600 hover:text-red-700 hover:bg-red-50"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          {validationErrors.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span className="text-sm font-medium text-red-800">
                  Validation Issues
                </span>
              </div>
              <ul className="text-sm text-red-700 space-y-1">
                {validationErrors.map((error, index) => (
                  <li key={index} className="flex items-start gap-1">
                    <span className="text-red-500 mt-0.5">•</span>
                    <span>{error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-3">
            <Label className="text-sm font-medium text-foreground mb-1 block">
              Instruction
            </Label>
            <Input
              value={clickableAreaData.instruction}
              onChange={(e) =>
                updateClickableAreaData({ instruction: e.target.value })
              }
              onMouseDown={handleInputMouseDown}
              onClick={handleInputClick}
              onFocus={handleInputEvent}
              onBlur={handleInputEvent}
              onKeyDown={handleInputEvent}
              onKeyUp={handleInputEvent}
              onKeyPress={handleInputEvent}
              onInput={handleInputEvent}
              onMouseUp={handleInputEvent}
              onMouseMove={handleInputEvent}
              onPaste={handlePaste}
              placeholder="e.g., Click all lines that declare a variable"
              className="w-full"
            />
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-sm font-medium text-foreground">
                Content (Code or Text)
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={parseContentIntoLines}
                className="text-xs"
              >
                Parse into Lines
              </Button>
            </div>
            <Textarea
              value={clickableAreaData.content}
              onChange={(e) =>
                updateClickableAreaData({ content: e.target.value })
              }
              onMouseDown={handleInputMouseDown}
              onClick={handleInputClick}
              onFocus={handleInputEvent}
              onBlur={handleInputEvent}
              onKeyDown={handleTextareaKeyDown}
              onKeyUp={handleInputEvent}
              onKeyPress={handleInputEvent}
              onInput={handleInputEvent}
              onMouseUp={handleInputEvent}
              onMouseMove={handleInputEvent}
              onPaste={handlePaste}
              placeholder="Enter your code or text here... Each line will become clickable. Press Tab to indent."
              className="w-full font-mono text-sm"
              rows={10}
            />
            <div className="text-xs text-muted-foreground mt-1">
              Click "Parse into Lines" to automatically create lines from your content
            </div>
          </div>

          {clickableAreaData.lines.length > 0 && (
            <div className="mb-3">
              <Label className="text-sm font-medium text-foreground mb-2 block">
                Line Configuration ({clickableAreaData.lines.length} lines, {correctCount} correct)
              </Label>
              <div className="space-y-1 max-h-60 overflow-y-auto border border-border rounded p-2">
                {clickableAreaData.lines.map((line) => (
                  <div
                    key={line.lineNumber}
                    className="flex items-center gap-2 p-2 hover:bg-accent rounded"
                  >
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {line.lineNumber}
                    </span>
                    <code className="flex-1 text-sm font-mono bg-background px-2 py-1 rounded border">
                      {line.content || " "}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleLineClickable(line.lineNumber)}
                      className={`h-7 w-7 p-0 ${
                        line.isClickable
                          ? "text-blue-600 hover:text-blue-700"
                          : "text-muted-foreground hover:text-muted-foreground/80"
                      }`}
                      title={line.isClickable ? "Clickable" : "Not clickable"}
                    >
                      {line.isClickable ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => toggleLineCorrect(line.lineNumber)}
                      className={`h-7 w-7 p-0 ${
                        line.isCorrect
                          ? "text-green-600 hover:text-green-700"
                          : "text-muted-foreground hover:text-muted-foreground/80"
                      }`}
                      title={line.isCorrect ? "Correct answer" : "Not correct"}
                      disabled={!line.isClickable}
                    >
                      {line.isCorrect ? (
                        <CheckSquare className="w-4 h-4" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Grading Setup - Collapsible - At Bottom */}
          <div className="mt-4 border border-border rounded-md">
            <button
              type="button"
              onClick={() => setShowGradingSetup(!showGradingSetup)}
              className="w-full flex items-center justify-between p-3 bg-muted hover:bg-accent transition-colors"
            >
              <span className="text-sm font-medium text-foreground">
                Grading Setup
              </span>
              {showGradingSetup ? (
                <ChevronUp className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            {showGradingSetup && (
              <div className="p-3 space-y-3 border-t border-border">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-foreground">Points</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={clickableAreaData.points}
                    onChange={(e) =>
                      updateClickableAreaData({
                        points: parseFloat(e.target.value) || 0,
                      })
                    }
                    onMouseDown={handleInputMouseDown}
                    onClick={handleInputClick}
                    onFocus={handleInputEvent}
                    onBlur={handleInputEvent}
                    onKeyDown={handleInputEvent}
                    onKeyUp={handleInputEvent}
                    onKeyPress={handleInputEvent}
                    onInput={handleInputEvent}
                    onMouseUp={handleInputEvent}
                    onMouseMove={handleInputEvent}
                    onPaste={handlePaste}
                    className="w-24"
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="partialCredit"
                    checked={clickableAreaData.partialCredit}
                    onCheckedChange={(checked) =>
                      updateClickableAreaData({
                        partialCredit: !!checked,
                      })
                    }
                  />
                  <Label htmlFor="partialCredit" className="text-sm">
                    Award partial credit
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="showLineNumbers"
                    checked={clickableAreaData.showLineNumbers}
                    onCheckedChange={(checked) =>
                      updateClickableAreaData({
                        showLineNumbers: !!checked,
                      })
                    }
                  />
                  <Label htmlFor="showLineNumbers" className="text-sm">
                    Show line numbers
                  </Label>
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground select-none">
            <div className="flex justify-between items-center">
              <span>
                {clickableAreaData.lines.length} line
                {clickableAreaData.lines.length !== 1 ? "s" : ""}, {correctCount} correct
              </span>
              <span>{clickableAreaData.points} points</span>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default ClickableAreaEditor;
