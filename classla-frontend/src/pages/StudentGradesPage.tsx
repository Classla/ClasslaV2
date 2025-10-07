import React, { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { apiClient } from "../lib/api";
import { useStudentGrades } from "../hooks/useGradingQueries";
import { Submission, Grader } from "../types";
import GradeItem from "../components/GradeItem";
import GradeItemSkeleton from "../components/GradeItemSkeleton";
import { Alert, AlertDescription } from "../components/ui/alert";

const StudentGradesPage: React.FC = () => {
  const { courseSlug } = useParams<{ courseSlug: string }>();
  const navigate = useNavigate();

  const [courseId, setCourseId] = useState<string | null>(null);
  const [courseError, setCourseError] = useState<string | null>(null);

  // Fetch course ID from slug
  useEffect(() => {
    const fetchCourse = async () => {
      if (!courseSlug) return;

      try {
        const response = await apiClient.getCourseBySlug(courseSlug);
        setCourseId(response.data.id);
      } catch (err: any) {
        console.error("Error fetching course:", err);
        setCourseError("Failed to load course information");
      }
    };

    fetchCourse();
  }, [courseSlug]);

  // Fetch student grades data using React Query
  const {
    data,
    isLoading: isLoadingGrades,
    error: gradesError,
  } = useStudentGrades(courseId || "");

  const isLoading = !courseId || isLoadingGrades;
  const error =
    courseError || (gradesError ? (gradesError as any).message : null);

  // Loading state
  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8 bg-gray-50 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">My Grades</h1>
          <div className="space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <GradeItemSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="container mx-auto px-4 py-8 bg-gray-50 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">My Grades</h1>
          <div className="bg-white border border-red-200 rounded-lg p-8 shadow-sm">
            <Alert variant="destructive" className="mb-4">
              <AlertDescription className="text-base">{error}</AlertDescription>
            </Alert>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors font-semibold"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Empty state
  if (!data || data.assignments.length === 0) {
    return (
      <div className="container mx-auto px-4 py-8 bg-gray-50 min-h-screen">
        <div className="max-w-4xl mx-auto">
          <h1 className="text-3xl font-bold text-gray-900 mb-8">My Grades</h1>
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="mb-4 text-gray-300">
              <svg
                className="w-20 h-20 mx-auto"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <p className="text-gray-700 text-xl font-semibold mb-2">
              No assignments available yet
            </p>
            <p className="text-gray-500 text-base">
              Check back later for assignments and grades
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Helper function to get the most recent submission for an assignment (memoized)
  const getMostRecentSubmission = useMemo(() => {
    return (assignmentId: string): Submission | null => {
      if (!data) return null;

      const assignmentSubmissions = data.submissions.filter(
        (sub) => sub.assignment_id === assignmentId
      );

      if (assignmentSubmissions.length === 0) return null;

      // Submissions are already sorted by timestamp descending from backend
      return assignmentSubmissions[0];
    };
  }, [data]);

  // Helper function to get grader for a submission (memoized)
  const getGraderForSubmission = useMemo(() => {
    return (submissionId: string): Grader | null => {
      if (!data) return null;

      return (
        data.graders.find((grader) => grader.submission_id === submissionId) ||
        null
      );
    };
  }, [data]);

  // Sort assignments by due date or order_index (memoized)
  const sortedAssignments = useMemo(() => {
    if (!data) return [];

    return [...data.assignments].sort((a, b) => {
      // Try to get due dates for comparison
      const aDueDateKeys = Object.keys(a.due_dates_map || {});
      const bDueDateKeys = Object.keys(b.due_dates_map || {});

      if (aDueDateKeys.length > 0 && bDueDateKeys.length > 0) {
        const aDueDate = new Date(a.due_dates_map[aDueDateKeys[0]]);
        const bDueDate = new Date(b.due_dates_map[bDueDateKeys[0]]);
        return aDueDate.getTime() - bDueDate.getTime();
      }

      // Fall back to order_index
      return a.order_index - b.order_index;
    });
  }, [data]);

  // Handle navigation to assignment
  const handleAssignmentClick = (assignmentId: string) => {
    navigate(`/course/${courseSlug}/assignment/${assignmentId}`);
  };

  return (
    <div className="container mx-auto px-4 py-8 bg-gray-50 min-h-screen">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">My Grades</h1>
          <p className="text-gray-600">
            View your grades and feedback for all assignments
          </p>
        </div>
        <div className="space-y-4">
          {sortedAssignments.map((assignment) => {
            const submission = getMostRecentSubmission(assignment.id);
            const grader = submission
              ? getGraderForSubmission(submission.id)
              : null;

            return (
              <GradeItem
                key={assignment.id}
                assignment={assignment}
                submission={submission}
                grader={grader}
                onClick={() => handleAssignmentClick(assignment.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default StudentGradesPage;
