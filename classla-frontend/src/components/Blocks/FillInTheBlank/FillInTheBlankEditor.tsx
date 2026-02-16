import React, {
  useCallback,
  useState,
  useEffect,
  memo,
  useMemo,
  useRef,
} from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  FillInTheBlankData,
  FillInTheBlankBlank,
  validateFillInTheBlankData,
} from "../../extensions/FillInTheBlankBlock";
import {
  Plus,
  Trash2,
  Settings,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Checkbox } from "../../ui/checkbox";
import { Popover } from "../../ui/popover";
import { useToast } from "../../../hooks/use-toast";
import RichTextEditor from "../../RichTextEditor";
import { isEmptyContent } from "../../extensions/blockUtils";
import { generateUUID } from "../../extensions/blockUtils";
import { ChevronDown, ChevronUp } from "lucide-react";

interface FillInTheBlankEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const FillInTheBlankEditor: React.FC<FillInTheBlankEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const fillInTheBlankData = node.attrs.fillInTheBlankData as FillInTheBlankData;
    const { toast } = useToast();
    const [validationErrors, setValidationErrors] = useState<string[]>([]);
    const [isValidating, setIsValidating] = useState(false);
    const [showGradingSetup, setShowGradingSetup] = useState(false);
    const [questionEditor, setQuestionEditor] = useState<any>(null);

    const updateFillInTheBlankData = useCallback(
      (updates: Partial<FillInTheBlankData>) => {
        const newData = { ...fillInTheBlankData, ...updates };

        const activeElement = document.activeElement as
          | HTMLInputElement
          | HTMLTextAreaElement;
        const selectionStart = activeElement?.selectionStart;
        const selectionEnd = activeElement?.selectionEnd;

        setIsValidating(true);
        const validation = validateFillInTheBlankData(newData);
        setValidationErrors(validation.errors);
        setIsValidating(false);

        if (
          !validation.isValid &&
          validation.errors.some(
            (error) =>
              error.includes("must have at least") ||
              error.includes("must be an object")
          )
        ) {
          toast({
            title: "Validation Error",
            description: validation.errors[0],
            variant: "destructive",
          });
        }

        updateAttributes({ fillInTheBlankData: newData });

        requestAnimationFrame(() => {
          if (activeElement && document.body.contains(activeElement)) {
            activeElement.focus();
            if (selectionStart !== undefined && selectionEnd !== undefined) {
              activeElement.setSelectionRange(selectionStart, selectionEnd);
            }
          }
        });
      },
      [fillInTheBlankData, updateAttributes, toast]
    );

    useEffect(() => {
      const validation = validateFillInTheBlankData(fillInTheBlankData);
      setValidationErrors(validation.errors);
    }, [fillInTheBlankData]);

    const updateQuestion = useCallback(
      (question: string) => {
        updateFillInTheBlankData({ question });
      },
      [updateFillInTheBlankData]
    );

    const insertBlankMarker = useCallback(() => {
      // Use sequential numbering instead of UUID
      const blankNumber = fillInTheBlankData.blanks.length + 1;
      const marker = `[BLANK${blankNumber}]`;
      const blankId = `blank${blankNumber}`;
      
      // Insert at cursor position using TipTap editor if available
      if (questionEditor) {
        questionEditor.chain().focus().insertContent(marker).run();
      } else {
        // Fallback: append to end
        const currentQuestion = fillInTheBlankData.question || "";
        updateQuestion(currentQuestion + (currentQuestion ? " " : "") + marker);
      }
      
      // Add blank configuration
      const newBlank: FillInTheBlankBlank = {
        id: blankId,
        acceptedAnswers: [],
        caseSensitive: false,
      };
      updateFillInTheBlankData({
        blanks: [...fillInTheBlankData.blanks, newBlank],
      });
    }, [fillInTheBlankData, updateQuestion, updateFillInTheBlankData, questionEditor]);

    const updateBlank = useCallback(
      (blankId: string, updates: Partial<FillInTheBlankBlank>) => {
        updateFillInTheBlankData({
          blanks: fillInTheBlankData.blanks.map((blank) =>
            blank.id === blankId ? { ...blank, ...updates } : blank
          ),
        });
      },
      [fillInTheBlankData.blanks, updateFillInTheBlankData]
    );

    const removeBlank = useCallback(
      (blankId: string) => {
        // Remove from question text - handle both [BLANK1] and [BLANK:id] formats
        let updatedQuestion = fillInTheBlankData.question;
        // Try [BLANK1] format first (blankId is "blank1")
        const numberMatch = blankId.match(/^blank(\d+)$/);
        if (numberMatch) {
          updatedQuestion = updatedQuestion.replace(
            new RegExp(`\\[BLANK${numberMatch[1]}\\]`, "g"),
            "___"
          );
        } else {
          // Legacy [BLANK:id] format
          updatedQuestion = updatedQuestion.replace(
            new RegExp(`\\[BLANK:${blankId}\\]`, "g"),
            "___"
          );
        }
        
        updateFillInTheBlankData({
          question: updatedQuestion,
          blanks: fillInTheBlankData.blanks.filter(
            (blank) => blank.id !== blankId
          ),
        });
      },
      [fillInTheBlankData, updateFillInTheBlankData]
    );

    const addAcceptedAnswer = useCallback(
      (blankId: string, answer: string) => {
        const blank = fillInTheBlankData.blanks.find((b) => b.id === blankId);
        if (blank && answer.trim()) {
          updateBlank(blankId, {
            acceptedAnswers: [...blank.acceptedAnswers, answer.trim()],
          });
        }
      },
      [fillInTheBlankData.blanks, updateBlank]
    );

    const removeAcceptedAnswer = useCallback(
      (blankId: string, answerIndex: number) => {
        const blank = fillInTheBlankData.blanks.find((b) => b.id === blankId);
        if (blank) {
          updateBlank(blankId, {
            acceptedAnswers: blank.acceptedAnswers.filter(
              (_, index) => index !== answerIndex
            ),
          });
        }
      },
      [fillInTheBlankData.blanks, updateBlank]
    );

    // Extract blank markers from question (supports both [BLANK1] and [BLANK:id] for backwards compatibility)
    const blankMarkers = useMemo(() => {
      const markers: { id: string; index: number }[] = [];
      // Extract text content from HTML first
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

    return (
      <NodeViewWrapper
        className="fill-in-the-blank-editor-wrapper"
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
        <div
          className="fill-in-the-blank-editor border border-border rounded-lg p-3 bg-card shadow-sm select-none"
          role="group"
          aria-label="Fill-in-the-blank question editor"
          style={{ cursor: "default" }}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3 flex-1">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  validationErrors.length > 0
                    ? "bg-red-100 text-red-600"
                    : "bg-gradient-to-br from-green-500 to-teal-600 text-white shadow-sm"
                }`}
              >
                {validationErrors.length > 0 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <span className="text-sm font-bold">F</span>
                )}
              </div>
              <div className="flex-1">
                <div className="text-sm font-medium text-foreground">
                  Fill-in-the-Blank Question
                </div>
                <div className="text-xs text-muted-foreground">
                  {fillInTheBlankData.blanks.length} blank
                  {fillInTheBlankData.blanks.length !== 1 ? "s" : ""}
                </div>
              </div>
              {validationErrors.length > 0 && (
                <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 px-2 py-1 rounded border border-red-200">
                  <AlertTriangle className="w-3 h-3" />
                  <span>{validationErrors.length} error{validationErrors.length !== 1 ? "s" : ""}</span>
                </div>
              )}
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
            <div className="flex items-center gap-2">
              <Popover
                align="right"
                trigger={
                  <Button variant="ghost" size="sm">
                    <Settings className="w-4 h-4" />
                  </Button>
                }
                content={
                  <div className="p-4 space-y-4">
                    <div>
                      <Label htmlFor="points">Points</Label>
                      <Input
                        id="points"
                        type="number"
                        min="0"
                        step="0.5"
                        value={fillInTheBlankData.points}
                        onChange={(e) =>
                          updateFillInTheBlankData({
                            points: parseFloat(e.target.value) || 0,
                          })
                        }
                        className="mt-1"
                      />
                    </div>
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="pointsPerBlank"
                        checked={fillInTheBlankData.pointsPerBlank}
                        onCheckedChange={(checked) =>
                          updateFillInTheBlankData({
                            pointsPerBlank: !!checked,
                          })
                        }
                      />
                      <Label htmlFor="pointsPerBlank">
                        Award points per blank
                      </Label>
                    </div>
                    <div>
                      <Label htmlFor="attempts">Max Attempts</Label>
                      <Input
                        id="attempts"
                        type="number"
                        min="1"
                        value={fillInTheBlankData.attempts}
                        onChange={(e) =>
                          updateFillInTheBlankData({
                            attempts: parseInt(e.target.value) || 1,
                          })
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="showHintAfter">
                        Show hint after (attempts)
                      </Label>
                      <Input
                        id="showHintAfter"
                        type="number"
                        min="0"
                        value={fillInTheBlankData.showHintAfterAttempts || 1}
                        onChange={(e) =>
                          updateFillInTheBlankData({
                            showHintAfterAttempts: parseInt(e.target.value) || 1,
                          })
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="showAnswerAfter">
                        Show answer after (attempts)
                      </Label>
                      <Input
                        id="showAnswerAfter"
                        type="number"
                        min="0"
                        value={fillInTheBlankData.showAnswerAfterAttempts || 3}
                        onChange={(e) =>
                          updateFillInTheBlankData({
                            showAnswerAfterAttempts:
                              parseInt(e.target.value) || 3,
                          })
                        }
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="generalFeedback">
                        General Feedback (optional)
                      </Label>
                      <Input
                        id="generalFeedback"
                        value={fillInTheBlankData.generalFeedback || ""}
                        onChange={(e) =>
                          updateFillInTheBlankData({
                            generalFeedback: e.target.value,
                          })
                        }
                        placeholder="Feedback shown after submission..."
                        className="mt-1"
                      />
                    </div>
                  </div>
                }
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={deleteNode}
                className="text-red-600 hover:text-red-700 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Question editor */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <Label className="text-sm font-medium text-foreground select-none">
                Question Text
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={insertBlankMarker}
                className="text-xs"
              >
                <Plus className="w-3 h-3 mr-1" />
                Insert Blank
              </Button>
            </div>
            <div className="select-text">
              <RichTextEditor
                content={fillInTheBlankData.question || ""}
                onChange={(html) => {
                  // Extract blank IDs from text markers - support both [BLANK1] and [BLANK:id]
                  const tempDiv = document.createElement("div");
                  tempDiv.innerHTML = html;
                  const questionText = tempDiv.textContent || tempDiv.innerText || "";
                  
                  const blankRegex = /\[BLANK(\d+)\]|\[BLANK:([^\]]+)\]/gi;
                  const matches = questionText.matchAll(blankRegex);
                  const foundBlankIds: string[] = [];
                  
                  for (const match of matches) {
                    const id = match[1] ? `blank${match[1]}` : match[2]; // Convert BLANK1 to blank1, or use legacy id
                    if (id) {
                      foundBlankIds.push(id);
                    }
                  }
                  
                  // Remove blanks that are no longer in the question
                  const blanksToKeep = fillInTheBlankData.blanks.filter(b => 
                    foundBlankIds.includes(b.id)
                  );
                  
                  // Add new blanks for any markers without configurations
                  foundBlankIds.forEach(blankId => {
                    if (!blanksToKeep.find(b => b.id === blankId)) {
                      blanksToKeep.push({
                        id: blankId,
                        acceptedAnswers: [],
                        caseSensitive: false,
                      });
                    }
                  });
                  
                  updateFillInTheBlankData({
                    question: html,
                    blanks: blanksToKeep,
                  });
                }}
                placeholder="Enter your question... Use 'Insert Blank' button to add blanks"
                className={`w-full ${
                  validationErrors.some((error) => error.includes("question"))
                    ? "border-red-300 focus-within:border-red-500 focus-within:ring-red-200"
                    : ""
                }`}
                minHeight="80px"
                maxHeight="300px"
                showToolbar={true}
                onEditorReady={setQuestionEditor}
              />
            </div>
            <div className="text-xs text-muted-foreground mt-1 select-none">
              Use the "Insert Blank" button to add [BLANK:...] markers in your
              question
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
                {/* Blank configurations */}
                {fillInTheBlankData.blanks.length > 0 ? (
                  <div className="space-y-3">
                    <Label className="text-sm font-medium text-foreground select-none">
                      Blank Configurations
                    </Label>
                    {fillInTheBlankData.blanks.map((blank, index) => (
                      <div
                        key={blank.id}
                        className="p-3 border border-border rounded-md bg-muted"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-foreground">
                            Blank {index + 1}
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => removeBlank(blank.id)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>

                        <div className="space-y-2">
                          <div>
                            <Label className="text-xs text-muted-foreground">
                              Accepted Answers
                            </Label>
                            <div className="flex flex-wrap gap-2 mt-1">
                              {blank.acceptedAnswers.map((answer, answerIndex) => (
                                <div
                                  key={answerIndex}
                                  className="flex items-center gap-1 bg-card px-2 py-1 rounded border border-border"
                                >
                                  <span className="text-sm">{answer}</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      removeAcceptedAnswer(blank.id, answerIndex)
                                    }
                                    className="h-5 w-5 p-0 text-red-600 hover:text-red-700"
                                  >
                                    <X className="w-3 h-3" />
                                  </Button>
                                </div>
                              ))}
                              <div className="flex items-center gap-1">
                                <Input
                                  placeholder="Add answer..."
                                  className="h-8 text-sm w-32"
                                  onMouseDown={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault(); // Prevent ProseMirror from handling
                                    // Manually focus the input after preventing default
                                    setTimeout(() => {
                                      (e.target as HTMLInputElement)?.focus();
                                    }, 0);
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    (e.target as HTMLInputElement)?.focus();
                                  }}
                                  onFocus={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onBlur={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onKeyDown={(e) => {
                                    e.stopPropagation();
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      const input = e.target as HTMLInputElement;
                                      addAcceptedAnswer(blank.id, input.value);
                                      input.value = "";
                                    }
                                  }}
                                  onKeyUp={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onKeyPress={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onInput={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onMouseUp={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onMouseMove={(e) => {
                                    e.stopPropagation();
                                  }}
                                  onPaste={(e) => {
                                    e.stopPropagation();
                                  }}
                                />
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    const input = document.querySelector(
                                      `input[placeholder="Add answer..."]`
                                    ) as HTMLInputElement;
                                    if (input) {
                                      addAcceptedAnswer(blank.id, input.value);
                                      input.value = "";
                                    }
                                  }}
                                  className="h-8"
                                >
                                  <Plus className="w-3 h-3" />
                                </Button>
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2">
                            <Checkbox
                              id={`caseSensitive-${blank.id}`}
                              checked={blank.caseSensitive}
                              onCheckedChange={(checked) =>
                                updateBlank(blank.id, {
                                  caseSensitive: !!checked,
                                })
                              }
                            />
                            <Label
                              htmlFor={`caseSensitive-${blank.id}`}
                              className="text-xs"
                            >
                              Case sensitive
                            </Label>
                          </div>

                          <div>
                            <Label className="text-xs text-muted-foreground">
                              Feedback (optional)
                            </Label>
                            <Input
                              value={blank.feedback || ""}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                e.preventDefault(); // Prevent ProseMirror from handling
                                // Manually focus the input after preventing default
                                setTimeout(() => {
                                  (e.target as HTMLInputElement)?.focus();
                                }, 0);
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                (e.target as HTMLInputElement)?.focus();
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
                              onKeyPress={(e) => {
                                e.stopPropagation();
                              }}
                              onInput={(e) => {
                                e.stopPropagation();
                              }}
                              onChange={(e) => {
                                e.stopPropagation();
                                updateBlank(blank.id, {
                                  feedback: e.target.value,
                                });
                              }}
                              onMouseUp={(e) => {
                                e.stopPropagation();
                              }}
                              onMouseMove={(e) => {
                                e.stopPropagation();
                              }}
                              placeholder="Custom feedback for wrong answers..."
                              className="mt-1 text-sm"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    No blanks configured. Add blanks to your question first.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer info */}
          <div className="mt-4 pt-3 border-t border-border text-xs text-muted-foreground space-y-2 select-none">
            <div className="flex justify-between items-center">
              <span>
                {fillInTheBlankData.blanks.length} blank
                {fillInTheBlankData.blanks.length !== 1 ? "s" : ""} configured
              </span>
              <span>{fillInTheBlankData.points} points</span>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default FillInTheBlankEditor;

