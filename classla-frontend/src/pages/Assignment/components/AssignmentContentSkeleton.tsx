import React from "react";

/**
 * Skeleton loader for assignment content
 * Shows animated placeholders while assignment data is loading
 */
const AssignmentContentSkeleton: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto mt-4 p-8 relative bg-card rounded-t-lg shadow-md border border-border/50 border-b-0 min-h-[calc(100%-1rem)]">
      <div className="animate-pulse space-y-6">
        {/* Title skeleton */}
        <div className="h-8 bg-muted rounded w-3/4"></div>

        {/* Paragraph skeletons */}
        <div className="space-y-3">
          <div className="h-4 bg-muted rounded"></div>
          <div className="h-4 bg-muted rounded w-5/6"></div>
          <div className="h-4 bg-muted rounded w-4/6"></div>
        </div>

        {/* Content block skeleton (could be MCQ, text, etc.) */}
        <div className="border border-border rounded-lg p-6 space-y-4 bg-muted">
          <div className="h-6 bg-muted rounded w-2/3"></div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-muted rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-muted rounded flex-1"></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-muted rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-muted rounded flex-1 w-4/5"></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-muted rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-muted rounded flex-1 w-3/4"></div>
            </div>
          </div>
        </div>

        {/* More paragraph skeletons */}
        <div className="space-y-3">
          <div className="h-4 bg-muted rounded"></div>
          <div className="h-4 bg-muted rounded w-4/5"></div>
          <div className="h-4 bg-muted rounded w-5/6"></div>
        </div>

        {/* Another content block skeleton */}
        <div className="border border-border rounded-lg p-6 space-y-4 bg-muted">
          <div className="h-6 bg-muted rounded w-1/2"></div>
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-muted rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-muted rounded flex-1"></div>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-5 h-5 bg-muted rounded-full flex-shrink-0"></div>
              <div className="h-4 bg-muted rounded flex-1 w-5/6"></div>
            </div>
          </div>
        </div>

        {/* Final paragraph skeletons */}
        <div className="space-y-3">
          <div className="h-4 bg-muted rounded w-3/4"></div>
          <div className="h-4 bg-muted rounded w-2/3"></div>
        </div>
      </div>
    </div>
  );
};

export default AssignmentContentSkeleton;
