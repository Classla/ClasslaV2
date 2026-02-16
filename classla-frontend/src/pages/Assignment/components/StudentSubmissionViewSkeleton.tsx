import React from "react";

/**
 * Skeleton loader for student submission view
 * Shows animated placeholders while submission data is loading
 */
const StudentSubmissionViewSkeleton: React.FC = () => {
  return (
    <div className="flex flex-col h-full bg-background">
      {/* Navigation Header Skeleton */}
      <div className="border-b border-border bg-card px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="animate-pulse">
            <div className="h-9 bg-muted rounded w-24"></div>
          </div>
          <div className="animate-pulse">
            <div className="h-7 bg-muted rounded w-40"></div>
          </div>
          <div className="animate-pulse">
            <div className="h-9 bg-muted rounded w-24"></div>
          </div>
        </div>
      </div>

      {/* Content Area Skeleton */}
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Assignment Viewer Skeleton */}
          <div className="bg-card rounded-lg shadow-sm border border-border p-6">
            <div className="animate-pulse space-y-6">
              {/* Title */}
              <div className="h-8 bg-muted rounded w-3/4"></div>

              {/* Paragraphs */}
              <div className="space-y-3">
                <div className="h-4 bg-muted rounded"></div>
                <div className="h-4 bg-muted rounded w-5/6"></div>
                <div className="h-4 bg-muted rounded w-4/6"></div>
              </div>

              {/* Content block */}
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
                </div>
              </div>
            </div>
          </div>

          {/* Grading Controls Skeleton */}
          <div className="space-y-6 p-6 border border-border rounded-lg bg-card shadow-sm">
            <div className="animate-pulse">
              <div className="h-6 bg-muted rounded w-48 mb-6"></div>

              {/* Score fields */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded w-32"></div>
                  <div className="h-10 bg-muted rounded"></div>
                </div>
                <div className="space-y-2">
                  <div className="h-4 bg-muted rounded w-32"></div>
                  <div className="h-10 bg-muted rounded"></div>
                </div>
              </div>

              {/* Feedback textarea */}
              <div className="space-y-2 mb-6">
                <div className="h-4 bg-muted rounded w-24"></div>
                <div className="h-32 bg-muted rounded"></div>
              </div>

              {/* Checkbox */}
              <div className="flex items-center space-x-3 p-4 bg-muted rounded-md">
                <div className="w-5 h-5 bg-muted rounded"></div>
                <div className="h-4 bg-muted rounded w-32"></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentSubmissionViewSkeleton;
