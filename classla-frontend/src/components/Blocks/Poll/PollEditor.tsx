import React, { useState, useEffect, memo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { PollData, PollOption, validatePollData } from "../../extensions/PollBlock";
import { generateUUID } from "../../extensions/blockUtils";
import { Plus, Trash2, AlertTriangle, X, GripVertical } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import RichTextEditor from "../../RichTextEditor";

interface PollEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const PollEditor: React.FC<PollEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const pollData = node.attrs.pollData as PollData;
    const [validationErrors, setValidationErrors] = useState<string[]>([]);

    const updatePollData = useCallback(
      (updates: Partial<PollData>) => {
        const newData = { ...pollData, ...updates };
        const validation = validatePollData(newData);
        setValidationErrors(validation.errors);
        updateAttributes({ pollData: newData });
      },
      [pollData, updateAttributes]
    );

    useEffect(() => {
      const validation = validatePollData(pollData);
      setValidationErrors(validation.errors);
    }, [pollData]);

    const addOption = useCallback(() => {
      const newOption: PollOption = {
        id: generateUUID(),
        text: "",
      };
      updatePollData({ options: [...pollData.options, newOption] });
    }, [pollData, updatePollData]);

    const removeOption = useCallback(
      (optionId: string) => {
        updatePollData({
          options: pollData.options.filter((opt) => opt.id !== optionId),
        });
      },
      [pollData, updatePollData]
    );

    const updateOption = useCallback(
      (optionId: string, text: string) => {
        const newOptions = pollData.options.map((opt) =>
          opt.id === optionId ? { ...opt, text } : opt
        );
        updatePollData({ options: newOptions });
      },
      [pollData, updatePollData]
    );

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
      (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.stopPropagation();
      },
      []
    );

    return (
      <NodeViewWrapper
        className="poll-editor-wrapper"
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
        <div className="poll-editor border border-gray-200 rounded-lg p-3 bg-white shadow-sm select-none">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  validationErrors.length > 0
                    ? "bg-red-100 text-red-600"
                    : "bg-gradient-to-br from-pink-500 to-rose-600 text-white shadow-sm"
                }`}
              >
                {validationErrors.length > 0 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <GripVertical className="w-5 h-5" />
                )}
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-gray-900">Poll/Survey</div>
                {validationErrors.length > 0 && (
                  <div className="text-xs text-red-600 mt-0.5">
                    {validationErrors.length} error
                    {validationErrors.length !== 1 ? "s" : ""}
                  </div>
                )}
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

          <div className="mb-3">
            <Label className="text-sm font-medium text-gray-700 mb-1 block">
              Question
            </Label>
            <RichTextEditor
              content={pollData.question}
              onChange={(content) => updatePollData({ question: content })}
              placeholder="Enter your poll question..."
              className="w-full"
              minHeight="80px"
              maxHeight="200px"
              showToolbar={true}
            />
          </div>

          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <Label className="text-sm font-medium text-gray-700">Options</Label>
              <Button variant="outline" size="sm" onClick={addOption} className="text-xs">
                <Plus className="w-3 h-3 mr-1" />
                Add Option
              </Button>
            </div>
            <div className="space-y-2">
              {pollData.options.map((option) => (
                <div
                  key={option.id}
                  className="flex items-center gap-2 p-2 bg-gray-50 border border-gray-200 rounded"
                >
                  <GripVertical className="w-4 h-4 text-gray-400" />
                  <Input
                    value={option.text}
                    onChange={(e) => updateOption(option.id, e.target.value)}
                    onMouseDown={handleInputMouseDown}
                    onClick={handleInputClick}
                    onFocus={handleInputEvent}
                    onBlur={handleInputEvent}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (option.text.trim()) {
                          addOption();
                          // Focus will be on the new option's input after state update
                          setTimeout(() => {
                            const inputs = document.querySelectorAll(
                              'input[placeholder="Option text..."]'
                            );
                            const lastInput = inputs[inputs.length - 1] as HTMLInputElement;
                            lastInput?.focus();
                          }, 0);
                        }
                      }
                    }}
                    onKeyUp={handleInputEvent}
                    onKeyPress={handleInputEvent}
                    onInput={handleInputEvent}
                    onMouseUp={handleInputEvent}
                    onMouseMove={handleInputEvent}
                    onPaste={handlePaste}
                    placeholder="Option text..."
                    className="flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeOption(option.id)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-3">
            <Label className="text-sm font-medium text-gray-700 mb-2 block">
              Selection Type
            </Label>
            <div className="flex gap-2 mb-3">
              <button
                type="button"
                onClick={() => updatePollData({ selectionType: "single" })}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  pollData.selectionType === "single"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Single choice
              </button>
              <button
                type="button"
                onClick={() => updatePollData({ selectionType: "multiple" })}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                  pollData.selectionType === "multiple"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Multiple choice
              </button>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default PollEditor;

