import React from "react";

/**
 * Skeleton loader for assignment content
 * Shows animated placeholders while assignment data is loading
 */
const AssignmentContentSkeleton: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto p-8 relative">
      <div className="animate-pulse space-y-6">
        {/* Title skeleton */}
        <div className="h-8 bg-gray-200 rounded w-3/4"></div>

        {/* Paragraph skeletons */}
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 rounded"></div>
          <div className="h-4 bg-gray-200 rounded w-5/6"></div>
          <div className="h-4 bg-gray-200 rounded w-4/6"></div>
        </div>

        {/* Content block skeleton (could be MCQ, text, etc.) */}
        <div className="border border-gray-200 rounded-lg p-6 space-y-4 bg-gray-50">
          <div className="h-6 bg-gray-200 rounded w-2/3"></div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-gray-200 rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-gray-200 rounded flex-1"></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-gray-200 rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-gray-200 rounded flex-1 w-4/5"></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-gray-200 rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-gray-200 rounded flex-1 w-3/4"></div>
            </div>
          </div>
        </div>

        {/* More paragraph skeletons */}
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 rounded"></div>
          <div className="h-4 bg-gray-200 rounded w-4/5"></div>
          <div className="h-4 bg-gray-200 rounded w-5/6"></div>
        </div>

        {/* Another content block skeleton */}
        <div className="border border-gray-200 rounded-lg p-6 space-y-4 bg-gray-50">
          <div className="h-6 bg-gray-200 rounded w-1/2"></div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-gray-200 rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-gray-200 rounded flex-1"></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-gray-200 rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-gray-200 rounded flex-1 w-5/6"></div>
            </div>
          </div>
        </div>

        {/* Final paragraph skeletons */}
        <div className="space-y-3">
          <div className="h-4 bg-gray-200 rounded w-3/4"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    </div>
  );
};

export default AssignmentContentSkeleton;
