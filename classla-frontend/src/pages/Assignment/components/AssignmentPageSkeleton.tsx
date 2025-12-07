import React from "react";
import { Card } from "../../../components/ui/card";
import { Eye, Settings } from "lucide-react";

interface AssignmentPageSkeletonProps {
  isInstructor?: boolean;
}

/**
 * Skeleton loader for the full assignment page
 * Shows animated placeholders while assignment data is loading
 */
const AssignmentPageSkeleton: React.FC<AssignmentPageSkeletonProps> = ({
  isInstructor = false,
}) => {
  return (
    <div className="h-full flex">
      <div className="flex-1">
        {/* Main Scrollable Content Area */}
        <div className="h-full flex flex-col overflow-auto">
          {/* Assignment Header Skeleton */}
          <Card className="bg-purple-600 text-white border-0 rounded-3xl mx-6 mt-4 flex-shrink-0">
            <div className="p-6">
              <div className="flex justify-between items-start">
                <div className="space-y-2 flex-1">
                  {/* Title skeleton */}
                  <div className="animate-pulse">
                    <div className="h-9 bg-white/20 rounded w-3/4"></div>
                  </div>
                  {/* Metadata skeleton */}
                  <div className="animate-pulse flex items-center space-x-4">
                    <div className="h-4 bg-white/20 rounded w-32"></div>
                    <div className="h-4 bg-white/20 rounded w-24"></div>
                  </div>
                </div>
                <div className="flex flex-col items-end space-y-3">
                  {/* Buttons skeleton */}
                  <div className="animate-pulse flex items-center space-x-3">
                    <div className="h-10 bg-white/20 rounded w-40"></div>
                    <div className="h-10 bg-white/20 rounded w-40"></div>
                  </div>
                  {/* Points skeleton */}
                  <div className="animate-pulse">
                    <div className="h-6 bg-white/20 rounded w-32"></div>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* Assignment Content Skeleton */}
          <div className="flex-1 mx-6">
            <Card className="h-full p-0 overflow-hidden">
              <div className="p-8">
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
            </Card>
          </div>
        </div>
      </div>

      {/* Right Sidebar Strip - Fixed, outside Allotment */}
      {isInstructor && (
        <div className="w-12 bg-gray-100 border-l border-gray-200 flex flex-col flex-shrink-0">
          <div className="w-12 h-12 flex items-center justify-center border-b border-gray-200">
            <div className="animate-pulse">
              <Eye className="w-5 h-5 text-gray-400" />
            </div>
          </div>
          <div className="w-12 h-12 flex items-center justify-center border-b border-gray-200">
            <div className="animate-pulse">
              <Settings className="w-5 h-5 text-gray-400" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssignmentPageSkeleton;
