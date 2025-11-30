import React from "react";
import { Assignment, Submission, Grader } from "../../../../types";
import { Badge } from "../../../../components/ui/badge";

interface GradeItemProps {
  assignment: Assignment;
  submission: Submission | null;
  grader: Grader | null;
  onClick: () => void;
}

const GradeItem: React.FC<GradeItemProps> = React.memo(
  ({ assignment, submission, grader, onClick }) => {
    // Calculate final grade from grader data
    const calculateFinalGrade = (grader: Grader): number => {
      const baseScore = grader.raw_assignment_score + grader.raw_rubric_score;
      const modifier = parseFloat(grader.score_modifier) || 0;
      return baseScore + modifier;
    };

    // Get total points for an assignment
    const getTotalPoints = (assignment: Assignment): number => {
      try {
        const content = JSON.parse(assignment.content);
        return content.totalPoints || 0;
      } catch {
        return 0;
      }
    };

    // Format due date
    const formatDueDate = (dueDate: Date | undefined): string => {
      if (!dueDate) return "";
      const date = new Date(dueDate);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    };

    // Get due date for current user (simplified - would need user context)
    const getDueDate = (): Date | undefined => {
      // In a real implementation, this would get the due date for the current user
      // For now, we'll try to get any due date from the map
      const dueDateKeys = Object.keys(assignment.due_dates_map);
      if (dueDateKeys.length > 0) {
        return assignment.due_dates_map[dueDateKeys[0]];
      }
      return undefined;
    };

    // Determine grade status or score
    const renderGradeStatus = () => {
      if (!submission) {
        return <span className="text-red-600 text-sm">Not Started</span>;
      }

      if (submission.status === "in-progress") {
        return <span className="text-yellow-600 text-sm">In Progress</span>;
      }

      if (submission.status === "submitted" && !grader) {
        return (
          <span className="text-blue-600 text-sm">
            Submitted on {new Date(submission.timestamp).toLocaleDateString()}
          </span>
        );
      }

      if (grader) {
        const finalGrade = calculateFinalGrade(grader);
        const totalPoints = getTotalPoints(assignment);
        return (
          <span className="text-gray-900 text-lg font-semibold">
            {finalGrade}/{totalPoints}
          </span>
        );
      }

      return <span className="text-gray-500 text-sm">No status</span>;
    };

    const dueDate = getDueDate();
    const isGraded = grader !== null;

    return (
      <div
        onClick={onClick}
        className="border border-gray-200 rounded-lg p-5 hover:bg-purple-50 hover:border-purple-300 cursor-pointer transition-all duration-200 bg-white shadow-sm hover:shadow-md"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-bold text-gray-900 mb-2 truncate">
              {assignment.name}
            </h3>
            {dueDate && (
              <p className="text-sm text-gray-600 mb-3 flex items-center gap-1">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                  />
                </svg>
                Due: {formatDueDate(dueDate)}
              </p>
            )}
            <div className="mt-2">{renderGradeStatus()}</div>
          </div>
          <div className="ml-4 flex-shrink-0">
            {isGraded && (
              <Badge
                variant="default"
                className="bg-green-600 hover:bg-green-700 text-white font-semibold"
              >
                ✓ Graded
              </Badge>
            )}
          </div>
        </div>
      </div>
    );
  }
);

GradeItem.displayName = "GradeItem";

export default GradeItem;
