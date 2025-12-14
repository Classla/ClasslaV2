import React, { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "../../../hooks/use-toast";
import {
  useCourseGradebook,
  useCourseSections,
} from "../../../hooks/useGradingQueries";
import GradebookTable from "./components/GradebookTable";
import GradebookTableSkeleton from "./components/GradebookTableSkeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Course, Submission, Grader, Section, UserRole } from "../../../types";
import { hasTAPermission } from "../../../lib/taPermissions";
import { useAuth } from "../../../contexts/AuthContext";

interface GradebookPageProps {
  course?: Course;
  userRole?: UserRole;
  isInstructor?: boolean;
}

const GradebookPage: React.FC<GradebookPageProps> = ({
  course,
  userRole,
  isInstructor,
}) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  // Check if TA has canViewGrades permission
  const canViewGrades = isInstructor && (
    userRole !== UserRole.TEACHING_ASSISTANT ||
    hasTAPermission(course ?? null, user?.id, userRole, "canViewGrades")
  );

  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null
  );

  // Fetch gradebook data using React Query
  const {
    data: gradebookData,
    isLoading: isLoadingGradebook,
    error: gradebookError,
  } = useCourseGradebook(course?.id || "", !!course?.id && !!canViewGrades);

  // Fetch sections using React Query
  const { data: sectionsData } = useCourseSections(course?.id || "");

  const sections: Section[] = sectionsData || [];
  const isLoading = isLoadingGradebook;
  const error = !canViewGrades
    ? "You don't have permission to view the gradebook"
    : gradebookError
    ? (gradebookError as any).message
    : null;

  // Show error toast if there's an error
  React.useEffect(() => {
    if (gradebookError) {
      toast({
        title: "Error loading gradebook",
        description:
          (gradebookError as any).message ||
          "Failed to load gradebook data. Please try again.",
        variant: "destructive",
      });
    }
  }, [gradebookError, toast]);

  // Filter students by selected section (memoized)
  const filteredStudents = useMemo(() => {
    if (!gradebookData) return [];

    if (!selectedSectionId) {
      return gradebookData.students;
    }

    return gradebookData.students.filter(
      (student) => student.sectionId === selectedSectionId
    );
  }, [gradebookData, selectedSectionId]);

  // Convert submissions and graders to Maps for efficient lookup (memoized)
  const submissionsMap = useMemo(() => {
    if (!gradebookData) return new Map<string, Submission>();

    const map = new Map<string, Submission>();
    gradebookData.submissions.forEach((submission) => {
      const key = `${submission.student_id}_${submission.assignment_id}`;
      map.set(key, submission);
    });
    return map;
  }, [gradebookData]);

  const gradersMap = useMemo(() => {
    if (!gradebookData) return new Map<string, Grader>();

    const map = new Map<string, Grader>();
    gradebookData.graders.forEach((grader) => {
      map.set(grader.submission_id, grader);
    });
    return map;
  }, [gradebookData]);

  // Handle cell click - navigate to assignment with grading panel open
  const handleCellClick = (studentId: string, assignmentId: string) => {
    if (!course?.slug) return;

    // Navigate to assignment page with query params to open grading panel and select student
    navigate(
      `/course/${course.slug}/assignment/${assignmentId}?grading=true&student=${studentId}`
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="p-8 bg-gray-50 min-h-screen">
        <div className="mb-8">
          <div className="animate-pulse">
            <div className="h-9 bg-gray-300 rounded w-48 mb-2"></div>
            <div className="h-5 bg-gray-200 rounded w-64"></div>
          </div>
        </div>
        <GradebookTableSkeleton />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-8 bg-gray-50 min-h-screen">
        <div className="text-center py-16 bg-white rounded-lg border border-red-200 shadow-sm max-w-2xl mx-auto">
          <div className="mb-4 text-red-500">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-3">
            Error Loading Gradebook
          </h3>
          <p className="text-gray-600 mb-8 px-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors font-semibold"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // No data state
  if (!gradebookData) {
    return (
      <div className="p-8 bg-gray-50 min-h-screen">
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200 shadow-sm max-w-2xl mx-auto">
          <div className="mb-4 text-gray-300">
            <svg
              className="w-16 h-16 mx-auto"
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
          <h3 className="text-xl font-bold text-gray-900 mb-3">
            No Gradebook Data
          </h3>
          <p className="text-gray-600 px-6">
            There is no gradebook data available for this course yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 bg-gray-50 min-h-screen">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Gradebook</h1>
            <p className="text-gray-600">
              View and manage grades for all students
            </p>
          </div>

          {/* Section Filter */}
          {sections.length > 0 && (
            <div className="flex items-center space-x-3 bg-white px-4 py-3 rounded-lg border border-gray-200 shadow-sm">
              <label
                htmlFor="section-filter"
                className="text-sm font-semibold text-gray-700"
              >
                Filter by section:
              </label>
              <Select
                value={selectedSectionId || "all"}
                onValueChange={(value) =>
                  setSelectedSectionId(value === "all" ? null : value)
                }
              >
                <SelectTrigger
                  id="section-filter"
                  className="w-[220px] border-gray-300 focus:border-purple-500 focus:ring-purple-500"
                >
                  <SelectValue placeholder="All sections" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sections</SelectItem>
                  {sections.map((section) => (
                    <SelectItem key={section.id} value={section.id}>
                      {section.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </div>

      {/* Gradebook Table */}
      {filteredStudents.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="mb-4 text-gray-300">
            <svg
              className="w-16 h-16 mx-auto"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
          </div>
          <p className="text-gray-700 font-semibold text-lg mb-2">
            {selectedSectionId
              ? "No students found in the selected section"
              : "No students enrolled yet"}
          </p>
          <p className="text-gray-500">
            {selectedSectionId
              ? "Try selecting a different section"
              : "Students will appear here once they enroll in the course"}
          </p>
        </div>
      ) : (
        <GradebookTable
          students={filteredStudents}
          assignments={gradebookData.assignments}
          submissions={submissionsMap}
          graders={gradersMap}
          onCellClick={handleCellClick}
        />
      )}
    </div>
  );
};

export default GradebookPage;
