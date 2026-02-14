import React from "react";

const ModuleTreeSkeleton: React.FC = () => {
  const rows = [
    { indent: 0, width: "w-3/4" },
    { indent: 1, width: "w-2/3" },
    { indent: 1, width: "w-4/5" },
    { indent: 0, width: "w-1/2" },
    { indent: 1, width: "w-3/5" },
    { indent: 1, width: "w-2/3" },
    { indent: 1, width: "w-3/4" },
    { indent: 0, width: "w-2/3" },
  ];

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-3">
        <div className="animate-pulse h-4 bg-gray-200 rounded w-28"></div>
      </div>

      <div className="animate-pulse space-y-2">
        {rows.map((row, i) => (
          <div
            key={i}
            className="flex items-center py-1.5"
            style={{ paddingLeft: `${row.indent * 20 + 4}px` }}
          >
            <div className="w-4 h-4 bg-gray-200 rounded flex-shrink-0 mr-2"></div>
            <div className={`h-4 bg-gray-200 rounded ${row.width}`}></div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ModuleTreeSkeleton;
