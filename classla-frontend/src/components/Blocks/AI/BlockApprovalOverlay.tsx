import React, { memo } from "react";
import { Check, X, CheckSquare, Square } from "lucide-react";

interface BlockApprovalOverlayProps {
  blockIndex: number;
  blockType: string;
  approved: boolean;
  onToggle: () => void;
}

const BlockApprovalOverlay: React.FC<BlockApprovalOverlayProps> = memo(
  ({ blockIndex, blockType, approved, onToggle }) => {
    const getBlockTypeName = (type: string) => {
      switch (type) {
        case "mcqBlock": return "Multiple Choice";
        case "fillInTheBlankBlock": return "Fill-in-the-Blank";
        case "shortAnswerBlock": return "Short Answer";
        case "ideBlock": return "Code Editor";
        case "parsonsProblemBlock": return "Parsons Problem";
        case "dragDropMatchingBlock": return "Drag & Drop";
        case "clickableAreaBlock": return "Code Selection";
        case "pollBlock": return "Poll";
        case "tabbedContentBlock": return "Tabbed Content";
        case "revealContentBlock": return "Reveal Content";
        case "discussionBlock": return "Discussion";
        case "embedBlock": return "Embed";
        case "paragraph": return "Paragraph";
        case "heading": return "Heading";
        case "codeBlock": return "Code Block";
        case "bulletList": return "Bullet List";
        case "orderedList": return "Ordered List";
        case "blockquote": return "Quote";
        default: return type;
      }
    };

    return (
      <div
        className={`absolute inset-0 z-10 pointer-events-none transition-all duration-200 ${
          approved
            ? "border-2 border-green-400 rounded-lg bg-green-50/30"
            : "border-2 border-gray-300 rounded-lg bg-gray-50/50 opacity-60"
        }`}
      >
        {/* Approval toggle button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className={`pointer-events-auto absolute -top-2 -left-2 flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium shadow-md transition-colors ${
            approved
              ? "bg-green-500 text-white hover:bg-green-600"
              : "bg-gray-400 text-white hover:bg-gray-500"
          }`}
        >
          {approved ? (
            <CheckSquare className="w-3 h-3" />
          ) : (
            <Square className="w-3 h-3" />
          )}
          <span className="hidden sm:inline">{getBlockTypeName(blockType)}</span>
        </button>
      </div>
    );
  }
);

BlockApprovalOverlay.displayName = "BlockApprovalOverlay";

export default BlockApprovalOverlay;
