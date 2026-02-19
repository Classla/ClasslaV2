import React, { useState, useMemo, useEffect, useCallback } from "react";
import { Assignment } from "../../../../types";
import { Button } from "../../../../components/ui/button";
import { Input } from "../../../../components/ui/input";
import { ArrowLeft, ChevronLeft, ChevronRight, Search, Loader2 } from "lucide-react";
import { GradingControls } from "./GradingControls";
import {
  useSubmissionsWithStudents,
  useCourseSections,
  useAutoSaveGrader,
} from "../../../../hooks/useGradingQueries";
import { useToast } from "../../../../hooks/use-toast";
import { useDebounce } from "../../../../hooks/useDebounce";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../../components/ui/select";
import { getSubmissionStatus } from "../../../../utils/submissionStatus";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    null
  );

  const debouncedSearchQuery = useDebounce(searchQuery, 300);

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

        if (
          (hadNoGrader && nowHasGrader) ||
          graderIdChanged ||
          blockScoresAdded
        ) {
          console.log(
            "[GradingSidebar] Updating selected student with new grader:",
            {
              grader: updatedStudent.grader,
              hasBlockScores: !!updatedStudent.grader?.block_scores,
              blockScores: updatedStudent.grader?.block_scores,
            }
          );
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

    filtered.sort((a, b) => {
      const lastNameA = a.lastName?.toLowerCase() || "";
      const lastNameB = b.lastName?.toLowerCase() || "";
      return lastNameA.localeCompare(lastNameB);
    });

    return filtered;
  }, [students, debouncedSearchQuery, selectedSectionId]);

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {(() => {
            const activeSubmission = selectedSubmissionId
              ? selectedStudent.submissions.find((s: any) => s.id === selectedSubmissionId)
              : null;
            const activeGrader = activeSubmission?._grader ?? selectedStudent.grader;
            const activeSubmissionIdForControls = selectedSubmissionId || selectedStudent.latestSubmission?.id;
            return (
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
            );
          })()}
        </div>
      </div>
    );
  }

  // Show student list
  return (
    <div className="h-full flex flex-col">
      <div className="p-4 space-y-3 border-b">
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
                student.latestSubmission?.grade !== null &&
                student.latestSubmission?.grade !== undefined;
              const isReviewed =
                student.grader?.reviewed_at !== null &&
                student.grader?.reviewed_at !== undefined;

              return (
                <button
                  key={student.userId}
                  onClick={() => onStudentSelect(student)}
                  className="w-full p-4 text-left hover:bg-accent transition-colors flex items-start justify-between"
                >
                  <div className="flex-1">
                    <div className="font-medium text-foreground">
                      {student.lastName}, {student.firstName}
                      {student.submissions.length > 1 && (
                        <span className="ml-2 text-xs bg-accent text-muted-foreground rounded-full px-1.5 py-0.5">
                          {student.submissions.length} submissions
                        </span>
                      )}
                    </div>
                    <div className={`text-sm mt-1 ${status.color}`}>
                      {status.label}
                      {hasGrade && ` • ${student.latestSubmission.grade}`}
                    </div>
                  </div>
                  {isReviewed && (
                    <div className="ml-2 flex-shrink-0">
                      <svg
                        className="w-5 h-5 text-green-600"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                  )}
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
