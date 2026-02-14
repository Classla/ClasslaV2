import React from "react";
import { Card } from "../../../components/ui/card";

const CourseSummarySkeleton: React.FC = () => {
  return (
    <div className="h-full flex flex-col">
      {/* Course Header Skeleton */}
      <Card className="bg-purple-600 border-0 rounded-3xl mx-6 mt-6 flex-shrink-0">
        <div className="p-6">
          <div className="flex justify-between items-start">
            <div className="space-y-4">
              <div className="animate-pulse h-9 bg-white/20 rounded w-72"></div>
              <div className="animate-pulse flex items-center space-x-2">
                <div className="w-5 h-5 bg-white/20 rounded-full"></div>
                <div className="h-5 bg-white/20 rounded w-12"></div>
              </div>
            </div>
            <div className="animate-pulse flex items-center space-x-2 bg-white/10 rounded-lg px-4 py-2">
              <div className="h-5 bg-white/20 rounded w-24"></div>
              <div className="h-7 bg-white/20 rounded w-20"></div>
            </div>
          </div>
        </div>
      </Card>

      {/* Course Content Skeleton */}
      <div className="flex-1 mx-6 mb-6 mt-4">
        <Card className="h-full p-0 overflow-hidden">
          <div className="p-8">
            <div className="animate-pulse space-y-6">
              <div className="h-8 bg-gray-200 rounded w-1/2"></div>
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded w-full"></div>
                <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                <div className="h-4 bg-gray-200 rounded w-4/6"></div>
              </div>
              <div className="space-y-3">
                <div className="h-4 bg-gray-200 rounded w-full"></div>
                <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default CourseSummarySkeleton;
