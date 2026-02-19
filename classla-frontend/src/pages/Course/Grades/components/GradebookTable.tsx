import React, { useState, useRef } from "react";
import { Assignment, Submission, Grader, StudentGradebookInfo } from "../../../../types";
import { getSubmissionStatus } from "../../../../utils/submissionStatus";
import { calculateAssignmentPoints } from "../../../../utils/assignmentPoints";
import { TooltipProvider } from "../../../../components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from "../../../../components/ui/context-menu";

interface GradebookTableProps {
  students: StudentGradebookInfo[];
  assignments: Assignment[];
  submissions: Map<string, Submission>;
  graders: Map<string, Grader>;
  onCellClick: (studentId: string, assignmentId: string) => void;
  onHeaderClick: (assignmentId: string) => void;
  onMarkReviewed: (graderId: string) => void;
  onChangeGrade: (graderId: string, modifier: number) => void;
}

const GradebookTable: React.FC<GradebookTableProps> = React.memo(
  ({ students, assignments, submissions, graders, onCellClick, onHeaderClick, onMarkReviewed, onChangeGrade }) => {

    // State for the "Change Grade" inline input
    const [changeGradeState, setChangeGradeState] = useState<{
      graderId: string;
      value: string;
      baseScore: number;
    } | null>(null);

    // Track Escape keypress so blur doesn't save
    const cancelRef = useRef(false);

    // raw_assignment_score and raw_rubric_score come back as strings from Supabase (numeric type)
    const calculateFinalGrade = (grader: Grader): number => {
      const baseScore = (Number(grader.raw_assignment_score) || 0) + (Number(grader.raw_rubric_score) || 0);
      const modifier = parseFloat(grader.score_modifier) || 0;
      return baseScore + modifier;
    };

    const renderCell = (
      student: StudentGradebookInfo,
      assignment: Assignment
    ) => {
      const submissionKey = `${student.userId}_${assignment.id}`;
      const submission = submissions.get(submissionKey);
      const grader = submission ? graders.get(submission.id) : null;
      const hasGrader = !!grader;

      // In-progress — show score if autograded, else "—", with yellow badge
      if (submission?.status === "in-progress") {
        const totalPoints = calculateAssignmentPoints(assignment.content);
        const score = grader ? calculateFinalGrade(grader) : null;
        return (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-yellow-600 dark:text-yellow-400 text-sm font-medium flex items-center gap-0.5">
              <span>{score !== null ? score : "—"}</span>
              <span className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity text-xs">
                /{totalPoints}
              </span>
            </span>
            <span className="absolute top-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded leading-none bg-yellow-100 text-yellow-700 dark:bg-yellow-900/50 dark:text-yellow-300">
              In Progress
            </span>
          </div>
        );
      }

      // If graded, show score centered with corner status badge + right-click menu
      if (grader) {
        const finalGrade = calculateFinalGrade(grader);
        const totalPoints = calculateAssignmentPoints(assignment.content);
        const isReviewed = !!grader.reviewed_at;

        const isChangingGrade = changeGradeState?.graderId === grader.id;

        return (
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="w-full h-full flex items-center justify-center">
                {isChangingGrade ? (
                  <input
                    autoFocus
                    type="number"
                    step="any"
                    value={changeGradeState.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setChangeGradeState({ ...changeGradeState!, value: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        cancelRef.current = true;
                        setChangeGradeState(null);
                      } else if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={() => {
                      if (!cancelRef.current) {
                        const val = parseFloat(changeGradeState.value);
                        if (!isNaN(val)) onChangeGrade(grader.id, val - changeGradeState.baseScore);
                      }
                      cancelRef.current = false;
                      setChangeGradeState(null);
                    }}
                    className="w-16 text-center text-sm border border-primary rounded px-1 py-0.5 bg-background text-foreground outline-none focus:ring-1 focus:ring-primary"
                  />
                ) : (
                  <span
                    className={`text-sm font-medium flex items-center gap-0.5 cursor-text hover:opacity-75 transition-opacity ${isReviewed ? "text-green-600 dark:text-green-400" : "text-blue-600 dark:text-blue-400"}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      const baseScore = (Number(grader.raw_assignment_score) || 0) + (Number(grader.raw_rubric_score) || 0);
                      setChangeGradeState({ graderId: grader.id, value: String(finalGrade), baseScore });
                    }}
                  >
                    <span>{finalGrade}</span>
                    <span className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity text-xs">
                      /{totalPoints}
                    </span>
                  </span>
                )}
                <span className={`absolute top-1 right-1 text-[9px] font-bold px-1 py-0.5 rounded leading-none ${
                  isReviewed
                    ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
                    : "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300"
                }`}>
                  {isReviewed ? "Reviewed" : "Submitted"}
                </span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuLabel>
                {student.firstName} {student.lastName}
              </ContextMenuLabel>
              <ContextMenuSeparator />
              {!isReviewed && (
                <ContextMenuItem
                  className="text-green-700 dark:text-green-400 focus:text-green-700 dark:focus:text-green-400"
                  onClick={(e) => { e.stopPropagation(); onMarkReviewed(grader.id); }}
                >
                  Mark as Reviewed
                </ContextMenuItem>
              )}
              <ContextMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  const baseScore = (Number(grader.raw_assignment_score) || 0) + (Number(grader.raw_rubric_score) || 0);
                  setChangeGradeState({ graderId: grader.id, value: String(finalGrade), baseScore });
                }}
              >
                Change Grade
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      }

      // Otherwise, show status label
      const status = getSubmissionStatus(submission || null, hasGrader);
      return (
        <span className={`${status.color} text-xs font-semibold`}>
          {status.label}
        </span>
      );
    };

    return (
      <TooltipProvider>
        <div className="w-full overflow-hidden border border-border rounded-lg shadow-sm bg-card">
          <div className="overflow-auto max-h-[calc(100vh-240px)]">
            <table className="w-full border-separate border-spacing-0">
              <thead>
                <tr className="bg-gradient-to-r from-primary/10 to-muted">
                  <th className="sticky top-0 left-0 z-30 bg-muted px-6 py-2 text-left text-sm font-bold text-foreground border-b-2 border-r-2 border-border min-w-[220px]">
                    Student Name
                  </th>
                  {assignments.map((assignment) => (
                    <th
                      key={assignment.id}
                      className="sticky top-0 z-10 bg-muted px-4 py-2 text-center text-sm font-semibold text-foreground border-b-2 border-border min-w-[140px]"
                    >
                      <div className="flex flex-col gap-1 items-center">
                        <button
                          onClick={() => onHeaderClick(assignment.id)}
                          className="truncate max-w-[150px] font-bold hover:underline cursor-pointer text-foreground"
                          title={assignment.name}
                        >
                          {assignment.name}
                        </button>
                        <span className="text-xs text-muted-foreground font-medium">
                          Out of {calculateAssignmentPoints(assignment.content)}
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
                    <td className={`sticky left-0 z-10 px-6 py-2 text-sm font-semibold text-foreground border-b border-r-2 border-border ${index % 2 === 0 ? "bg-card" : "bg-muted"}`}>
                      {student.lastName}, {student.firstName}
                    </td>
                    {assignments.map((assignment) => (
                      <td
                        key={`${student.userId}_${assignment.id}`}
                        className="group relative px-4 py-2 text-center border-b border-border cursor-pointer hover:bg-primary/10 hover:shadow-inner transition-all duration-150"
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
      </TooltipProvider>
    );
  }
);

GradebookTable.displayName = "GradebookTable";

export default GradebookTable;
