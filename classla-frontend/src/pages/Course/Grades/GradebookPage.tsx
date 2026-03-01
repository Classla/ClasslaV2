import React, { useState, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "../../../hooks/use-toast";
import {
  useCourseGradebook,
  useCourseSections,
  useGradebookUpdates,
} from "../../../hooks/useGradingQueries";
import GradebookTable from "./components/GradebookTable";
import GradebookTableSkeleton from "./components/GradebookTableSkeleton";
import AssignmentFilterTree from "./components/AssignmentFilterTree";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Course, Submission, Grader, Section, UserRole } from "../../../types";
import { apiClient } from "../../../lib/api";
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
  const queryClient = useQueryClient();

  // Check if TA has canViewGrades permission
  const canViewGrades = isInstructor && (
    userRole !== UserRole.TEACHING_ASSISTANT ||
    hasTAPermission(course ?? null, user?.id, userRole, "canViewGrades")
  );

  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null
  );
  const [selectedAssignmentIds, setSelectedAssignmentIds] = useState<Set<string> | null>(null);

  // Fetch gradebook data using React Query
  const {
    data: gradebookData,
    isLoading: isLoadingGradebook,
    error: gradebookError,
  } = useCourseGradebook(course?.id || "", !!course?.id && !!canViewGrades);

  // Fetch sections using React Query
  const { data: sectionsData } = useCourseSections(course?.id || "");

  // Subscribe to real-time gradebook updates via WebSocket
  useGradebookUpdates(course?.id || "");

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

  // Filter students by selected section and sort by last name, first name (memoized)
  const filteredStudents = useMemo(() => {
    if (!gradebookData) return [];
    let students = gradebookData.students;
    if (selectedSectionId === "no-section") {
      students = students.filter((s) => !s.sectionId);
    } else if (selectedSectionId) {
      students = students.filter((s) => s.sectionId === selectedSectionId);
    }
    return [...students].sort((a, b) => {
      const lastCmp = (a.lastName || "").localeCompare(b.lastName || "");
      if (lastCmp !== 0) return lastCmp;
      return (a.firstName || "").localeCompare(b.firstName || "");
    });
  }, [gradebookData, selectedSectionId]);

  // Filter assignments by selected folder/assignment filter
  const filteredAssignments = useMemo(() => {
    if (!gradebookData) return [];
    if (selectedAssignmentIds === null) return gradebookData.assignments;
    return gradebookData.assignments.filter((a) => selectedAssignmentIds.has(a.id));
  }, [gradebookData, selectedAssignmentIds]);

  // Convert submissions and graders to Maps for efficient lookup (memoized)
  const submissionsMap = useMemo(() => {
    if (!gradebookData) return new Map<string, Submission>();

    const map = new Map<string, Submission>();
    gradebookData.submissions.forEach((submission) => {
      const key = `${submission.student_id}_${submission.assignment_id}`;
      const existing = map.get(key);
      // Keep the latest submission by timestamp
      if (!existing || new Date(submission.timestamp) > new Date(existing.timestamp)) {
        map.set(key, submission);
      }
    });
    return map;
  }, [gradebookData]);

  const submissionCountMap = useMemo(() => {
    if (!gradebookData) return new Map<string, number>();
    const map = new Map<string, number>();
    gradebookData.submissions.forEach((submission) => {
      const key = `${submission.student_id}_${submission.assignment_id}`;
      map.set(key, (map.get(key) || 0) + 1);
    });
    return map;
  }, [gradebookData]);

  const inProgressAfterSubmitMap = useMemo(() => {
    if (!gradebookData) return new Map<string, boolean>();
    const groups = new Map<string, Submission[]>();
    gradebookData.submissions.forEach((s) => {
      const key = `${s.student_id}_${s.assignment_id}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(s);
    });
    const map = new Map<string, boolean>();
    groups.forEach((subs, key) => {
      const sorted = [...subs].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const hasOlderSubmitted = sorted.slice(1).some(
        (s) => s.status === "submitted" || s.status === "graded"
      );
      if (sorted[0]?.status === "in-progress" && hasOlderSubmitted) {
        map.set(key, true);
      }
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

  const handleMarkReviewed = useCallback(async (graderId: string) => {
    const previousData = queryClient.getQueryData(["gradebook", course?.id]);
    queryClient.setQueryData(["gradebook", course?.id], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        graders: old.graders.map((g: Grader) =>
          g.id === graderId ? { ...g, reviewed_at: new Date().toISOString() } : g
        ),
      };
    });
    try {
      await apiClient.updateGrader(graderId, { reviewed_at: new Date() } as any);
    } catch (err: any) {
      queryClient.setQueryData(["gradebook", course?.id], previousData);
      toast({ title: "Failed to mark as reviewed", description: err.message, variant: "destructive" });
    }
  }, [queryClient, course?.id, toast]);

  const handleChangeGrade = useCallback(async (graderId: string, modifier: number) => {
    const previousData = queryClient.getQueryData(["gradebook", course?.id]);
    queryClient.setQueryData(["gradebook", course?.id], (old: any) => {
      if (!old) return old;
      return {
        ...old,
        graders: old.graders.map((g: Grader) =>
          g.id === graderId ? { ...g, score_modifier: String(modifier) } : g
        ),
      };
    });
    try {
      await apiClient.autoSaveGrader(graderId, { score_modifier: String(modifier) });
    } catch (err: any) {
      queryClient.setQueryData(["gradebook", course?.id], previousData);
      toast({ title: "Failed to update grade", description: err.message, variant: "destructive" });
    }
  }, [queryClient, course?.id, toast]);

  // Handle header click - navigate to assignment without opening grader
  const handleHeaderClick = (assignmentId: string) => {
    if (!course?.slug) return;
    navigate(`/course/${course.slug}/assignment/${assignmentId}`);
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="p-8 bg-background min-h-screen">
        <div className="mb-8">
          <div className="animate-pulse">
            <div className="h-9 bg-accent rounded w-48 mb-2"></div>
            <div className="h-5 bg-accent rounded w-64"></div>
          </div>
        </div>
        <GradebookTableSkeleton />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-8 bg-background min-h-screen">
        <div className="text-center py-16 bg-card rounded-lg border border-red-200 shadow-sm max-w-2xl mx-auto">
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
          <h3 className="text-xl font-bold text-foreground mb-3">
            Error Loading Gradebook
          </h3>
          <p className="text-muted-foreground mb-8 px-6">{error}</p>
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
      <div className="p-8 bg-background min-h-screen">
        <div className="text-center py-16 bg-card rounded-lg border border-border shadow-sm max-w-2xl mx-auto">
          <div className="mb-4 text-muted-foreground">
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
          <h3 className="text-xl font-bold text-foreground mb-3">
            No Gradebook Data
          </h3>
          <p className="text-muted-foreground px-6">
            There is no gradebook data available for this course yet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 bg-background min-h-screen">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-foreground mb-2">Gradebook</h1>
            <p className="text-muted-foreground">
              View and manage grades for all students
            </p>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Assignment/Folder Filter */}
            {gradebookData && gradebookData.assignments.length > 0 && (
              <AssignmentFilterTree
                assignments={gradebookData.assignments}
                selectedAssignmentIds={selectedAssignmentIds}
                onSelectionChange={setSelectedAssignmentIds}
              />
            )}

            {/* Section Filter */}
            {sections.length > 0 && (
              <Select
                value={selectedSectionId || "all"}
                onValueChange={(value) =>
                  setSelectedSectionId(value === "all" ? null : value)
                }
              >
                <SelectTrigger
                  id="section-filter"
                  className="w-auto gap-2 px-4 py-2 text-sm font-medium bg-card border border-border rounded-lg hover:bg-accent transition-colors text-foreground h-auto"
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
                  {gradebookData?.students.some((s) => !s.sectionId) && (
                    <SelectItem value="no-section">No section</SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
      </div>

      {/* Gradebook Table */}
      {filteredStudents.length === 0 ? (
        <div className="text-center py-16 bg-card rounded-lg border border-border shadow-sm">
          <div className="mb-4 text-muted-foreground">
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
          <p className="text-foreground font-semibold text-lg mb-2">
            {selectedSectionId === "no-section"
              ? "No students without a section"
              : selectedSectionId
              ? "No students found in the selected section"
              : "No students enrolled yet"}
          </p>
          <p className="text-muted-foreground">
            {selectedSectionId
              ? "Try selecting a different section"
              : "Students will appear here once they enroll in the course"}
          </p>
        </div>
      ) : (
        <GradebookTable
          students={filteredStudents}
          assignments={filteredAssignments}
          submissions={submissionsMap}
          graders={gradersMap}
          submissionCounts={submissionCountMap}
          inProgressAfterSubmit={inProgressAfterSubmitMap}
          onCellClick={handleCellClick}
          onHeaderClick={handleHeaderClick}
          onMarkReviewed={handleMarkReviewed}
          onChangeGrade={handleChangeGrade}
        />
      )}
    </div>
  );
};

export default GradebookPage;
