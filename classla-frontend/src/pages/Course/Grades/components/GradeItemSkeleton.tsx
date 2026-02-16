import React from "react";

/**
 * Skeleton loader for grade item
 * Shows animated placeholders while grade data is loading
 */
const GradeItemSkeleton: React.FC = () => {
  return (
    <div className="border border-border rounded-lg p-5 bg-card shadow-sm">
      <div className="animate-pulse">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-3">
            {/* Assignment name */}
            <div className="h-6 bg-accent rounded w-3/4"></div>
            {/* Due date */}
            <div className="h-4 bg-accent rounded w-1/2"></div>
            {/* Grade status */}
            <div className="h-4 bg-accent rounded w-1/3"></div>
          </div>
          <div className="ml-4 flex-shrink-0">
            {/* Badge placeholder */}
            <div className="h-6 bg-accent rounded w-20"></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GradeItemSkeleton;
