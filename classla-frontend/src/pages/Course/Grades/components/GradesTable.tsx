import React, { useState } from "react";
import { Assignment, Submission, Grader } from "../../../../types";
import { Badge } from "../../../../components/ui/badge";
import { calculateAssignmentPoints } from "../../../../utils/assignmentPoints";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "../../../../components/ui/dialog";
import { MessageSquare } from "lucide-react";
import { Button } from "../../../../components/ui/button";

interface GradesTableProps {
  assignments: Assignment[];
  getMostRecentSubmission: (assignmentId: string) => Submission | null;
  getGraderForSubmission: (submissionId: string) => Grader | null;
  onAssignmentClick: (assignmentId: string) => void;
}

const GradesTable: React.FC<GradesTableProps> = ({
  assignments,
  getMostRecentSubmission,
  getGraderForSubmission,
  onAssignmentClick,
}) => {
  const [selectedFeedback, setSelectedFeedback] = useState<{
    assignmentName: string;
    feedback: string;
  } | null>(null);
  // Calculate final grade from grader data
  const calculateFinalGrade = (grader: Grader): number => {
    const baseScore = grader.raw_assignment_score + grader.raw_rubric_score;
    const modifier = parseFloat(grader.score_modifier) || 0;
    return baseScore + modifier;
  };

  // Get total points for an assignment by calculating from MCQ blocks
  const getTotalPoints = (assignment: Assignment): number => {
    return calculateAssignmentPoints(assignment.content);
  };

  // Format due date
  const formatDueDate = (dueDate: Date | undefined): string => {
    if (!dueDate) return "—";
    const date = new Date(dueDate);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Get due date for assignment
  const getDueDate = (assignment: Assignment): Date | undefined => {
    const dueDateKeys = Object.keys(assignment.due_dates_map || {});
    if (dueDateKeys.length > 0) {
      return assignment.due_dates_map[dueDateKeys[0]];
    }
    return undefined;
  };

  // Format submission date
  const formatSubmissionDate = (timestamp: Date | string): string => {
    const date = new Date(timestamp);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  // Get status badge
  const getStatusBadge = (
    submission: Submission | null,
    grader: Grader | null
  ) => {
    if (!submission) {
      return (
        <Badge variant="outline" className="bg-gray-50 text-gray-600">
          Not Started
        </Badge>
      );
    }

    if (submission.status === "in-progress") {
      return (
        <Badge variant="outline" className="bg-yellow-50 text-yellow-700">
          In Progress
        </Badge>
      );
    }

    if (submission.status === "submitted" && !grader) {
      return (
        <Badge variant="outline" className="bg-blue-50 text-blue-700">
          Submitted
        </Badge>
      );
    }

    // If submission status is "graded" or "returned" but no visible grader,
    // it means it's been graded but not reviewed yet (and showScoreAfterSubmission is off)
    if (
      (submission.status === "graded" || submission.status === "returned") &&
      !grader
    ) {
      return (
        <Badge variant="outline" className="bg-orange-50 text-orange-700">
          Pending
        </Badge>
      );
    }

    // Check if grader exists and is reviewed
    if (grader) {
      const isReviewed =
        grader.reviewed_at !== null &&
        grader.reviewed_at !== undefined &&
        grader.reviewed_at !== "";

      if (isReviewed) {
        return (
          <Badge className="bg-green-600 hover:bg-green-700 text-white">
            ✓ Graded
          </Badge>
        );
      } else {
        // Has a visible grader but not reviewed yet (showScoreAfterSubmission must be on)
        return (
          <Badge variant="outline" className="bg-orange-50 text-orange-700">
            Pending
          </Badge>
        );
      }
    }

    return (
      <Badge variant="outline" className="bg-gray-50 text-gray-600">
        {submission.status}
      </Badge>
    );
  };

  // Get grade display
  const getGradeDisplay = (
    submission: Submission | null,
    grader: Grader | null,
    assignment: Assignment
  ): string => {
    if (!submission) {
      return "—";
    }

    if (submission.status === "in-progress") {
      return "—";
    }

    // If we have a grader, use it to calculate the grade
    if (grader) {
      const finalGrade = calculateFinalGrade(grader);
      const totalPoints = getTotalPoints(assignment);
      // Always show grade/total format, even if totalPoints is 0
      return `${finalGrade.toFixed(1)} / ${totalPoints}`;
    }

    // Fallback: if submission has a grade field but no grader object
    // This can happen if grading was done via the old submission.grade field
    if (submission.grade !== null && submission.grade !== undefined) {
      const totalPoints = getTotalPoints(assignment);
      // Always show grade/total format, even if totalPoints is 0
      return `${submission.grade} / ${totalPoints}`;
    }

    // If status is "graded" but no grader/grade, something went wrong
    // Still show "—" but this indicates a data inconsistency
    if (submission.status === "graded" || submission.status === "returned") {
      return "—";
    }

    // Submitted but not graded yet
    if (submission.status === "submitted") {
      return "—";
    }

    return "—";
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Assignment
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Due Date
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Grade
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Submitted
              </th>
              <th className="px-6 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                Feedback
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {assignments.map((assignment) => {
              const submission = getMostRecentSubmission(assignment.id);
              const grader = submission
                ? getGraderForSubmission(submission.id)
                : null;
              const dueDate = getDueDate(assignment);

              return (
                <tr
                  key={assignment.id}
                  onClick={() => onAssignmentClick(assignment.id)}
                  className="hover:bg-purple-50 cursor-pointer transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-medium text-gray-900">
                      {assignment.name}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-600">
                      {formatDueDate(dueDate)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {getStatusBadge(submission, grader)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm font-semibold text-gray-900">
                      {getGradeDisplay(submission, grader, assignment)}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-gray-600">
                      {submission
                        ? formatSubmissionDate(submission.timestamp)
                        : "—"}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    {grader && grader.feedback ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFeedback({
                            assignmentName: assignment.name,
                            feedback: grader.feedback,
                          });
                        }}
                        className="text-purple-600 hover:text-purple-700 hover:bg-purple-50"
                      >
                        <MessageSquare className="h-4 w-4 mr-1" />
                        View Feedback
                      </Button>
                    ) : (
                      <span className="text-sm text-gray-400">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Feedback Modal */}
      <Dialog
        open={!!selectedFeedback}
        onOpenChange={(open) => !open && setSelectedFeedback(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Feedback for {selectedFeedback?.assignmentName}
            </DialogTitle>
            <DialogDescription>
              Your instructor's feedback on this assignment
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4">
            <div className="bg-gray-50 rounded-lg p-4 min-h-[200px] max-h-[400px] overflow-y-auto">
              <p className="text-gray-900 whitespace-pre-wrap">
                {selectedFeedback?.feedback || "No feedback provided."}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GradesTable;
