import React, { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, Clock, Loader2 } from "lucide-react";
import { Assignment, Grader, StudentSubmissionInfo } from "../../../types";
import AssignmentViewer from "./AssignmentViewer";
import { GradingControls } from "./grader/GradingControls";
import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useToast } from "../../../hooks/use-toast";

interface StudentSubmissionViewProps {
  student: StudentSubmissionInfo;
  assignment: Assignment;
  courseId: string;
  onNavigatePrevious: () => void;
  onNavigateNext: () => void;
  hasPrevious: boolean;
  hasNext: boolean;
  onGraderUpdate: (graderId: string, updates: Partial<Grader>) => Promise<void>;
}

export const StudentSubmissionView: React.FC<StudentSubmissionViewProps> = ({
  student,
  assignment,
  courseId,
  onNavigatePrevious,
  onNavigateNext,
  hasPrevious,
  hasNext,
  onGraderUpdate,
}) => {
  const { toast } = useToast();

  // State for selected submission
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string>(
    student.latestSubmission?.id || ""
  );

  // State for tracking if we're saving before navigation
  const [isSavingBeforeNav, setIsSavingBeforeNav] = useState(false);

  // State for the current grader (may be updated by GradingControls)
  const [currentGrader, setCurrentGrader] = useState<any>(student.grader);

  // Debug logging
  console.log("[StudentSubmissionView] Student grader:", {
    grader: student.grader,
    hasBlockScores: !!student.grader?.block_scores,
    blockScores: student.grader?.block_scores,
  });

  // Ref to track pending grader updates
  const pendingUpdatesRef = useRef<Partial<Grader> | null>(null);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update selected submission when student changes
  useEffect(() => {
    setSelectedSubmissionId(student.latestSubmission?.id || "");
  }, [student.userId, student.latestSubmission?.id]);

  // Update current grader when student.grader changes
  useEffect(() => {
    setCurrentGrader(student.grader);
  }, [student.grader]);

  // Get the currently selected submission
  const selectedSubmission = student.submissions.find(
    (sub) => sub.id === selectedSubmissionId
  );

  // Get grader for selected submission
  // Note: For autograded submissions, grader_id may be null, so we use currentGrader
  const selectedGrader = currentGrader;

  // Handle grader updates with debouncing
  const handleGraderUpdate = async (updates: Partial<Grader>) => {
    // Store pending updates
    pendingUpdatesRef.current = {
      ...pendingUpdatesRef.current,
      ...updates,
    };

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    // Set new timeout for auto-save
    saveTimeoutRef.current = setTimeout(async () => {
      if (selectedGrader?.id && pendingUpdatesRef.current) {
        try {
          await onGraderUpdate(selectedGrader.id, pendingUpdatesRef.current);
          pendingUpdatesRef.current = null;
        } catch (error) {
          console.error("Failed to save grader updates:", error);
        }
      }
    }, 500);
  };

  // Save pending changes before navigation
  const savePendingChanges = async (): Promise<boolean> => {
    if (!pendingUpdatesRef.current || !selectedGrader?.id) {
      return true; // No pending changes
    }

    setIsSavingBeforeNav(true);
    try {
      // Clear the timeout to prevent double-save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }

      await onGraderUpdate(selectedGrader.id, pendingUpdatesRef.current);
      pendingUpdatesRef.current = null;
      return true;
    } catch (error) {
      console.error("Failed to save pending changes:", error);
      toast({
        title: "Save failed",
        description: "Failed to save grading changes. Please try again.",
        variant: "destructive",
      });
      return false;
    } finally {
      setIsSavingBeforeNav(false);
    }
  };

  // Handle navigation with auto-save
  const handleNavigatePrevious = async () => {
    const saved = await savePendingChanges();
    if (saved) {
      onNavigatePrevious();
    }
  };

  const handleNavigateNext = async () => {
    const saved = await savePendingChanges();
    if (saved) {
      onNavigateNext();
    }
  };

  // Handle submission selection change
  const handleSubmissionChange = (submissionId: string) => {
    setSelectedSubmissionId(submissionId);
  };

  // Format timestamp for display
  const formatTimestamp = (timestamp: Date | string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Navigation Header */}
      <div className="border-b border-border bg-card px-6 py-4 shadow-sm">
        <div className="flex items-center justify-between">
          {/* Previous Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleNavigatePrevious}
            disabled={!hasPrevious || isSavingBeforeNav}
            className="flex items-center gap-2 hover:bg-primary/10 hover:border-primary/30 transition-colors"
          >
            {isSavingBeforeNav ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
            <span className="font-medium">Previous</span>
          </Button>

          {/* Student Name */}
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-foreground">
              {student.lastName}, {student.firstName}
            </h2>
            {isSavingBeforeNav && (
              <span className="text-sm text-purple-600 font-medium flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving...
              </span>
            )}
          </div>

          {/* Next Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleNavigateNext}
            disabled={!hasNext || isSavingBeforeNav}
            className="flex items-center gap-2 hover:bg-primary/10 hover:border-primary/30 transition-colors"
          >
            <span className="font-medium">Next</span>
            {isSavingBeforeNav ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Submission Selector - Only show if multiple submissions */}
      {student.submissions.length > 1 && (
        <div className="border-b border-border bg-card px-6 py-3 shadow-sm">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold text-foreground">
              Submission:
            </span>
            <Select
              value={selectedSubmissionId}
              onValueChange={handleSubmissionChange}
            >
              <SelectTrigger className="w-[320px]">
                <SelectValue placeholder="Select submission" />
              </SelectTrigger>
              <SelectContent>
                {student.submissions.map((submission, index) => {
                  const isLatest = index === 0;
                  const label = isLatest
                    ? "Latest Submission"
                    : `Submission ${student.submissions.length - index}`;

                  return (
                    <SelectItem key={submission.id} value={submission.id}>
                      <div className="flex flex-col py-1">
                        <span className="font-semibold text-foreground">
                          {label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatTimestamp(submission.timestamp)}
                        </span>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Content Area - Scrollable */}
      <div className="flex-1 overflow-y-auto bg-background">
        <div className="max-w-4xl mx-auto p-6 space-y-6">
          {/* Assignment Viewer - Always show, even without submission */}
          <div className="bg-card rounded-lg shadow-sm border border-border p-6">
            <AssignmentViewer
              assignment={assignment}
              submissionId={selectedSubmission?.id || null}
              submissionStatus={selectedSubmission?.status || null}
              submissionTimestamp={selectedSubmission?.timestamp || null}
              isStudent={false}
              studentId={student.userId}
              locked={true}
              grader={selectedGrader}
            />
          </div>

          {/* Grading Controls - Always show, will handle null grader */}
          <GradingControls
            grader={selectedGrader}
            assignmentId={assignment.id}
            studentId={student.userId}
            courseId={courseId}
            onUpdate={handleGraderUpdate}
            onGraderCreated={setCurrentGrader}
            autoSave={false}
          />
        </div>
      </div>
    </div>
  );
};
