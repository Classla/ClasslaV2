import React, {
  memo,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  ParsonsProblemData,
  ParsonsProblemBlock,
  validateParsonsProblemData,
} from "../../extensions/ParsonsProblemBlock";
import { Trash2, AlertTriangle, Plus, X, ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Textarea } from "../../ui/textarea";
import { Checkbox } from "../../ui/checkbox";
import { useToast } from "../../../hooks/use-toast";
import { generateUUID } from "../../extensions/blockUtils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../../ui/tooltip";

interface ParsonsProblemEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const ParsonsProblemEditor: React.FC<ParsonsProblemEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const parsonsProblemData = node.attrs.parsonsProblemData as ParsonsProblemData;
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

    const updateParsonsProblemData = useCallback(
      (updates: Partial<ParsonsProblemData>) => {
        const newData = { ...parsonsProblemData, ...updates };
        const validation = validateParsonsProblemData(newData);
        setValidationErrors(validation.errors);
        updateAttributes({ parsonsProblemData: newData });
      },
      [parsonsProblemData, updateAttributes]
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
        const indentSpaces = parsonsProblemData.indentSpaces || 4;
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
          updateParsonsProblemData({ correctSolution: newValue });
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
            updateParsonsProblemData({ correctSolution: newValue });
            setTimeout(() => {
              textarea.setSelectionRange(start + indent.length, start + indent.length);
              textarea.focus();
            }, 0);
          } else {
            // Selection: indent the line
            lines[currentLine] = indent + lines[currentLine];
            const newValue = lines.join("\n");
            updateParsonsProblemData({ correctSolution: newValue });
            setTimeout(() => {
              textarea.setSelectionRange(start + indent.length, end + indent.length);
              textarea.focus();
            }, 0);
          }
        }
      }
    }, [parsonsProblemData.indentSpaces, updateParsonsProblemData]);

    useEffect(() => {
      const validation = validateParsonsProblemData(parsonsProblemData);
      setValidationErrors(validation.errors);
    }, [parsonsProblemData]);

    // Split code into blocks (one per line)
    const splitCodeIntoBlocks = useCallback(() => {
      if (!parsonsProblemData.correctSolution.trim()) {
        toast({
          title: "No code to split",
          description: "Please enter code in the solution field first.",
          variant: "destructive",
        });
        return;
      }

      // Split by lines but preserve original lines with indentation
      const allLines = parsonsProblemData.correctSolution.split("\n");
      const indentSpaces = parsonsProblemData.indentSpaces || 4;

      const blocks: ParsonsProblemBlock[] = allLines
        .map((originalLine) => {
          // Calculate indentation from original line (before trimming)
          const leadingSpaces = originalLine.match(/^ */)?.[0].length || 0;
          const indentLevel = Math.floor(leadingSpaces / indentSpaces);
          const code = originalLine.trim(); // Trim for the code content

          // Only create block if line has content (after trimming)
          if (code.length === 0) {
            return null;
          }

          return {
            id: generateUUID(),
            code,
            indentLevel: parsonsProblemData.enableIndentation ? indentLevel : 0,
          };
        })
        .filter((block): block is ParsonsProblemBlock => block !== null);

      updateParsonsProblemData({ blocks });
      toast({
        title: "Code split into blocks",
        description: `Created ${blocks.length} blocks from your code.`,
      });
    }, [parsonsProblemData, updateParsonsProblemData, toast]);

    const addDistractor = useCallback(() => {
      const newDistractor = {
        id: generateUUID(),
        code: "",
      };
      updateParsonsProblemData({
        distractorBlocks: [...parsonsProblemData.distractorBlocks, newDistractor],
      });
    }, [parsonsProblemData.distractorBlocks, updateParsonsProblemData]);

    const removeDistractor = useCallback(
      (id: string) => {
        updateParsonsProblemData({
          distractorBlocks: parsonsProblemData.distractorBlocks.filter(
            (d) => d.id !== id
          ),
        });
      },
      [parsonsProblemData.distractorBlocks, updateParsonsProblemData]
    );

    const updateDistractor = useCallback(
      (id: string, code: string) => {
        updateParsonsProblemData({
          distractorBlocks: parsonsProblemData.distractorBlocks.map((d) =>
            d.id === id ? { ...d, code } : d
          ),
        });
      },
      [parsonsProblemData.distractorBlocks, updateParsonsProblemData]
    );

    const updateBlock = useCallback(
      (id: string, updates: Partial<ParsonsProblemBlock>) => {
        updateParsonsProblemData({
          blocks: parsonsProblemData.blocks.map((b) =>
            b.id === id ? { ...b, ...updates } : b
          ),
        });
      },
      [parsonsProblemData.blocks, updateParsonsProblemData]
    );

    const removeBlock = useCallback(
      (id: string) => {
        updateParsonsProblemData({
          blocks: parsonsProblemData.blocks.filter((b) => b.id !== id),
        });
      },
      [parsonsProblemData.blocks, updateParsonsProblemData]
    );

    return (
      <NodeViewWrapper
        className="parsons-problem-editor-wrapper"
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
        <div className="parsons-problem-editor border border-gray-200 rounded-lg p-3 bg-white shadow-sm select-none">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-sm">
                <span className="text-sm font-bold">P</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-gray-900">
                  Parsons Problem Block
                </div>
                <div className="text-xs text-gray-500">
                  Code ordering exercise
                </div>
              </div>
              {validationErrors.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{validationErrors.length} error{validationErrors.length !== 1 ? "s" : ""}</span>
                </div>
              )}
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
            <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
              <ul className="space-y-1">
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
            <Label className="text-sm font-medium text-gray-700 mb-1 block">
              Instruction
            </Label>
            <Input
              value={parsonsProblemData.instruction}
              onChange={(e) =>
                updateParsonsProblemData({ instruction: e.target.value })
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
              placeholder="e.g., Arrange the code blocks in the correct order"
              className="w-full"
            />
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-sm font-medium text-gray-700">
                Correct Solution Code
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={splitCodeIntoBlocks}
                className="text-xs"
              >
                Split into Blocks
              </Button>
            </div>
            <Textarea
              value={parsonsProblemData.correctSolution}
              onChange={(e) =>
                updateParsonsProblemData({ correctSolution: e.target.value })
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
              placeholder="Enter your code here... Each line will become a block. Press Tab to indent."
              className="w-full font-mono text-sm"
              rows={8}
            />
            <div className="text-xs text-gray-500 mt-1">
              Click "Split into Blocks" to automatically create blocks from your code
            </div>
          </div>

          {parsonsProblemData.blocks.length > 0 && (
            <div className="mb-3">
              <Label className="text-sm font-medium text-gray-700 mb-2 block">
                Code Blocks ({parsonsProblemData.blocks.length})
              </Label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {parsonsProblemData.blocks.map((block, index) => (
                  <div
                    key={block.id}
                    className="flex items-center gap-2 p-2 bg-gray-50 border border-gray-200 rounded"
                  >
                    <GripVertical className="w-4 h-4 text-gray-400" />
                    <span className="text-xs text-gray-500 w-8">
                      {index + 1}
                    </span>
                    <code className="flex-1 text-sm font-mono bg-white px-2 py-1 rounded border">
                      {" ".repeat(block.indentLevel * (parsonsProblemData.indentSpaces || 4))}
                      {block.code}
                    </code>
                    {parsonsProblemData.enableIndentation && (
                      <TooltipProvider>
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  updateBlock(block.id, {
                                    indentLevel: Math.max(0, block.indentLevel - 1),
                                  })
                                }
                                className="h-6 w-6 p-0"
                              >
                                ←
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Decrease indentation (outdent)</p>
                            </TooltipContent>
                          </Tooltip>
                          <span className="text-xs text-gray-500 w-8 text-center">
                            {block.indentLevel}
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  updateBlock(block.id, {
                                    indentLevel: block.indentLevel + 1,
                                  })
                                }
                                className="h-6 w-6 p-0"
                              >
                                →
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>Increase indentation</p>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </TooltipProvider>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeBlock(block.id)}
                      className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium text-gray-700">
                Distractor Blocks (Optional)
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={addDistractor}
                className="text-xs"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add Distractor
              </Button>
            </div>
            {parsonsProblemData.distractorBlocks.length > 0 && (
              <div className="space-y-2">
                {parsonsProblemData.distractorBlocks.map((distractor) => (
                  <div
                    key={distractor.id}
                    className="flex items-center gap-2 p-2 bg-yellow-50 border border-yellow-200 rounded"
                  >
                    <Input
                      value={distractor.code}
                      onChange={(e) =>
                        updateDistractor(distractor.id, e.target.value)
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
                      placeholder="Wrong code line..."
                      className="flex-1 font-mono text-sm"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeDistractor(distractor.id)}
                      className="h-8 w-8 p-0 text-red-600 hover:text-red-700"
                    >
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Grading Setup - Collapsible - At Bottom */}
          <div className="mt-4 border border-gray-200 rounded-md">
            <button
              type="button"
              onClick={() => setShowGradingSetup(!showGradingSetup)}
              className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <span className="text-sm font-medium text-gray-700">
                Grading Setup
              </span>
              {showGradingSetup ? (
                <ChevronUp className="w-4 h-4 text-gray-600" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-600" />
              )}
            </button>
            {showGradingSetup && (
              <div className="p-3 space-y-3 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-gray-700">Points</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={parsonsProblemData.points}
                    onChange={(e) =>
                      updateParsonsProblemData({
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
                    id="enableIndentation"
                    checked={parsonsProblemData.enableIndentation}
                    onCheckedChange={(checked) =>
                      updateParsonsProblemData({
                        enableIndentation: !!checked,
                      })
                    }
                  />
                  <Label htmlFor="enableIndentation" className="text-sm">
                    Enable indentation (students must match indentation)
                  </Label>
                </div>
                {parsonsProblemData.enableIndentation && (
                  <div className="flex items-center justify-between">
                    <Label className="text-sm text-gray-700">
                      Spaces per Indent
                    </Label>
                    <Input
                      type="number"
                      min="1"
                      max="8"
                      value={parsonsProblemData.indentSpaces}
                      onChange={(e) =>
                        updateParsonsProblemData({
                          indentSpaces: parseInt(e.target.value) || 4,
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
                )}
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="showLineNumbers"
                    checked={parsonsProblemData.showLineNumbers}
                    onCheckedChange={(checked) =>
                      updateParsonsProblemData({
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

          <div className="mt-4 pt-3 border-t border-gray-200 text-xs text-gray-500 select-none">
            <div className="flex justify-between items-center">
              <span>
                {parsonsProblemData.blocks.length} block
                {parsonsProblemData.blocks.length !== 1 ? "s" : ""}
                {parsonsProblemData.distractorBlocks.length > 0 &&
                  `, ${parsonsProblemData.distractorBlocks.length} distractor${parsonsProblemData.distractorBlocks.length !== 1 ? "s" : ""}`}
              </span>
              <span>{parsonsProblemData.points} points</span>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default ParsonsProblemEditor;
