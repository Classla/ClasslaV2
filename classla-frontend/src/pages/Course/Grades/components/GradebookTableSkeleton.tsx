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
    <div className="w-full overflow-hidden border border-border rounded-lg shadow-sm bg-card">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-gradient-to-r from-primary/10 to-muted">
              <th className="sticky left-0 z-20 bg-gradient-to-r from-primary/10 to-muted px-6 py-4 text-left border-b-2 border-r-2 border-border min-w-[220px] shadow-sm">
                <div className="animate-pulse">
                  <div className="h-5 bg-accent rounded w-32"></div>
                </div>
              </th>
              {skeletonColumns.map((col) => (
                <th
                  key={col}
                  className="px-4 py-4 text-center border-b-2 border-r border-border min-w-[140px] last:border-r-0"
                >
                  <div className="animate-pulse flex flex-col gap-2 items-center">
                    <div className="h-4 bg-accent rounded w-24"></div>
                    <div className="h-3 bg-accent rounded w-16"></div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skeletonRows.map((row, index) => (
              <tr
                key={row}
                className={`${index % 2 === 0 ? "bg-card" : "bg-muted"}`}
              >
                <td className="sticky left-0 z-10 px-6 py-4 border-b border-r-2 border-border bg-inherit shadow-sm">
                  <div className="animate-pulse">
                    <div className="h-4 bg-accent rounded w-36"></div>
                  </div>
                </td>
                {skeletonColumns.map((col) => (
                  <td
                    key={col}
                    className="px-4 py-4 text-center border-b border-r border-border last:border-r-0"
                  >
                    <div className="animate-pulse flex justify-center">
                      <div className="h-4 bg-accent rounded w-12"></div>
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
