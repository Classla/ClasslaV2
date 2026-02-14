import React from "react";
import { Card } from "../../../components/ui/card";
import ModuleTreeSkeleton from "../../../components/ModuleTreeSkeleton";

const CourseLayoutSkeleton: React.FC = () => {
  return (
    <div className="h-screen bg-gray-50 flex flex-col">
      {/* Header Bar */}
      <header className="bg-purple-600 shadow-sm">
        <div className="px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-4">
              <div className="animate-pulse flex items-center space-x-3">
                <div className="w-8 h-8 bg-white/20 rounded"></div>
                <div className="h-5 bg-white/20 rounded w-20"></div>
              </div>
              <span className="text-white/30 text-lg">•</span>
              <div className="animate-pulse h-5 bg-white/20 rounded w-40"></div>
            </div>
            <div className="animate-pulse flex items-center space-x-6">
              <div className="h-4 bg-white/20 rounded w-20"></div>
            </div>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden flex">
        {/* Sidebar */}
        <div className="w-64 h-full bg-white border-r border-gray-200 flex flex-col flex-shrink-0">
          <div className="flex-1 overflow-auto py-6">
            {/* Nav Tabs */}
            <nav className="space-y-1 px-3">
              {["w-24", "w-20", "w-16", "w-20"].map((w, i) => (
                <div key={i} className="flex items-center space-x-3 px-3 py-2">
                  <div className="animate-pulse w-5 h-5 bg-gray-200 rounded"></div>
                  <div className={`animate-pulse h-4 bg-gray-200 rounded ${w}`}></div>
                </div>
              ))}
            </nav>

            {/* Module Tree */}
            <div className="mt-8 px-3">
              <ModuleTreeSkeleton />
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 h-full overflow-auto">
          <div className="h-full flex flex-col">
            {/* Purple Header Card */}
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

            {/* Content Area */}
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
        </div>
      </div>
    </div>
  );
};

export default CourseLayoutSkeleton;
