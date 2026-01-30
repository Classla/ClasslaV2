import React, { memo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { Loader2, Sparkles } from "lucide-react";

interface GeneratingBlockViewProps {
  node: any;
}

const GeneratingBlockView: React.FC<GeneratingBlockViewProps> = memo(({ node }) => {
  const blockType = node.attrs.blockType || "paragraph";
  const blockIndex = node.attrs.blockIndex || 0;

  const getBlockTypeName = (type: string) => {
    switch (type) {
      // Standard TipTap blocks
      case "paragraph": return "Paragraph";
      case "heading": return "Heading";
      case "codeBlock": return "Code Block";
      case "bulletList": return "Bullet List";
      case "orderedList": return "Ordered List";
      case "blockquote": return "Blockquote";
      case "horizontalRule": return "Divider";
      // Graded blocks
      case "mcqBlock": return "Multiple Choice Question";
      case "fillInTheBlankBlock": return "Fill-in-the-Blank";
      case "shortAnswerBlock": return "Short Answer";
      case "ideBlock": return "Code Editor";
      case "parsonsProblemBlock": return "Parsons Problem";
      case "dragDropMatchingBlock": return "Drag & Drop Matching";
      case "clickableAreaBlock": return "Code Selection";
      // Content blocks
      case "pollBlock": return "Poll";
      case "tabbedContentBlock": return "Tabbed Content";
      case "revealContentBlock": return "Reveal Content";
      case "discussionBlock": return "Discussion";
      case "embedBlock": return "Embed";
      default: return type;
    }
  };

  return (
    <NodeViewWrapper
      className="generating-block-wrapper"
      as="div"
      draggable={false}
      contentEditable={false}
      data-block-index={blockIndex}
    >
      <div className="generating-block-content">
        <div className="flex items-center gap-2 text-purple-600">
          <Loader2 className="w-4 h-4 animate-spin" />
          <Sparkles className="w-4 h-4" />
          <span className="ai-generating-text">
            Generating {getBlockTypeName(blockType)}...
          </span>
        </div>
      </div>
    </NodeViewWrapper>
  );
});

GeneratingBlockView.displayName = "GeneratingBlockView";

export default GeneratingBlockView;

