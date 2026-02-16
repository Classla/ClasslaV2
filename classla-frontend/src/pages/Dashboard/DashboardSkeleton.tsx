import React from "react";
import { Card, CardHeader, CardFooter } from "../../components/ui/card";

const DashboardSkeleton: React.FC = () => {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <div className="animate-pulse h-9 bg-accent rounded w-48"></div>
          <div className="animate-pulse h-5 bg-accent rounded w-64"></div>
        </div>
        <div className="flex space-x-3">
          <div className="animate-pulse h-10 bg-accent rounded w-32"></div>
          <div className="animate-pulse h-10 bg-accent rounded w-36"></div>
        </div>
      </div>

      {/* Course Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <div className="animate-pulse w-full h-48 bg-accent rounded-md mb-3"></div>
              <div className="animate-pulse h-5 bg-accent rounded w-3/4"></div>
              <div className="animate-pulse space-y-2 mt-2">
                <div className="h-4 bg-accent rounded w-full"></div>
                <div className="h-4 bg-accent rounded w-2/3"></div>
              </div>
            </CardHeader>
            <CardFooter className="pt-0">
              <div className="animate-pulse flex items-center">
                <div className="w-4 h-4 bg-accent rounded-full mr-1"></div>
                <div className="h-4 bg-accent rounded w-20"></div>
              </div>
            </CardFooter>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default DashboardSkeleton;
