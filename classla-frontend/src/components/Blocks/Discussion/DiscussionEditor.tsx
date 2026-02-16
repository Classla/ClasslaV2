import React, { useState, useEffect, memo, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { DiscussionData, validateDiscussionData } from "../../extensions/DiscussionBlock";
import { AlertTriangle, MessageSquare, Trash2 } from "lucide-react";
import { Button } from "../../ui/button";
import { Label } from "../../ui/label";
import { Checkbox } from "../../ui/checkbox";
import RichTextEditor from "../../RichTextEditor";

interface DiscussionEditorProps {
  node: any;
  updateAttributes: (attrs: any) => void;
  deleteNode: () => void;
}

const DiscussionEditor: React.FC<DiscussionEditorProps> = memo(
  ({ node, updateAttributes, deleteNode }) => {
    const discussionData = node.attrs.discussionData as DiscussionData;
    const [validationErrors, setValidationErrors] = useState<string[]>([]);

    const updateDiscussionData = useCallback(
      (updates: Partial<DiscussionData>) => {
        const newData = { ...discussionData, ...updates };
        const validation = validateDiscussionData(newData);
        setValidationErrors(validation.errors);
        updateAttributes({ discussionData: newData });
      },
      [discussionData, updateAttributes]
    );

    useEffect(() => {
      const validation = validateDiscussionData(discussionData);
      setValidationErrors(validation.errors);
    }, [discussionData]);

    return (
      <NodeViewWrapper
        className="discussion-editor-wrapper"
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
        <div className="discussion-editor border border-border rounded-lg p-3 bg-card shadow-sm select-none">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div
                className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors select-none ${
                  validationErrors.length > 0
                    ? "bg-red-100 text-red-600"
                    : "bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-sm"
                }`}
              >
                {validationErrors.length > 0 ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : (
                  <MessageSquare className="w-5 h-5" />
                )}
              </div>
              <div className="select-none">
                <div className="text-sm font-medium text-foreground">Discussion/Forum</div>
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

          <div className="p-6 bg-muted rounded-lg border border-dashed border-border text-center">
            <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground mb-2">Coming Soon</h3>
            <p className="text-sm text-muted-foreground">
              Discussion/Forum functionality is under development. This feature will allow students to engage in threaded discussions and peer collaboration.
            </p>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }
);

export default DiscussionEditor;

