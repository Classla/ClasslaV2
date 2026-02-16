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
          <span className="text-foreground text-sm font-medium">
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
      <div className="w-full overflow-hidden border border-border rounded-lg shadow-sm bg-card">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-gradient-to-r from-primary/10 to-muted">
                <th className="sticky left-0 z-20 bg-gradient-to-r from-primary/10 to-muted px-6 py-4 text-left text-sm font-bold text-foreground border-b-2 border-r-2 border-border min-w-[220px] shadow-sm">
                  Student Name
                </th>
                {assignments.map((assignment) => (
                  <th
                    key={assignment.id}
                    className="px-4 py-4 text-center text-sm font-semibold text-foreground border-b-2 border-border min-w-[140px]"
                  >
                    <div className="flex flex-col gap-1">
                      <span
                        className="truncate max-w-[150px] font-bold"
                        title={assignment.name}
                      >
                        {assignment.name}
                      </span>
                      <span className="text-xs text-muted-foreground font-medium">
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
                      ? "bg-card hover:bg-accent"
                      : "bg-muted hover:bg-accent"
                  }`}
                >
                  <td className="sticky left-0 z-10 px-6 py-4 text-sm font-semibold text-foreground border-b border-r-2 border-border bg-inherit shadow-sm">
                    {student.lastName}, {student.firstName}
                  </td>
                  {assignments.map((assignment) => (
                    <td
                      key={`${student.userId}_${assignment.id}`}
                      className="px-4 py-4 text-center border-b border-border cursor-pointer hover:bg-primary/10 hover:shadow-inner transition-all duration-150"
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
