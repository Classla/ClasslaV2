import React, { useState, useEffect, memo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  RevealContentData,
  validateRevealContentData,
} from "../../extensions/RevealContentBlock";
import { AlertTriangle, ChevronDown, ChevronUp, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Label } from "../../ui/label";
import { Checkbox } from "../../ui/checkbox";
import RichTextEditor from "../../RichTextEditor";

interface RevealContentEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const RevealContentEditor: React.FC<RevealContentEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const revealContentData = node.attrs.revealContentData as RevealContentData;
    const [validationErrors, setValidationErrors] = useState<string[]>([]);

    const updateRevealContentData = useCallback(
      (updates: Partial<RevealContentData>) => {
        const newData = { ...revealContentData, ...updates };
        const validation = validateRevealContentData(newData);
        setValidationErrors(validation.errors);
        updateAttributes({ revealContentData: newData });
      },
      [revealContentData, updateAttributes]
    );

    useEffect(() => {
      const validation = validateRevealContentData(revealContentData);
      setValidationErrors(validation.errors);
    }, [revealContentData]);

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
        className="reveal-content-editor-wrapper"
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
        <div className="reveal-content-editor border border-gray-200 rounded-lg p-3 bg-white shadow-sm select-none">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  validationErrors.length > 0
                    ? "bg-red-100 text-red-600"
                    : "bg-gradient-to-br from-green-500 to-emerald-600 text-white shadow-sm"
                }`}
              >
                {validationErrors.length > 0 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <ChevronDown className="w-5 h-5" />
                )}
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-gray-900">
                  Reveal/Collapsible Content
                </div>
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
              Button Text
            </Label>
            <Input
              value={revealContentData.buttonText}
              onChange={(e) =>
                updateRevealContentData({ buttonText: e.target.value })
              }
              onMouseDown={handleInputEvent}
              onClick={handleInputEvent}
              onFocus={handleInputEvent}
              onBlur={handleInputEvent}
              onKeyDown={handleInputEvent}
              onKeyUp={handleInputEvent}
              onKeyPress={handleInputEvent}
              onInput={handleInputEvent}
              onMouseUp={handleInputEvent}
              onMouseMove={handleInputEvent}
              onPaste={handlePaste}
              placeholder="e.g., Show Hint, Reveal Answer"
              className="w-full"
            />
          </div>

          <div className="mb-3">
            <Label className="text-sm font-medium text-gray-700 mb-1 block">
              Content
            </Label>
            <RichTextEditor
              content={revealContentData.content}
              onChange={(content) =>
                updateRevealContentData({ content })
              }
              placeholder="Enter content to reveal..."
              className="w-full"
              minHeight="150px"
              maxHeight="400px"
              showToolbar={true}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="initiallyVisible"
                checked={revealContentData.initiallyVisible}
                onCheckedChange={(checked) =>
                  updateRevealContentData({ initiallyVisible: !!checked })
                }
              />
              <Label htmlFor="initiallyVisible" className="text-sm">
                Initially visible (expanded by default)
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="showHideButton"
                checked={revealContentData.showHideButton}
                onCheckedChange={(checked) =>
                  updateRevealContentData({ showHideButton: !!checked })
                }
              />
              <Label htmlFor="showHideButton" className="text-sm">
                Show "Hide" button when expanded
              </Label>
            </div>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default RevealContentEditor;

