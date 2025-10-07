import React from "react";

/**
 * Skeleton loader for gradebook table
 * Shows animated placeholders while gradebook data is loading
 */
const GradebookTableSkeleton: React.FC = () => {
  // Generate skeleton rows
  const skeletonRows = Array.from({ length: 8 }, (_, i) => i);
  const skeletonColumns = Array.from({ length: 6 }, (_, i) => i);

  return (
    <div className="w-full overflow-hidden border border-gray-200 rounded-lg shadow-sm bg-white">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gradient-to-r from-purple-50 to-gray-50">
              <th className="sticky left-0 z-20 bg-gradient-to-r from-purple-50 to-gray-50 px-6 py-4 text-left border-b-2 border-r-2 border-gray-300 min-w-[220px] shadow-sm">
                <div className="animate-pulse">
                  <div className="h-5 bg-gray-300 rounded w-32"></div>
                </div>
              </th>
              {skeletonColumns.map((col) => (
                <th
                  key={col}
                  className="px-4 py-4 text-center border-b-2 border-gray-300 min-w-[140px]"
                >
                  <div className="animate-pulse flex flex-col gap-2 items-center">
                    <div className="h-4 bg-gray-300 rounded w-24"></div>
                    <div className="h-3 bg-gray-200 rounded w-16"></div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skeletonRows.map((row, index) => (
              <tr
                key={row}
                className={`${index % 2 === 0 ? "bg-white" : "bg-gray-50"}`}
              >
                <td className="sticky left-0 z-10 px-6 py-4 border-b border-r-2 border-gray-200 bg-inherit shadow-sm">
                  <div className="animate-pulse">
                    <div className="h-4 bg-gray-300 rounded w-36"></div>
                  </div>
                </td>
                {skeletonColumns.map((col) => (
                  <td
                    key={col}
                    className="px-4 py-4 text-center border-b border-gray-200"
                  >
                    <div className="animate-pulse flex justify-center">
                      <div className="h-4 bg-gray-200 rounded w-12"></div>
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default GradebookTableSkeleton;
