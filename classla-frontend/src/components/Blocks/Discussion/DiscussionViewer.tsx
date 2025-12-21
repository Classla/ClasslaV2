import React, { memo } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import { DiscussionData } from "../../extensions/DiscussionBlock";
import { Button } from "../../ui/button";
import { MessageSquare } from "lucide-react";

interface DiscussionViewerProps {
  node: any;
  editor: any;
}

const DiscussionViewer: React.FC<DiscussionViewerProps> = memo(({ node }) => {
  const discussionData = node.attrs.discussionData as DiscussionData;

  return (
    <NodeViewWrapper
      className="discussion-viewer-wrapper"
      as="div"
      draggable={false}
      contentEditable={false}
    >
      <div className="discussion-viewer border border-gray-200 rounded-lg p-4 bg-white">
        <div className="p-6 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-center">
          <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">Coming Soon</h3>
          <p className="text-sm text-gray-600">
            Discussion/Forum functionality is under development. This feature will allow students to engage in threaded discussions and peer collaboration.
          </p>
        </div>
      </div>
    </NodeViewWrapper>
  );
});

export default DiscussionViewer;

