import React from "react";
import { Assignment, Submission, Grader, StudentGradebookInfo } from "../../../../types";
import { getSubmissionStatus } from "../../../../utils/submissionStatus";

interface GradebookTableProps {
  students: StudentGradebookInfo[];
  assignments: Assignment[];
  submissions: Map<string, Submission>;
  graders: Map<string, Grader>;
  onCellClick: (studentId: string, assignmentId: string) => void;
}

const GradebookTable: React.FC<GradebookTableProps> = React.memo(
  ({ students, assignments, submissions, graders, onCellClick }) => {
    // Calculate final grade from grader data
    const calculateFinalGrade = (grader: Grader): number => {
      const baseScore = grader.raw_assignment_score + grader.raw_rubric_score;
      const modifier = parseFloat(grader.score_modifier) || 0;
      return baseScore + modifier;
    };

    // Get total points for an assignment
    const getTotalPoints = (assignment: Assignment): number => {
      // Parse the content to find total points
      // For now, we'll return a placeholder - this should be calculated from the assignment content
      try {
        const content = JSON.parse(assignment.content);
        // This is a simplified version - actual implementation would need to parse blocks
        return content.totalPoints || 0;
      } catch {
        return 0;
      }
    };

    // Render cell content based on submission status
    const renderCell = (
      student: StudentGradebookInfo,
      assignment: Assignment
    ) => {
      const submissionKey = `${student.userId}_${assignment.id}`;
      const submission = submissions.get(submissionKey);
      const grader = submission ? graders.get(submission.id) : null;
      const hasGrader = !!grader;

      // If graded, show the grade
      if (grader) {
        const finalGrade = calculateFinalGrade(grader);
        const totalPoints = getTotalPoints(assignment);
        return (
          <span className="text-gray-900 text-sm font-medium">
            {finalGrade}/{totalPoints}
          </span>
        );
      }

      // Otherwise, show status
      const status = getSubmissionStatus(submission || null, hasGrader);
      return (
        <span className={`${status.color} text-sm font-semibold`}>
          {status.label}
        </span>
      );
    };

    return (
      <div className="w-full overflow-hidden border border-gray-200 rounded-lg shadow-sm bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gradient-to-r from-purple-50 to-gray-50">
                <th className="sticky left-0 z-20 bg-gradient-to-r from-purple-50 to-gray-50 px-6 py-4 text-left text-sm font-bold text-gray-900 border-b-2 border-r-2 border-gray-300 min-w-[220px] shadow-sm">
                  Student Name
                </th>
                {assignments.map((assignment) => (
                  <th
                    key={assignment.id}
                    className="px-4 py-4 text-center text-sm font-semibold text-gray-900 border-b-2 border-gray-300 min-w-[140px]"
                  >
                    <div className="flex flex-col gap-1">
                      <span
                        className="truncate max-w-[150px] font-bold"
                        title={assignment.name}
                      >
                        {assignment.name}
                      </span>
                      <span className="text-xs text-gray-600 font-medium">
                        Out of {getTotalPoints(assignment)}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((student, index) => (
                <tr
                  key={student.userId}
                  className={`transition-colors ${
                    index % 2 === 0
                      ? "bg-white hover:bg-gray-50"
                      : "bg-gray-50 hover:bg-gray-100"
                  }`}
                >
                  <td className="sticky left-0 z-10 px-6 py-4 text-sm font-semibold text-gray-900 border-b border-r-2 border-gray-200 bg-inherit shadow-sm">
                    {student.lastName}, {student.firstName}
                  </td>
                  {assignments.map((assignment) => (
                    <td
                      key={`${student.userId}_${assignment.id}`}
                      className="px-4 py-4 text-center border-b border-gray-200 cursor-pointer hover:bg-purple-50 hover:shadow-inner transition-all duration-150"
                      onClick={() => onCellClick(student.userId, assignment.id)}
                    >
                      {renderCell(student, assignment)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }
);

GradebookTable.displayName = "GradebookTable";

export default GradebookTable;
