import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Assignment } from "../../../../types";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { Skeleton } from "../../../../components/ui/skeleton";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Circle, Eye, EyeOff, RefreshCw, Search } from "lucide-react";
import { GradingControls } from "./GradingControls";
import { RerunAutograderModal } from "./RerunAutograderModal";
import {
  useSubmissionsWithStudents,
  useCourseSections,
  useAutoSaveGrader,
  useSubmissionUpdates,
} from "../../../../hooks/useGradingQueries";
import { useToast } from "../../../../hooks/use-toast";
import { useDebounce } from "../../../../hooks/useDebounce";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../../../lib/api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { getSubmissionStatus } from "../../../../utils/submissionStatus";
import { calculateAssignmentPoints } from "../../../../utils/assignmentPoints";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../../components/ui/tooltip";

interface StudentSubmissionInfo {
  userId: string;
  firstName: string;
  lastName: string;
  sectionId: string | null;
  sectionName: string | null;
  submissions: any[];
  latestSubmission: any | null;
  grader: any | null;
}

interface GradingSidebarProps {
  assignment: Assignment;
  courseId: string;
  onStudentSelect: (student: StudentSubmissionInfo | null) => void;
  selectedStudent: StudentSubmissionInfo | null;
  selectedSubmissionId?: string;
  initialStudentId?: string;
}

const GradingSidebar: React.FC<GradingSidebarProps> = ({
  assignment,
  courseId,
  onStudentSelect,
  selectedStudent,
  selectedSubmissionId,
  initialStudentId,
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null
  );
  const [isRerunModalOpen, setIsRerunModalOpen] = useState(false);
  const [isSubmittingForStudent, setIsSubmittingForStudent] = useState(false);
  const [showGrades, setShowGrades] = useState(false);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>("all");
  // Optimistic reviewed state: studentId -> boolean override
  const [reviewedOverrides, setReviewedOverrides] = useState<Record<string, boolean>>({});

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

  // Subscribe to real-time submission updates
  useSubmissionUpdates(assignment.id, courseId);

  // Fetch data
  const {
    data: submissionsData,
    isLoading: isLoadingSubmissions,
    error: submissionsError,
  } = useSubmissionsWithStudents(assignment.id);

  const { data: sectionsData, isLoading: isLoadingSections } =
    useCourseSections(courseId);

  const autoSaveGraderMutation = useAutoSaveGrader();

  const isLoading = isLoadingSubmissions || isLoadingSections;
  const error = submissionsError ? (submissionsError as any).message : null;

  // Process submissions into students - now includes ALL enrolled students
  const students = useMemo(() => {
    if (!submissionsData) return [];

    const studentMap = new Map<string, StudentSubmissionInfo>();

    submissionsData.forEach((item: any) => {
      const studentId = item.student?.id;
      if (!studentId) return;

      console.log("[GradingSidebar] Processing submission item:", {
        studentId,
        hasSubmission: !!item.submission,
        hasGrader: !!item.grader,
        grader: item.grader,
        hasBlockScores: !!item.grader?.block_scores,
        blockScores: item.grader?.block_scores,
      });

      // Create entry for every student, even if submission is null
      if (!studentMap.has(studentId)) {
        studentMap.set(studentId, {
          userId: studentId,
          firstName: item.student.firstName || "",
          lastName: item.student.lastName || "",
          sectionId: item.sectionId,
          sectionName: item.sectionName,
          submissions: [],
          latestSubmission: null,
          grader: null,
        });
      }

      const studentInfo = studentMap.get(studentId)!;

      // Only add submission if it exists (not null)
      if (item.submission) {
        // Attach grader to submission for later lookup
        studentInfo.submissions.push({ ...item.submission, _grader: item.grader });

        // Track latest submission by timestamp
        if (
          !studentInfo.latestSubmission ||
          new Date(item.submission.timestamp) > new Date(studentInfo.latestSubmission.timestamp)
        ) {
          studentInfo.latestSubmission = item.submission;
          studentInfo.grader = item.grader;
        }
      }
    });

    // Sort submissions by timestamp descending (latest first)
    studentMap.forEach((studentInfo) => {
      studentInfo.submissions.sort((a: any, b: any) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    });

    return Array.from(studentMap.values());
  }, [submissionsData]);

  const sections = sectionsData || [];
  const totalPossiblePoints = useMemo(
    () => calculateAssignmentPoints(assignment.content),
    [assignment.content]
  );

  // Update selected student when students data changes (e.g., after grader is created or updated)
  useEffect(() => {
    if (selectedStudent && students.length > 0) {
      const updatedStudent = students.find(
        (s) => s.userId === selectedStudent.userId
      );
      if (updatedStudent) {
        // Check if grader changed from null to a value
        const hadNoGrader = !selectedStudent.grader;
        const nowHasGrader = !!updatedStudent.grader;

        // Check if grader ID changed
        const graderIdChanged =
          selectedStudent.grader?.id !== updatedStudent.grader?.id;

        // Check if block_scores were added (for autograding)
        const hadNoBlockScores = !selectedStudent.grader?.block_scores;
        const nowHasBlockScores = !!updatedStudent.grader?.block_scores;
        const blockScoresAdded = hadNoBlockScores && nowHasBlockScores;

        // Check if the latest submission status changed
        const latestStatusChanged =
          selectedStudent.latestSubmission?.status !== updatedStudent.latestSubmission?.status;

        if (
          (hadNoGrader && nowHasGrader) ||
          graderIdChanged ||
          blockScoresAdded ||
          latestStatusChanged
        ) {
          onStudentSelect(updatedStudent);
        }
      }
    }
  }, [students, selectedStudent, onStudentSelect]);

  // Auto-select student when arriving via gradebook cell click
  useEffect(() => {
    if (initialStudentId && students.length > 0 && !selectedStudent) {
      const student = students.find((s) => s.userId === initialStudentId);
      if (student) onStudentSelect(student);
    }
  }, [initialStudentId, students, selectedStudent, onStudentSelect]);

  // Filter students
  const filteredStudents = useMemo(() => {
    let filtered = [...students];

    if (debouncedSearchQuery.trim()) {
      const query = debouncedSearchQuery.toLowerCase().trim();
      filtered = filtered.filter((student) => {
        const firstName = student.firstName?.toLowerCase() || "";
        const lastName = student.lastName?.toLowerCase() || "";
        return firstName.includes(query) || lastName.includes(query);
      });
    }

    if (selectedSectionId) {
      filtered = filtered.filter(
        (student) => student.sectionId === selectedSectionId
      );
    }

    if (selectedStatusFilter !== "all") {
      filtered = filtered.filter((student) => {
        switch (selectedStatusFilter) {
          case "not-started":
            return !student.latestSubmission;
          case "in-progress":
            return student.latestSubmission?.status === "in-progress";
          case "submitted":
            return student.latestSubmission?.status === "submitted" || student.latestSubmission?.status === "graded";
          case "reviewed":
            return !!student.grader?.reviewed_at;
          default:
            return true;
        }
      });
    }

    filtered.sort((a, b) => {
      const lastNameA = a.lastName?.toLowerCase() || "";
      const lastNameB = b.lastName?.toLowerCase() || "";
      return lastNameA.localeCompare(lastNameB);
    });

    return filtered;
  }, [students, debouncedSearchQuery, selectedSectionId, selectedStatusFilter]);

  // Student navigation
  const currentStudentIndex = useMemo(() => {
    if (!selectedStudent) return -1;
    return filteredStudents.findIndex((s) => s.userId === selectedStudent.userId);
  }, [filteredStudents, selectedStudent]);

  const hasPrevStudent = currentStudentIndex > 0;
  const hasNextStudent = currentStudentIndex >= 0 && currentStudentIndex < filteredStudents.length - 1;

  const goToPrevStudent = useCallback(() => {
    if (hasPrevStudent) {
      onStudentSelect(filteredStudents[currentStudentIndex - 1]);
    }
  }, [hasPrevStudent, filteredStudents, currentStudentIndex, onStudentSelect]);

  const goToNextStudent = useCallback(() => {
    if (hasNextStudent) {
      onStudentSelect(filteredStudents[currentStudentIndex + 1]);
    }
  }, [hasNextStudent, filteredStudents, currentStudentIndex, onStudentSelect]);

  // Keyboard navigation (arrow keys)
  useEffect(() => {
    if (!selectedStudent) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input, textarea, or contenteditable
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if ((e.target as HTMLElement)?.closest?.('[contenteditable="true"]')) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goToPrevStudent();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        goToNextStudent();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedStudent, goToPrevStudent, goToNextStudent]);

  // Handle teacher submit-override for a student's in-progress submission
  const handleSubmitForStudent = async (submissionId: string) => {
    setIsSubmittingForStudent(true);
    try {
      await apiClient.submitSubmissionOverride(submissionId);
      toast({
        title: "Submitted",
        description: "Student's submission has been submitted successfully",
        duration: 3000,
      });
      queryClient.invalidateQueries({
        queryKey: ["submissions", "with-students", assignment.id],
      });
    } catch (error: any) {
      toast({
        title: "Failed to submit",
        description: error.message || "Failed to submit on behalf of student",
        variant: "destructive",
      });
    } finally {
      setIsSubmittingForStudent(false);
    }
  };

  // Handle grader updates
  const handleGraderUpdate = async (updates: any) => {
    const activeGrader = selectedSubmissionId
      ? selectedStudent?.submissions.find((s: any) => s.id === selectedSubmissionId)?._grader
      : selectedStudent?.grader;
    if (!activeGrader?.id) return;

    try {
      await autoSaveGraderMutation.mutateAsync({
        graderId: activeGrader.id,
        updates,
      });

      toast({
        title: "Saved",
        description: "Grading changes saved successfully",
        duration: 2000,
      });
    } catch (error: any) {
      console.error("Failed to update grader:", error);
      toast({
        title: "Failed to save",
        description: error.message || "Failed to save grading changes",
        variant: "destructive",
      });
    }
  };

  // Handle toggling reviewed directly from the student list (with optimistic update)
  const handleToggleStudentReviewed = async (student: StudentSubmissionInfo, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!student.grader?.id) return;
    const currentReviewed = reviewedOverrides[student.userId] ?? !!student.grader.reviewed_at;
    const newReviewed = !currentReviewed;

    // Optimistic update — show change immediately
    setReviewedOverrides((prev) => ({ ...prev, [student.userId]: newReviewed }));

    try {
      await autoSaveGraderMutation.mutateAsync({
        graderId: student.grader.id,
        updates: { reviewed: newReviewed },
      });
      await queryClient.invalidateQueries({
        queryKey: ["submissions", "with-students", assignment.id],
      });
      // Clear override once server data has refreshed
      setReviewedOverrides((prev) => {
        const next = { ...prev };
        delete next[student.userId];
        return next;
      });
    } catch (error: any) {
      // Revert on failure
      setReviewedOverrides((prev) => {
        const next = { ...prev };
        delete next[student.userId];
        return next;
      });
      toast({
        title: "Failed to update",
        description: error.message || "Failed to update reviewed status",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-center">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  // Show grading controls if student is selected
  if (selectedStudent) {
    const activeSubmission = selectedSubmissionId
      ? selectedStudent.submissions.find((s: any) => s.id === selectedSubmissionId)
      : null;
    const activeSubmissionIdForControls = selectedSubmissionId || selectedStudent.latestSubmission?.id;
    const activeSubmissionStatus = activeSubmission?.status ?? selectedStudent.latestSubmission?.status;
    const canSubmitForStudent = activeSubmissionStatus === "in-progress" && activeSubmissionIdForControls;
    const activeGrader = activeSubmission?._grader ?? selectedStudent.grader;
    const isReviewed = !!activeGrader?.reviewed_at;

    const sortedSubs = [...selectedStudent.submissions].sort(
      (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    const isResubmittingInProgress =
      sortedSubs[0]?.status === "in-progress" &&
      sortedSubs.slice(1).some((s: any) => s.status === "submitted" || s.status === "graded");
    const totalSubmissions = selectedStudent.submissions.length;

    const handleToggleReviewed = async () => {
      await handleGraderUpdate({ reviewed: !isReviewed });
    };

    return (
      <div className="h-full flex flex-col">
        <div className="p-4 border-b space-y-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onStudentSelect(null)}
            className="justify-start px-0 h-auto text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Students
          </Button>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={goToPrevStudent}
              disabled={!hasPrevStudent}
              className="w-8 h-8 p-0 flex-shrink-0"
              title="Previous student (Left arrow)"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="flex-1 text-center min-w-0">
              <div className="font-semibold text-foreground truncate">
                {selectedStudent.firstName} {selectedStudent.lastName}
              </div>
              <div className="text-xs text-muted-foreground">
                {currentStudentIndex + 1} of {filteredStudents.length}
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={goToNextStudent}
              disabled={!hasNextStudent}
              className="w-8 h-8 p-0 flex-shrink-0"
              title="Next student (Right arrow)"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs"
            onClick={() => setIsRerunModalOpen(true)}
          >
            <RefreshCw className="w-3 h-3 mr-1.5" />
            Rerun Autograders
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!activeGrader}
            onClick={handleToggleReviewed}
            className={`w-full text-xs ${
              isReviewed
                ? "bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-800 text-white border-green-600"
                : "border-green-600 text-green-700 hover:bg-green-50 dark:text-green-400 dark:border-green-700 dark:hover:bg-green-950"
            }`}
          >
            <Check className="w-3 h-3 mr-1.5" />
            {isReviewed ? "Reviewed" : "Mark as Reviewed"}
          </Button>
        </div>
        <RerunAutograderModal
          isOpen={isRerunModalOpen}
          onClose={() => setIsRerunModalOpen(false)}
          assignment={assignment}
          students={[selectedStudent]}
        />
        <>
          {isResubmittingInProgress && (
            <div className="mx-4 mt-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
              Student has an in-progress resubmission
            </div>
          )}
          {totalSubmissions > 1 && !isResubmittingInProgress && (
            <div className="px-4 pt-2">
              <span className="text-xs text-muted-foreground">
                {totalSubmissions} submissions total
              </span>
            </div>
          )}
          {canSubmitForStudent && (
            <div className="px-4 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isSubmittingForStudent}
                className="w-full border-amber-500 text-amber-700 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950"
                onClick={() => handleSubmitForStudent(activeSubmissionIdForControls)}
              >
                {isSubmittingForStudent ? (
                  <>
                    <RefreshCw className="w-3 h-3 mr-1.5 animate-spin" />
                    Submitting...
                  </>
                ) : (
                  "Submit for Student (Override)"
                )}
              </Button>
            </div>
          )}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            <GradingControls
              grader={activeGrader}
              assignmentId={assignment.id}
              studentId={selectedStudent.userId}
              courseId={courseId}
              submissionId={activeSubmissionIdForControls}
              assignmentContent={assignment.content}
              onUpdate={handleGraderUpdate}
              autoSave={true}
            />
          </div>
        </>
      </div>
    );
  }

  // Show student list
  return (
    <div className="h-full flex flex-col">
      <div className="p-4 space-y-2 border-b">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search students..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={selectedSectionId || "all"}
          onValueChange={(value) =>
            setSelectedSectionId(value === "all" ? null : value)
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="All Sections" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sections</SelectItem>
            {sections.map((section: any) => (
              <SelectItem key={section.id} value={section.id}>
                {section.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Select
            value={selectedStatusFilter}
            onValueChange={setSelectedStatusFilter}
          >
            <SelectTrigger className="flex-1 text-xs h-8">
              <SelectValue placeholder="All Statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="not-started">Not Started</SelectItem>
              <SelectItem value="in-progress">In Progress</SelectItem>
              <SelectItem value="submitted">Submitted</SelectItem>
              <SelectItem value="reviewed">Reviewed</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => setShowGrades((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 h-8 rounded-md border text-xs font-medium transition-colors flex-shrink-0 ${
              showGrades
                ? "bg-blue-600 border-blue-600 text-white hover:bg-blue-700"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
            }`}
          >
            {showGrades ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            Grades
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredStudents.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">No students found</div>
        ) : (
          <div className="divide-y">
            {filteredStudents.map((student) => {
              const status = getSubmissionStatus(
                student.latestSubmission,
                !!student.grader
              );
              const hasGrade =
                student.grader &&
                student.grader.raw_assignment_score !== null &&
                student.grader.raw_assignment_score !== undefined;
              const isReviewed =
                reviewedOverrides[student.userId] ??
                (student.grader?.reviewed_at !== null && student.grader?.reviewed_at !== undefined);
              const canToggleReviewed = !!student.grader?.id;

              // Detect in-progress resubmission
              const sortedStudentSubs = [...student.submissions].sort(
                (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
              );
              const isStudentResubmitting =
                sortedStudentSubs[0]?.status === "in-progress" &&
                sortedStudentSubs.slice(1).some((s: any) => s.status === "submitted" || s.status === "graded");

              return (
                <button
                  key={student.userId}
                  onClick={() => onStudentSelect(student)}
                  className="w-full p-3 text-left hover:bg-accent transition-colors flex items-start justify-between gap-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-foreground text-sm truncate">
                      {student.lastName}, {student.firstName}
                      {student.submissions.length > 1 && (
                        <span className="ml-2 text-xs bg-accent text-muted-foreground rounded-full px-1.5 py-0.5">
                          {student.submissions.length}x
                        </span>
                      )}
                    </div>
                    <div className={`text-xs mt-0.5 ${isStudentResubmitting ? "text-amber-600 dark:text-amber-400" : status.color}`}>
                      {isStudentResubmitting ? "Resubmitting" : status.label}
                      {showGrades && hasGrade && (
                        <span className="ml-1.5 font-semibold text-foreground">
                          · {student.grader.raw_assignment_score}{totalPossiblePoints > 0 ? `/${totalPossiblePoints}` : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Reviewed toggle */}
                  <TooltipProvider delayDuration={400}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          onClick={(e) => handleToggleStudentReviewed(student, e)}
                          className={`flex-shrink-0 flex items-center gap-1 py-0.5 px-1 rounded transition-colors ${
                            canToggleReviewed
                              ? "cursor-pointer hover:bg-muted"
                              : "cursor-default opacity-40"
                          }`}
                        >
                          {isReviewed ? (
                            <>
                              <span className="text-xs text-green-600 font-medium">Reviewed</span>
                              <svg className="w-3.5 h-3.5 text-green-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                            </>
                          ) : (
                            <>
                              <span className="text-xs text-muted-foreground">Not reviewed</span>
                              <Circle className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
                            </>
                          )}
                        </div>
                      </TooltipTrigger>
                      {canToggleReviewed && (
                        <TooltipContent side="top" className="bg-card border-border text-foreground text-xs">
                          {isReviewed ? "Mark as unreviewed" : "Mark as reviewed"}
                        </TooltipContent>
                      )}
                    </Tooltip>
                  </TooltipProvider>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default GradingSidebar;
