import React, { useState, memo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { RevealContentData } from "../../extensions/RevealContentBlock";
import { Button } from "../../ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useResolvedHtml } from "../../../hooks/useResolvedHtml";

interface RevealContentViewerProps {
  node: any;
  editor: any;
}

const RevealContentViewer: React.FC<RevealContentViewerProps> = memo(
  ({ node }) => {
    const revealContentData = node.attrs.revealContentData as RevealContentData;
    const resolvedContent = useResolvedHtml(revealContentData.content || "");
    const [isExpanded, setIsExpanded] = useState(
      revealContentData.initiallyVisible
    );

    return (
      <NodeViewWrapper
        className="reveal-content-viewer-wrapper"
        as="div"
        draggable={false}
        contentEditable={false}
      >
        <div className="reveal-content-viewer border border-border rounded-lg p-4 bg-card">
          <Button
            variant="outline"
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-full flex items-center justify-between"
          >
            <span>{revealContentData.buttonText}</span>
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </Button>
          {isExpanded && (
            <div className="mt-4 prose max-w-none">
              <div
                dangerouslySetInnerHTML={{ __html: resolvedContent }}
              />
              {revealContentData.showHideButton && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsExpanded(false)}
                  className="mt-2"
                >
                  Hide
                </Button>
              )}
            </div>
          )}
        </div>
      </NodeViewWrapper>
    );
  }
);

export default RevealContentViewer;

