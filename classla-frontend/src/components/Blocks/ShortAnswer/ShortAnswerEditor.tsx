import React, { useCallback, useState, useEffect, memo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  ShortAnswerData,
  validateShortAnswerData,
} from "../../extensions/ShortAnswerBlock";
import { Settings, AlertTriangle, Trash2, ChevronDown, ChevronUp, Plus, X } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Popover } from "../../ui/popover";
import { useToast } from "../../../hooks/use-toast";
import RichTextEditor from "../../RichTextEditor";

interface ShortAnswerEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const ShortAnswerEditor: React.FC<ShortAnswerEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const shortAnswerData = node.attrs.shortAnswerData as ShortAnswerData;
    const { toast } = useToast();
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [showGradingSetup, setShowGradingSetup] = useState(false);

    const updateShortAnswerData = useCallback(
      (updates: Partial<ShortAnswerData>) => {
        const newData = { ...shortAnswerData, ...updates };

        const validation = validateShortAnswerData(newData);
        setValidationErrors(validation.errors);

        if (
          !validation.isValid &&
          validation.errors.some(
            (error) =>
              error.includes("must have") || error.includes("must be")
          )
        ) {
          toast({
            title: "Validation Error",
            description: validation.errors[0],
            variant: "destructive",
          });
        }

        updateAttributes({ shortAnswerData: newData });
      },
      [shortAnswerData, updateAttributes, toast]
    );

    useEffect(() => {
      const validation = validateShortAnswerData(shortAnswerData);
      setValidationErrors(validation.errors);
    }, [shortAnswerData]);

    const updatePrompt = useCallback(
      (prompt: string) => {
        updateShortAnswerData({ prompt });
      },
      [updateShortAnswerData]
    );

    // Event handlers to prevent ProseMirror interference
    const handleInputMouseDown = useCallback(
      (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        e.stopPropagation();
        if ((e.target as HTMLElement).tagName === "TEXTAREA") {
          return;
        }
        e.preventDefault();
        setTimeout(() => {
          (e.target as HTMLInputElement | HTMLTextAreaElement)?.focus();
        }, 0);
      },
      []
    );

    const handleInputClick = useCallback(
      (e: React.MouseEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        e.stopPropagation();
        (e.target as HTMLInputElement | HTMLTextAreaElement)?.focus();
      },
      []
    );

    const handleInputEvent = useCallback((e: React.SyntheticEvent) => {
      e.stopPropagation();
    }, []);

    const handlePaste = useCallback(
      (e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        e.stopPropagation();
      },
      []
    );

    return (
      <NodeViewWrapper
        className="short-answer-editor-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
        onMouseDown={(e: React.MouseEvent) => {
          const target = e.target as HTMLElement;
          if (
            target.tagName !== "INPUT" &&
            target.tagName !== "TEXTAREA" &&
            !target.closest("input") &&
            !target.closest("textarea")
          ) {
            e.stopPropagation();
          }
        }}
        onClick={(e: React.MouseEvent) => {
          const target = e.target as HTMLElement;
          if (
            target.tagName !== "INPUT" &&
            target.tagName !== "TEXTAREA" &&
            !target.closest("input") &&
            !target.closest("textarea")
          ) {
            e.stopPropagation();
          }
        }}
        onPaste={(e: React.ClipboardEvent) => {
          const target = e.target as HTMLElement;
          if (
            target.tagName !== "INPUT" &&
            target.tagName !== "TEXTAREA" &&
            !target.closest("input") &&
            !target.closest("textarea")
          ) {
            e.stopPropagation();
          }
        }}
      >
        <div
          className="short-answer-editor border border-border rounded-lg p-3 bg-card shadow-sm select-none"
          role="group"
          aria-label="Short answer question editor"
          style={{ cursor: "default" }}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  validationErrors.length > 0
                    ? "bg-red-100 dark:bg-red-900/40 text-red-600"
                    : "bg-gradient-to-br from-orange-500 to-red-600 text-white shadow-sm"
                }`}
              >
                {validationErrors.length > 0 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <span className="text-sm font-bold">A</span>
                )}
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-foreground">
                  Short Answer Question
                </div>
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={deleteNode}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
            >
              <Trash2 className="w-4 h-4" />
            </Button>
          </div>

          <div className="mb-3">
            <Label className="text-sm font-medium text-foreground mb-1 block select-none">
              Prompt
            </Label>
            <div className="select-text">
              <RichTextEditor
                content={shortAnswerData.prompt || ""}
                onChange={updatePrompt}
                placeholder="Enter your question prompt..."
                className="w-full"
                minHeight="80px"
                maxHeight="300px"
                showToolbar={true}
              />
            </div>
          </div>

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
                    value={shortAnswerData.points}
                    onChange={(e) =>
                      updateShortAnswerData({
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
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-foreground">Minimum Words (optional)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={shortAnswerData.minWords || ""}
                    onChange={(e) =>
                      updateShortAnswerData({
                        minWords:
                          e.target.value === ""
                            ? undefined
                            : parseInt(e.target.value) || 0,
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
                <div className="flex items-center justify-between">
                  <Label className="text-sm text-foreground">Maximum Words (optional)</Label>
                  <Input
                    type="number"
                    min="0"
                    value={shortAnswerData.maxWords || ""}
                    onChange={(e) =>
                      updateShortAnswerData({
                        maxWords:
                          e.target.value === ""
                            ? undefined
                            : parseInt(e.target.value) || 0,
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
                <div>
                  <Label className="text-sm text-foreground mb-1 block">
                    Sample Answer (hidden from students)
                  </Label>
                  <Input
                    value={shortAnswerData.sampleAnswer || ""}
                    onChange={(e) =>
                      updateShortAnswerData({
                        sampleAnswer: e.target.value,
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
                    placeholder="Example answer for reference..."
                    className="w-full"
                  />
                </div>
                <div>
                  <Label className="text-sm text-foreground mb-2 block">
                    Grading Method
                  </Label>
                  <div className="flex gap-2 mb-3">
                    <button
                      type="button"
                      onClick={() =>
                        updateShortAnswerData({ gradingType: "manual" })
                      }
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                        (shortAnswerData.gradingType === "manual" || !shortAnswerData.gradingType)
                          ? "bg-purple-600 text-white"
                          : "bg-muted text-foreground hover:bg-accent"
                      }`}
                    >
                      Manual grading
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateShortAnswerData({ gradingType: "keyword" })
                      }
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                        shortAnswerData.gradingType === "keyword"
                          ? "bg-purple-600 text-white"
                          : "bg-muted text-foreground hover:bg-accent"
                      }`}
                    >
                      Keyword matching
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        updateShortAnswerData({ gradingType: "regex" })
                      }
                      className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                        shortAnswerData.gradingType === "regex"
                          ? "bg-purple-600 text-white"
                          : "bg-muted text-foreground hover:bg-accent"
                      }`}
                    >
                      Regex pattern
                    </button>
                  </div>
                </div>
                {shortAnswerData.gradingType === "keyword" && (
                  <div>
                    <Label className="text-sm text-foreground mb-1 block">
                      Required Keywords/Phrases
                    </Label>
                    <div className="flex flex-wrap gap-2 mb-2">
                      {(shortAnswerData.keywordMatches || []).map((keyword, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-1 bg-card px-2 py-1 rounded border border-border"
                        >
                          <span className="text-sm">{keyword}</span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              const newKeywords = (shortAnswerData.keywordMatches || []).filter((_, i) => i !== idx);
                              updateShortAnswerData({ keywordMatches: newKeywords });
                            }}
                            className="h-5 w-5 p-0 text-red-600 hover:text-red-700"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder="Add keyword..."
                        className="flex-1"
                        onMouseDown={handleInputMouseDown}
                        onClick={handleInputClick}
                        onFocus={handleInputEvent}
                        onBlur={handleInputEvent}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                          if (e.key === "Enter") {
                            e.preventDefault();
                            const input = e.target as HTMLInputElement;
                            const keyword = input.value.trim();
                            if (keyword) {
                              updateShortAnswerData({
                                keywordMatches: [
                                  ...(shortAnswerData.keywordMatches || []),
                                  keyword,
                                ],
                              });
                              input.value = "";
                            }
                          }
                        }}
                        onKeyUp={handleInputEvent}
                        onKeyPress={handleInputEvent}
                        onInput={handleInputEvent}
                        onChange={handleInputEvent}
                        onMouseUp={handleInputEvent}
                        onMouseMove={handleInputEvent}
                        onPaste={handlePaste}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const input = document.querySelector(
                            'input[placeholder="Add keyword..."]'
                          ) as HTMLInputElement;
                          if (input) {
                            const keyword = input.value.trim();
                            if (keyword) {
                              updateShortAnswerData({
                                keywordMatches: [
                                  ...(shortAnswerData.keywordMatches || []),
                                  keyword,
                                ],
                              });
                              input.value = "";
                            }
                          }
                        }}
                      >
                        <Plus className="w-3 h-3" />
                      </Button>
                    </div>
                    <div className="flex items-center space-x-2 mt-2">
                      <input
                        type="checkbox"
                        id="caseSensitive"
                        checked={shortAnswerData.caseSensitive || false}
                        onChange={(e) =>
                          updateShortAnswerData({
                            caseSensitive: e.target.checked,
                          })
                        }
                        className="text-primary"
                      />
                      <Label htmlFor="caseSensitive" className="text-sm">
                        Case sensitive
                      </Label>
                    </div>
                  </div>
                )}
                {shortAnswerData.gradingType === "regex" && (
                  <div>
                    <Label className="text-sm text-foreground mb-1 block">
                      Regex Pattern
                    </Label>
                    <Input
                      value={shortAnswerData.regexPattern || ""}
                      onChange={(e) =>
                        updateShortAnswerData({
                          regexPattern: e.target.value,
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
                      placeholder="^[A-Z].*$"
                      className="w-full font-mono text-sm"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      Use a valid JavaScript regex pattern. The answer will match if it satisfies this pattern.
                    </p>
                    <div className="flex items-center space-x-2 mt-2">
                      <input
                        type="checkbox"
                        id="regexCaseSensitive"
                        checked={shortAnswerData.caseSensitive || false}
                        onChange={(e) =>
                          updateShortAnswerData({
                            caseSensitive: e.target.checked,
                          })
                        }
                        className="text-primary"
                      />
                      <Label htmlFor="regexCaseSensitive" className="text-sm">
                        Case sensitive
                      </Label>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {validationErrors.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md select-none">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <span className="text-sm font-medium text-red-800 dark:text-red-400">
                  Validation Issues
                </span>
              </div>
              <ul className="text-sm text-red-700 dark:text-red-400 space-y-1">
                {validationErrors.map((error, index) => (
                  <li key={index} className="flex items-start gap-1">
                    <span className="text-red-500 mt-0.5">•</span>
                    <span>{error}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Footer info */}
          <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground space-y-2 select-none">
            <div className="flex justify-between items-center">
              <span>Short answer question</span>
              <span>{shortAnswerData.points} points</span>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default ShortAnswerEditor;

