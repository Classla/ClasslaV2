import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  startTransition,
} from "react";
import { io } from "socket.io-client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import Dropcursor from "@tiptap/extension-dropcursor";
import Gapcursor from "@tiptap/extension-gapcursor";
import Underline from "@tiptap/extension-underline";
import {
  AlertTriangle,
  RefreshCw,
  Send,
  ChevronDown,
  ChevronRight,
  Clock,
  Loader2,
} from "lucide-react";

import { Assignment } from "../../../types";
import { MCQBlockViewer } from "../../../components/extensions/MCQBlockViewer";
import { IDEBlockViewer } from "../../../components/extensions/IDEBlockViewer";
import { FillInTheBlankBlockViewer } from "../../../components/extensions/FillInTheBlankBlockViewer";
import { ShortAnswerBlockViewer } from "../../../components/extensions/ShortAnswerBlockViewer";
import { ParsonsProblemBlockViewer } from "../../../components/extensions/ParsonsProblemBlockViewer";
import { ClickableAreaBlockViewer } from "../../../components/extensions/ClickableAreaBlockViewer";
import { DragDropMatchingBlockViewer } from "../../../components/extensions/DragDropMatchingBlockViewer";
import { TabbedContentBlockViewer } from "../../../components/extensions/TabbedContentBlockViewer";
import { RevealContentBlockViewer } from "../../../components/extensions/RevealContentBlockViewer";
import { PollBlockViewer } from "../../../components/extensions/PollBlockViewer";
import { EmbedBlockViewer } from "../../../components/extensions/EmbedBlockViewer";
import { AlertBlockViewer } from "../../../components/extensions/AlertBlockViewer";
import { ImageBlockViewer } from "../../../components/extensions/ImageBlockViewer";
import { DiscussionBlockViewer } from "../../../components/extensions/DiscussionBlockViewer";
import { validateMCQData, sanitizeMCQData } from "../../../components/extensions/MCQBlock";
import { Button } from "../../../components/ui/button";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import SubmissionSuccessModal from "./SubmissionSuccessModal";
import { randomizeMCQBlocks } from "../../../utils/randomization";
import { Popover } from "../../../components/ui/popover";
import AssignmentContentSkeleton from "./AssignmentContentSkeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../../../components/ui/tooltip";

interface AssignmentViewerProps {
  assignment: Assignment;
  onAnswerChange?: (blockId: string, answer: any) => void;
  submissionId?: string | null; // Can be null when no submission exists
  submissionStatus?: string | null;
  submissionTimestamp?: Date | string | null;
  onSubmissionCreated?: (submissionId: string) => void;
  onSubmissionStatusChange?: (status: string) => void;
  isStudent?: boolean;
  courseSlug?: string;
  studentId?: string; // For deterministic randomization
  allSubmissions?: any[]; // All submissions for this student
  selectedSubmissionId?: string; // Currently selected submission
  onSubmissionSelect?: (submissionId: string) => void; // Callback when submission is selected
  locked?: boolean; // If true, viewer is read-only (for viewing submitted work)
  grader?: any; // Grader object with block_scores for displaying scores on blocks
  totalPossiblePoints?: number; // Total possible points for the assignment
  previewMode?: boolean; // If true, this is a teacher preview - disable all submissions
  userDueDate?: Date | string | null; // The student's due date for this assignment
  timedDeadline?: Date | null; // The student's personal timed deadline (from lockdown_time_map)
  isLateSubmission?: boolean; // Whether the current submission was marked late
}

// Answer state management for all block types
interface AnswerState {
  [blockId: string]: {
    selectedOptions?: string[]; // For MCQ and Poll
    answer?: string; // For Short Answer
    solution?: string[]; // For Parsons Problem (array of block IDs)
    selectedLines?: number[]; // For Clickable Area
    matches?: Record<string, string>; // For Drag-Drop Matching (itemId -> zoneId)
    answers?: Record<string, string>; // For Fill-in-the-Blank (blankId -> answer)
    timestamp: Date;
  };
}

// Session storage key for answer persistence
const getAnswerStorageKey = (assignmentId: string) =>
  `assignment_answers_${assignmentId}`;

const AssignmentViewer: React.FC<AssignmentViewerProps> = ({
  assignment,
  onAnswerChange,
  submissionId: initialSubmissionId,
  submissionStatus: initialSubmissionStatus,
  submissionTimestamp: initialSubmissionTimestamp,
  onSubmissionCreated,
  onSubmissionStatusChange,
  isStudent = false,
  courseSlug = "",
  studentId,
  allSubmissions = [],
  selectedSubmissionId,
  onSubmissionSelect,
  locked = false,
  grader,
  totalPossiblePoints,
  previewMode = false,
  userDueDate,
  timedDeadline,
  isLateSubmission = false,
}) => {
  const { toast } = useToast();
  const [answerState, setAnswerState] = useState<AnswerState>({});
  const [contentError, setContentError] = useState<string | null>(null);

  // Debug: Log grader prop
  console.log("[AssignmentViewer] Grader prop:", grader);
  console.log("[AssignmentViewer] Grader block_scores:", grader?.block_scores);
  const [isRecovering, setIsRecovering] = useState(false);
  const [submissionId, setSubmissionId] = useState<string | null | undefined>(
    initialSubmissionId
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingSubmission, setIsLoadingSubmission] = useState(false);
  const [submissionStatus, setSubmissionStatus] = useState<string>(
    initialSubmissionStatus || "in-progress"
  );
  const [submissionTimestamp, setSubmissionTimestamp] = useState<
    Date | string | null
  >(initialSubmissionTimestamp || null);
  const [autogradingFailed, setAutogradingFailed] = useState(false);
  const [isRetryingAutograde, setIsRetryingAutograde] = useState(false);

  // Track if submission exists
  const hasSubmission = !!submissionId;

  // Update internal state when props change
  useEffect(() => {
    setSubmissionId(initialSubmissionId);
  }, [initialSubmissionId]);

  useEffect(() => {
    setSubmissionStatus(initialSubmissionStatus || "in-progress");
  }, [initialSubmissionStatus]);

  useEffect(() => {
    setSubmissionTimestamp(initialSubmissionTimestamp || null);
  }, [initialSubmissionTimestamp]);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Determine if the viewer should be read-only
  const showResponsesAfterSubmission =
    assignment.settings?.showResponsesAfterSubmission ?? false;
  const showScoreAfterSubmission =
    assignment.settings?.showScoreAfterSubmission ?? false;
  const allowResubmissions = assignment.settings?.allowResubmissions ?? false;

  // When scores aren't shown and the grade hasn't been reviewed,
  // students should see "submitted" instead of "graded"
  const gradeVisibleToStudent =
    showScoreAfterSubmission || !!grader?.reviewed_at;
  const effectiveStatus =
    isStudent &&
    submissionStatus === "graded" &&
    !gradeVisibleToStudent
      ? "submitted"
      : submissionStatus;

  // True when student is submitting over a previously submitted/graded submission
  const hasPreviousSubmission = useMemo(() => {
    if (!allowResubmissions || !allSubmissions || allSubmissions.length === 0) return false;
    return allSubmissions.some(
      (s) => s.id !== submissionId && (s.status === "submitted" || s.status === "graded")
    );
  }, [allowResubmissions, allSubmissions, submissionId]);
  const allowLateSubmissions =
    assignment.settings?.allowLateSubmissions ?? false;
  const isTimedAssignment = (assignment.settings?.timeLimitSeconds ?? 0) > 0;

  // Due date enforcement — live timer fires at the exact due date moment
  const [dueDateExpired, setDueDateExpired] = useState(false);

  useEffect(() => {
    if (!userDueDate || allowLateSubmissions) {
      setDueDateExpired(false);
      return;
    }

    const due = new Date(userDueDate).getTime();
    const remaining = due - Date.now();

    if (remaining <= 0) {
      setDueDateExpired(true);
      return;
    }

    const timer = setTimeout(() => {
      setDueDateExpired(true);
    }, remaining);

    return () => clearTimeout(timer);
  }, [userDueDate, allowLateSubmissions]);

  const isPastDue = useMemo(() => {
    if (!userDueDate) return false;
    return dueDateExpired || new Date(userDueDate) < new Date();
  }, [userDueDate, dueDateExpired]);

  // Timed deadline enforcement — separate from due date
  const [timedExpired, setTimedExpired] = useState(false);

  useEffect(() => {
    if (!timedDeadline) {
      setTimedExpired(false);
      return;
    }

    const deadline = new Date(timedDeadline).getTime();
    const remaining = deadline - Date.now();

    if (remaining <= 0) {
      setTimedExpired(true);
      return;
    }

    const timer = setTimeout(() => {
      setTimedExpired(true);
    }, remaining);

    return () => clearTimeout(timer);
  }, [timedDeadline]);

  // Blocked when either the due date passed (and no late submissions) OR timed deadline expired
  const isSubmissionBlocked = (isPastDue && !allowLateSubmissions) || timedExpired;

  // ── Countdown timer ────────────────────────────────────────────────────
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [countdownDismissed, setCountdownDismissed] = useState(false);

  const formatCountdown = (seconds: number): string => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
    }
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  // For the countdown, use the earliest effective deadline
  const countdownTarget = useMemo(() => {
    if (isTimedAssignment && timedDeadline) {
      // For timed assignments, count down to min(timedDeadline, userDueDate)
      if (userDueDate) {
        const dueTime = new Date(userDueDate).getTime();
        const timedTime = new Date(timedDeadline).getTime();
        return new Date(Math.min(dueTime, timedTime));
      }
      return timedDeadline;
    }
    return userDueDate ? new Date(userDueDate) : null;
  }, [isTimedAssignment, timedDeadline, userDueDate]);

  useEffect(() => {
    if (!countdownTarget || !isStudent) {
      setTimeRemaining(null);
      return;
    }

    const due = new Date(countdownTarget).getTime();

    const tick = () => {
      const remaining = Math.floor((due - Date.now()) / 1000);
      if (remaining <= 0) {
        setTimeRemaining(null);
        return;
      }
      // For timed assignments, always show the countdown
      // For regular assignments, only show in the last 5 minutes
      if (isTimedAssignment || remaining <= 300) {
        setTimeRemaining(remaining);
      } else {
        setTimeRemaining(null);
      }
    };

    tick(); // run immediately
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [countdownTarget, isStudent, isTimedAssignment]);

  // Teacher edit mode: non-student viewing a student's existing submission (not preview)
  const isTeacherEditMode = !isStudent && !previewMode && !!submissionId;

  // Viewer is read-only when:
  // 1. Explicitly locked (viewing submitted work or instructor viewing student work)
  // 2. Past due date and late submissions not allowed
  // 3. Submission is submitted/graded and resubmissions are not allowed
  // Exception: Teachers always get edit access when viewing student submissions
  const isReadOnly = isTeacherEditMode
    ? false
    : locked ||
      isSubmissionBlocked ||
      (!allowResubmissions &&
        (submissionStatus === "submitted" || submissionStatus === "graded"));

  // Performance optimization: Use refs to avoid unnecessary re-renders
  const editorRef = useRef<any>(null);
  const answerStateRef = useRef<AnswerState>({});

  // ── Lock transition detection ──────────────────────────────────────────────
  const prevIsReadOnlyRef = useRef(isReadOnly);
  const justSubmittedRef = useRef(false);

  // Flush pending auto-save immediately
  const flushAutoSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = null;
    }
    // Save current answers immediately
    if (submissionId && isStudent) {
      const submissionValues: Record<string, string[]> = {};
      const currentAnswers = answerStateRef.current;
      Object.keys(currentAnswers).forEach((key) => {
        const state = currentAnswers[key];
        if ('answer' in state && state.answer) {
          submissionValues[key] = [state.answer];
        } else if ('selectedOptions' in state && state.selectedOptions) {
          submissionValues[key] = state.selectedOptions;
        } else if ('solution' in state && state.solution) {
          submissionValues[key] = state.solution;
        } else if ('selectedLines' in state && state.selectedLines) {
          submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
        } else if ('matches' in state && state.matches) {
          submissionValues[key] = [JSON.stringify(state.matches)];
        } else if ('answers' in state && state.answers) {
          submissionValues[key] = [JSON.stringify(state.answers)];
        }
      });
      if (Object.keys(submissionValues).length > 0) {
        apiClient.updateSubmissionValues(submissionId, submissionValues).catch(() => {});
      }
    }
  }, [submissionId, isStudent]);

  useEffect(() => {
    const wasReadOnly = prevIsReadOnlyRef.current;
    prevIsReadOnlyRef.current = isReadOnly;

    if (!isStudent) return;

    // Transition: editable → locked
    if (!wasReadOnly && isReadOnly) {
      flushAutoSave();
      // Don't show a destructive toast when the lock is from the student's own submission
      if (!justSubmittedRef.current && !isSubmitting) {
        toast({
          title: "Assignment Locked",
          description: timedExpired
            ? "Your time has expired. Your progress has been saved."
            : isPastDue && !allowLateSubmissions
            ? "The due date has passed. Your progress has been saved."
            : "Your instructor has updated the assignment settings.",
          variant: "destructive",
        });
      }
      justSubmittedRef.current = false;
    }

    // Transition: locked → editable
    if (wasReadOnly && !isReadOnly) {
      toast({
        title: "Assignment Unlocked",
        description: "Your instructor has re-opened submissions.",
      });
    }
  }, [isReadOnly, isStudent, isSubmitting, isSubmissionBlocked, timedExpired, isPastDue, allowLateSubmissions, flushAutoSave, toast]);

  // ────────────────────────────────────────────────────────────────────────────

  // Fetch submission data when submissionId changes - always from backend
  useEffect(() => {
    let cancelled = false;

    const fetchSubmissionData = async () => {
      if (!submissionId) {
        startTransition(() => {
          setAnswerState({});
          setIsLoadingSubmission(false);
        });
        return;
      }

      try {
        setIsLoadingSubmission(true);
        const response = await apiClient.getSubmission(submissionId);
        if (cancelled) return;
        const submission = response.data;

        console.log("[AssignmentViewer] Fetched submission:", {
          submissionId,
          status: submission.status,
          values: submission.values,
        });

        // Always use server data
        const newAnswerState: AnswerState = {};
        if (submission.values && typeof submission.values === "object") {
          Object.keys(submission.values).forEach((blockId) => {
            const value = submission.values[blockId];
            if (Array.isArray(value) && value.length > 0) {
              // Try to determine the type based on the first value
              const firstVal = value[0];
              if (typeof firstVal === "string") {
                // Could be selectedOptions, solution, selectedLines, or JSON string
                // Try parsing as JSON first
                try {
                  const parsed = JSON.parse(firstVal);
                  if (typeof parsed === "object" && !Array.isArray(parsed)) {
                    // It's a matches object
            newAnswerState[blockId] = {
                      matches: parsed,
              timestamp: new Date(submission.timestamp),
            };
                  } else {
                    // It's a regular string array
                    newAnswerState[blockId] = {
                      selectedOptions: value,
                      timestamp: new Date(submission.timestamp),
                    };
                  }
                } catch {
                  // Not JSON, check if it's a number string (selectedLines)
                  if (value.every((v) => !isNaN(Number(v)))) {
                    newAnswerState[blockId] = {
                      selectedLines: value.map((v) => Number(v)),
                      timestamp: new Date(submission.timestamp),
                    };
                  } else if (value.length === 1) {
                    // Single string - could be answer, selectedOptions, or JSON
                    try {
                      const parsed = JSON.parse(value[0]);
                      if (typeof parsed === "object" && !Array.isArray(parsed)) {
                        // It's a matches or answers object
                        if (Object.keys(parsed).every((k) => typeof parsed[k] === "string")) {
                          newAnswerState[blockId] = {
                            answers: parsed,
                            timestamp: new Date(submission.timestamp),
                          };
                        } else {
                          newAnswerState[blockId] = {
                            matches: parsed,
                            timestamp: new Date(submission.timestamp),
                          };
                        }
                      } else {
                        // It's a regular string - set both answer and selectedOptions
                        // so both MCQ/Poll viewers (selectedOptions) and ShortAnswer (answer) can read it
                        newAnswerState[blockId] = {
                          selectedOptions: value,
                          answer: value[0],
                          timestamp: new Date(submission.timestamp),
                        };
                      }
                    } catch {
                      // Not JSON - set both answer and selectedOptions
                      // so both MCQ/Poll viewers (selectedOptions) and ShortAnswer (answer) can read it
                      newAnswerState[blockId] = {
                        selectedOptions: value,
                        answer: value[0],
                        timestamp: new Date(submission.timestamp),
                      };
                    }
                  } else {
                    // Multiple strings - likely selectedOptions or solution
                    newAnswerState[blockId] = {
                      selectedOptions: value,
                      timestamp: new Date(submission.timestamp),
                    };
                  }
                }
              }
            }
          });
        }

        console.log("[AssignmentViewer] Setting answer state:", newAnswerState);

        // Wrap state updates in startTransition to avoid flushSync warnings
        startTransition(() => {
          setSubmissionStatus(submission.status);
          setSubmissionTimestamp(submission.timestamp);
          setAnswerState(newAnswerState);
          setIsLoadingSubmission(false);
        });
      } catch (error) {
        if (cancelled) return;
        console.error("Failed to fetch submission data:", error);
        startTransition(() => {
          setIsLoadingSubmission(false);
        });
      }
    };

    fetchSubmissionData();
    return () => {
      cancelled = true;
    };
  }, [submissionId]);

  // Save answer state to session storage whenever it changes
  const saveAnswerState = useCallback(
    (newAnswerState: AnswerState) => {
      const storageKey = getAnswerStorageKey(assignment.id.toString());
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(newAnswerState));
      } catch (error) {
        console.error("Failed to save answers to session storage:", error);
        // Fallback: try to clear some space and retry
        try {
          // Clear old answer data for other assignments
          const keysToRemove: string[] = [];
          for (let i = 0; i < sessionStorage.length; i++) {
            const key = sessionStorage.key(i);
            if (
              key &&
              key.startsWith("assignment_answers_") &&
              key !== storageKey
            ) {
              keysToRemove.push(key);
            }
          }
          keysToRemove.forEach((key) => sessionStorage.removeItem(key));

          // Retry saving
          sessionStorage.setItem(storageKey, JSON.stringify(newAnswerState));
        } catch (retryError) {
          console.error(
            "Failed to save answers even after cleanup:",
            retryError
          );
          // Continue without saving - answers will be lost on page refresh
        }
      }
    },
    [assignment.id]
  );

  // Auto-save submission values
  const autoSaveSubmission = useCallback(
    async (values: Record<string, string[]>) => {
      if (!isStudent && !isTeacherEditMode) return; // Only students and teachers editing can save
      if (isReadOnly) return; // Don't auto-save when read-only
      if (previewMode) return; // Don't auto-save in preview mode

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Set new timeout for auto-save
      saveTimeoutRef.current = setTimeout(async () => {
        try {
          if (submissionId) {
            // Update existing submission
            await apiClient.updateSubmissionValues(submissionId, values);
          } else if (isStudent) {
            // Only students can create new submissions
            const response = await apiClient.createOrUpdateSubmission({
              assignment_id: assignment.id,
              values,
              course_id: assignment.course_id,
            });
            const newSubmissionId = response.data.id;
            setSubmissionId(newSubmissionId);
            setSubmissionStatus(response.data.status);
            onSubmissionCreated?.(newSubmissionId);
          }
        } catch (error) {
          console.error("Failed to auto-save submission:", error);
          toast({
            title: "Auto-save failed",
            description:
              "Your answers could not be saved automatically. Please try submitting manually.",
            variant: "destructive",
          });
        }
      }, 2000); // Auto-save after 2 seconds of inactivity
    },
    [
      isStudent,
      isTeacherEditMode,
      isReadOnly,
      previewMode,
      submissionId,
      assignment.id,
      assignment.course_id,
      onSubmissionCreated,
      toast,
    ]
  );

  const handleMCQAnswerChange = useCallback(
    (blockId: string, selectedOptions: string[]) => {
      try {
        // Validate the blockId and selectedOptions
        if (!blockId || typeof blockId !== "string") {
          console.error(
            "Invalid blockId provided to handleMCQAnswerChange:",
            blockId
          );
          return;
        }

        if (!Array.isArray(selectedOptions)) {
          console.error(
            "Invalid selectedOptions provided to handleMCQAnswerChange:",
            selectedOptions
          );
          return;
        }

        const newAnswerState = {
          ...answerState,
          [blockId]: {
            selectedOptions: selectedOptions.filter(
              (opt) => typeof opt === "string"
            ), // Ensure all options are strings
            timestamp: new Date(),
          },
        };

        setAnswerState(newAnswerState);
        saveAnswerState(newAnswerState);
        onAnswerChange?.(blockId, selectedOptions);

        // Auto-save to backend if student or teacher editing
        if (isStudent || isTeacherEditMode) {
          const submissionValues: Record<string, string[]> = {};
          Object.keys(newAnswerState).forEach((key) => {
            const state = newAnswerState[key];
            if ('answer' in state && state.answer) {
              submissionValues[key] = [state.answer];
            } else if ('selectedOptions' in state && state.selectedOptions) {
              submissionValues[key] = state.selectedOptions;
            } else if ('solution' in state && state.solution) {
              submissionValues[key] = state.solution;
            } else if ('selectedLines' in state && state.selectedLines) {
              submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
            } else if ('matches' in state && state.matches) {
              submissionValues[key] = [JSON.stringify(state.matches)];
            }
          });
          autoSaveSubmission(submissionValues);
        }
      } catch (error) {
        console.error("Error handling MCQ answer change:", error);
        // Continue without updating state to prevent crashes
      }
    },
    [
      answerState,
      saveAnswerState,
      onAnswerChange,
      isStudent,
      isTeacherEditMode,
      autoSaveSubmission,
    ]
  );

  // Handler for Short Answer
  const handleShortAnswerChange = useCallback(
    (blockId: string, answer: string) => {
      const newAnswerState = {
        ...answerState,
        [blockId]: {
          answer,
          timestamp: new Date(),
        },
      };
      setAnswerState(newAnswerState);
      saveAnswerState(newAnswerState);
      onAnswerChange?.(blockId, answer);

      // Auto-save to backend if student or teacher editing
      if (isStudent || isTeacherEditMode) {
        const submissionValues: Record<string, string[]> = {};
        Object.keys(newAnswerState).forEach((key) => {
          const state = newAnswerState[key];
          if ('answer' in state && state.answer) {
            submissionValues[key] = [state.answer];
          } else if ('selectedOptions' in state && state.selectedOptions) {
            submissionValues[key] = state.selectedOptions;
          } else if ('solution' in state && state.solution) {
            submissionValues[key] = state.solution;
          } else if ('selectedLines' in state && state.selectedLines) {
            submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
          } else if ('matches' in state && state.matches) {
            submissionValues[key] = [JSON.stringify(state.matches)];
          } else if ('answers' in state && state.answers) {
            submissionValues[key] = [JSON.stringify(state.answers)];
          }
        });
        autoSaveSubmission(submissionValues);
      }
    },
    [answerState, saveAnswerState, onAnswerChange, isStudent, isTeacherEditMode, autoSaveSubmission]
  );

  // Handler for Parsons Problem
  const handleParsonsProblemChange = useCallback(
    (blockId: string, answer: { solution: string[] }) => {
      const newAnswerState = {
        ...answerState,
        [blockId]: {
          solution: answer.solution,
          timestamp: new Date(),
        },
      };
      setAnswerState(newAnswerState);
      saveAnswerState(newAnswerState);
      onAnswerChange?.(blockId, answer);

      if (isStudent || isTeacherEditMode) {
        const submissionValues: Record<string, string[]> = {};
        Object.keys(newAnswerState).forEach((key) => {
          const state = newAnswerState[key];
          if ('answer' in state && state.answer) {
            submissionValues[key] = [state.answer];
          } else if ('selectedOptions' in state && state.selectedOptions) {
            submissionValues[key] = state.selectedOptions;
          } else if ('solution' in state && state.solution) {
            submissionValues[key] = state.solution;
          } else if ('selectedLines' in state && state.selectedLines) {
            submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
          } else if ('matches' in state && state.matches) {
            submissionValues[key] = [JSON.stringify(state.matches)];
          } else if ('answers' in state && state.answers) {
            submissionValues[key] = [JSON.stringify(state.answers)];
          }
        });
        autoSaveSubmission(submissionValues);
      }
    },
    [answerState, saveAnswerState, onAnswerChange, isStudent, isTeacherEditMode, autoSaveSubmission]
  );

  // Handler for Clickable Area
  const handleClickableAreaChange = useCallback(
    (blockId: string, selectedLines: number[]) => {
      const newAnswerState = {
        ...answerState,
        [blockId]: {
          selectedLines,
          timestamp: new Date(),
        },
      };
      setAnswerState(newAnswerState);
      saveAnswerState(newAnswerState);
      onAnswerChange?.(blockId, selectedLines);

      if (isStudent || isTeacherEditMode) {
        const submissionValues: Record<string, string[]> = {};
        Object.keys(newAnswerState).forEach((key) => {
          const state = newAnswerState[key];
          if ('answer' in state && state.answer) {
            submissionValues[key] = [state.answer];
          } else if ('selectedOptions' in state && state.selectedOptions) {
            submissionValues[key] = state.selectedOptions;
          } else if ('solution' in state && state.solution) {
            submissionValues[key] = state.solution;
          } else if ('selectedLines' in state && state.selectedLines) {
            submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
          } else if ('matches' in state && state.matches) {
            submissionValues[key] = [JSON.stringify(state.matches)];
          } else if ('answers' in state && state.answers) {
            submissionValues[key] = [JSON.stringify(state.answers)];
          }
        });
        autoSaveSubmission(submissionValues);
      }
    },
    [answerState, saveAnswerState, onAnswerChange, isStudent, isTeacherEditMode, autoSaveSubmission]
  );

  // Handler for Drag-Drop Matching
  const handleDragDropMatchingChange = useCallback(
    (blockId: string, answer: { matches: Record<string, string> }) => {
      const newAnswerState = {
        ...answerState,
        [blockId]: {
          matches: answer.matches,
          timestamp: new Date(),
        },
      };
      setAnswerState(newAnswerState);
      saveAnswerState(newAnswerState);
      onAnswerChange?.(blockId, answer);

      if (isStudent || isTeacherEditMode) {
        const submissionValues: Record<string, string[]> = {};
        Object.keys(newAnswerState).forEach((key) => {
          const state = newAnswerState[key];
          if ('answer' in state && state.answer) {
            submissionValues[key] = [state.answer];
          } else if ('selectedOptions' in state && state.selectedOptions) {
            submissionValues[key] = state.selectedOptions;
          } else if ('solution' in state && state.solution) {
            submissionValues[key] = state.solution;
          } else if ('selectedLines' in state && state.selectedLines) {
            submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
          } else if ('matches' in state && state.matches) {
            submissionValues[key] = [JSON.stringify(state.matches)];
          } else if ('answers' in state && state.answers) {
            submissionValues[key] = [JSON.stringify(state.answers)];
          }
        });
        autoSaveSubmission(submissionValues);
      }
    },
    [answerState, saveAnswerState, onAnswerChange, isStudent, isTeacherEditMode, autoSaveSubmission]
  );

  // Handler for Poll
  const handlePollChange = useCallback(
    (blockId: string, answer: { selectedOptions: string[] }) => {
      const newAnswerState = {
        ...answerState,
        [blockId]: {
          selectedOptions: answer.selectedOptions,
          timestamp: new Date(),
        },
      };
      setAnswerState(newAnswerState);
      saveAnswerState(newAnswerState);
      onAnswerChange?.(blockId, answer);

      if (isStudent || isTeacherEditMode) {
        const submissionValues: Record<string, string[]> = {};
        Object.keys(newAnswerState).forEach((key) => {
          const state = newAnswerState[key];
          if ('answer' in state && state.answer) {
            submissionValues[key] = [state.answer];
          } else if ('selectedOptions' in state && state.selectedOptions) {
            submissionValues[key] = state.selectedOptions;
          } else if ('solution' in state && state.solution) {
            submissionValues[key] = state.solution;
          } else if ('selectedLines' in state && state.selectedLines) {
            submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
          } else if ('matches' in state && state.matches) {
            submissionValues[key] = [JSON.stringify(state.matches)];
          } else if ('answers' in state && state.answers) {
            submissionValues[key] = [JSON.stringify(state.answers)];
          }
        });
        autoSaveSubmission(submissionValues);
      }
    },
    [answerState, saveAnswerState, onAnswerChange, isStudent, isTeacherEditMode, autoSaveSubmission]
  );

  // Handler for Fill-in-the-Blank
  const handleFillInTheBlankChange = useCallback(
    (blockId: string, answers: Record<string, string>) => {
      const newAnswerState = {
        ...answerState,
        [blockId]: {
          answers,
          timestamp: new Date(),
        },
      };
      setAnswerState(newAnswerState);
      saveAnswerState(newAnswerState);
      onAnswerChange?.(blockId, answers);

      if (isStudent || isTeacherEditMode) {
        const submissionValues: Record<string, string[]> = {};
        Object.keys(newAnswerState).forEach((key) => {
          const state = newAnswerState[key];
          if ('answer' in state && state.answer) {
            submissionValues[key] = [state.answer];
          } else if ('selectedOptions' in state && state.selectedOptions) {
            submissionValues[key] = state.selectedOptions;
          } else if ('solution' in state && state.solution) {
            submissionValues[key] = state.solution;
          } else if ('selectedLines' in state && state.selectedLines) {
            submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
          } else if ('matches' in state && state.matches) {
            submissionValues[key] = [JSON.stringify(state.matches)];
          } else if ('answers' in state && state.answers) {
            submissionValues[key] = [JSON.stringify(state.answers)];
          }
        });
        autoSaveSubmission(submissionValues);
      }
    },
    [answerState, saveAnswerState, onAnswerChange, isStudent, isTeacherEditMode, autoSaveSubmission]
  );

  // Function to get answer state for a specific block - optimized with ref
  const getBlockAnswerState = useCallback((blockId: string) => {
    const state = answerStateRef.current[blockId] || {
      timestamp: new Date(),
    };
    console.log("[AssignmentViewer] getBlockAnswerState called:", {
      blockId,
      state,
      allAnswerState: answerStateRef.current,
    });
    return state;
  }, []);

  // Update ref when answerState changes
  useEffect(() => {
    console.log("[AssignmentViewer] Updating answerStateRef:", answerState);
    answerStateRef.current = answerState;
  }, [answerState]);

  // ── Live answer sync via WebSocket ──────────────────────────────────────────

  const getSocketBaseURL = () => {
    const apiUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000/api";
    return apiUrl.replace(/\/api$/, "") || "http://localhost:8000";
  };

  // Student: maintain a persistent socket and emit answerState changes
  const studentAnswerSocketRef = useRef<ReturnType<typeof io> | null>(null);

  useEffect(() => {
    if (!isStudent || !submissionId) return;

    const socket = io(`${getSocketBaseURL()}/course-tree`, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });
    studentAnswerSocketRef.current = socket;

    return () => {
      socket.disconnect();
      studentAnswerSocketRef.current = null;
    };
  }, [isStudent, submissionId]);

  // Debounced emit when student's answerState changes
  useEffect(() => {
    if (!isStudent || !submissionId) return;
    const timer = setTimeout(() => {
      studentAnswerSocketRef.current?.emit("submission-answers", {
        submissionId,
        answers: answerStateRef.current,
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [answerState, isStudent, submissionId]);

  // Teacher/grader: subscribe to live answer updates for the viewed submission
  useEffect(() => {
    if (!locked || isStudent || !submissionId) return;
    if (isTeacherEditMode) return; // Don't overwrite teacher edits with student data

    const socket = io(`${getSocketBaseURL()}/course-tree`, {
      transports: ["websocket", "polling"],
      withCredentials: true,
    });

    socket.on("connect", () => {
      socket.emit("join-submission-grading", submissionId);
    });

    socket.on(
      "submission-answers",
      ({ submissionId: incomingId, answers }: { submissionId: string; answers: AnswerState }) => {
        if (incomingId === submissionId) {
          startTransition(() => setAnswerState(answers));
        }
      }
    );

    return () => {
      socket.emit("leave-submission-grading", submissionId);
      socket.disconnect();
    };
  }, [locked, isStudent, submissionId, isTeacherEditMode]);

  // ────────────────────────────────────────────────────────────────────────────

  // Memoize editor extensions to prevent recreation
  const editorExtensions = useMemo(
    () => [
      StarterKit.configure({
        bulletList: {
          keepMarks: true,
          keepAttributes: false,
          HTMLAttributes: {
            class: "tiptap-bullet-list",
          },
        },
        orderedList: {
          keepMarks: true,
          keepAttributes: false,
          HTMLAttributes: {
            class: "tiptap-ordered-list",
          },
        },
        listItem: {
          HTMLAttributes: {
            class: "tiptap-list-item",
          },
        },
        dropcursor: false, // We'll add our own
        gapcursor: false, // We'll add our own
      }),
      Placeholder.configure({
        placeholder: ({ node }) => {
          if (node.type.name === "heading") {
            return "Assignment content will appear here...";
          }
          return "Assignment content will appear here...";
        },
      }),
      Typography,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Table.configure({
        resizable: true,
      }),
      TableRow,
      TableHeader,
      TableCell,
      Dropcursor.configure({
        color: "#8b5cf6",
        width: 2,
      }),
      Gapcursor,
      Underline,
      MCQBlockViewer, // Add MCQ viewer extension
      FillInTheBlankBlockViewer, // Add Fill-in-the-Blank viewer extension
      ShortAnswerBlockViewer, // Add Short Answer viewer extension
      ParsonsProblemBlockViewer, // Add Parsons Problem viewer extension
      ClickableAreaBlockViewer, // Add Clickable Area viewer extension
      DragDropMatchingBlockViewer, // Add Drag-and-Drop Matching viewer extension
      TabbedContentBlockViewer, // Add Tabbed Content viewer extension
      RevealContentBlockViewer, // Add Reveal Content viewer extension
      PollBlockViewer, // Add Poll viewer extension
      EmbedBlockViewer, // Add Embed viewer extension
      AlertBlockViewer, // Add Alert/Callout viewer extension
      ImageBlockViewer, // Add Image viewer extension
      DiscussionBlockViewer, // Add Discussion viewer extension
      IDEBlockViewer, // Add IDE viewer extension
    ],
    []
  );

  const editor = useEditor({
    extensions: editorExtensions,
    content: "", // Start with empty content, we'll set it properly in useEffect
    editable: false, // Viewer never allows text editing; block viewers control their own interactivity via editor.storage.isReadOnly
    onCreate: ({ editor }) => {
      // Store the answer change callbacks and state getter in the editor's storage
      (editor.storage as any).mcqAnswerCallback = handleMCQAnswerChange;
      (editor.storage as any).shortAnswerCallback = handleShortAnswerChange;
      (editor.storage as any).parsonsProblemAnswerCallback = handleParsonsProblemChange;
      (editor.storage as any).clickableAreaAnswerCallback = handleClickableAreaChange;
      (editor.storage as any).dragDropMatchingAnswerCallback = handleDragDropMatchingChange;
      (editor.storage as any).pollAnswerCallback = handlePollChange;
      (editor.storage as any).getBlockAnswerState = getBlockAnswerState;
      (editor.storage as any).isReadOnly = isReadOnly;
      (editor.storage as any).hasSubmission = hasSubmission;
      (editor.storage as any).blockScores = grader?.block_scores || {};
      console.log(
        "[AssignmentViewer] onCreate - blockScores:",
        grader?.block_scores
      );
    },
    // No onUpdate handler since this is read-only
    // No onSelectionUpdate handler since we don't need editing features
  });

  // Store editor reference for cleanup
  useEffect(() => {
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor]);

  // Optimized content validation and setting with better error handling
  useEffect(() => {
    if (editor) {
      if (!assignment.content) {
        editor.commands.setContent("");
        setContentError(null);
        return;
      }
      try {
        // Try to parse as JSON first (new format), fallback to HTML (legacy support)
        try {
          let parsedContent = JSON.parse(assignment.content);

          // Apply randomization if enabled and we have student ID
          const shouldRandomize =
            isStudent &&
            studentId &&
            assignment.settings?.randomizeQuestionOrder;

          if (shouldRandomize) {
            parsedContent = randomizeMCQBlocks(
              parsedContent,
              studentId,
              assignment.id
            );
          }

          editor.commands.setContent(parsedContent);
          setContentError(null);
        } catch (jsonError) {
          // Handle HTML content with MCQ validation
          if (assignment.content.includes('data-type="mcq-block"')) {
            const tempDiv = document.createElement("div");
            tempDiv.innerHTML = assignment.content;
            const mcqBlocks = tempDiv.querySelectorAll(
              '[data-type="mcq-block"]'
            );

            let hasErrors = false;
            let recoveredContent = assignment.content;

            // Batch process MCQ blocks for better performance
            const processedBlocks = Array.from(mcqBlocks).map((block) => {
              const mcqDataAttr = block.getAttribute("data-mcq");
              if (mcqDataAttr) {
                try {
                  const mcqData = JSON.parse(mcqDataAttr);
                  const validation = validateMCQData(mcqData);
                  if (!validation.isValid) {
                    console.warn(
                      "Invalid MCQ data found in content:",
                      validation.errors
                    );
                    hasErrors = true;

                    // Attempt to sanitize the data
                    const sanitizedData = sanitizeMCQData(mcqData);
                    block.setAttribute(
                      "data-mcq",
                      JSON.stringify(sanitizedData)
                    );
                    return { block, success: true };
                  }
                  return { block, success: true };
                } catch (parseError) {
                  console.error(
                    "Failed to parse MCQ data in content:",
                    parseError
                  );
                  hasErrors = true;

                  // Create error replacement
                  const errorDiv = document.createElement("div");
                  errorDiv.className =
                    "p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md my-4";
                  errorDiv.innerHTML = `
                    <div class="flex items-center gap-2 text-red-800">
                      <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                        <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
                      </svg>
                      <span class="font-medium">Question data corrupted</span>
                    </div>
                    <p class="text-sm text-red-700 mt-1">This question contains invalid data and cannot be displayed properly.</p>
                  `;
                  return { block, errorDiv, success: false };
                }
              }
              return { block, success: true };
            });

            // Apply error replacements
            processedBlocks.forEach(({ block, errorDiv, success }) => {
              if (!success && errorDiv) {
                block.parentNode?.replaceChild(errorDiv, block);
              }
            });

            if (hasErrors) {
              recoveredContent = tempDiv.innerHTML;
              setContentError(
                "Some questions had invalid data and were recovered or removed."
              );
            } else {
              setContentError(null);
            }

            editor.commands.setContent(recoveredContent);
          } else {
            // No MCQ blocks, set content directly
            editor.commands.setContent(assignment.content);
            setContentError(null);
          }
        }
      } catch (error) {
        console.error("Failed to set assignment content:", error);
        setContentError(
          "Failed to load assignment content. The content may be corrupted."
        );
        editor.commands.setContent(`
          <div class="p-4 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-md my-4" role="alert">
            <div class="flex items-center gap-2 text-red-800">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd"></path>
              </svg>
              <span class="font-medium">Content Error</span>
            </div>
            <p class="text-sm text-red-700 mt-1">The assignment content could not be loaded properly. Please contact your instructor.</p>
          </div>
        `);
      }
    }
  }, [assignment.content, editor]);

  // Update editor storage when callbacks or read-only status change
  useEffect(() => {
    if (editor) {
      (editor.storage as any).mcqAnswerCallback = handleMCQAnswerChange;
      (editor.storage as any).shortAnswerCallback = handleShortAnswerChange;
      (editor.storage as any).parsonsProblemAnswerCallback = handleParsonsProblemChange;
      (editor.storage as any).clickableAreaAnswerCallback = handleClickableAreaChange;
      (editor.storage as any).dragDropMatchingAnswerCallback = handleDragDropMatchingChange;
      (editor.storage as any).pollAnswerCallback = handlePollChange;
      (editor.storage as any).getBlockAnswerState = getBlockAnswerState;
      (editor.storage as any).isReadOnly = isReadOnly;
      (editor.storage as any).hasSubmission = hasSubmission;
      (editor.storage as any).blockScores = grader?.block_scores || {};
      console.log(
        "[AssignmentViewer] useEffect - blockScores:",
        grader?.block_scores
      );
      editor.setEditable(false); // Viewer never allows text editing

      // Force editor to re-render when block scores change
      const tr = editor.state.tr;
      tr.setMeta("blockScoresUpdate", true);
      editor.view.dispatch(tr);
    }
  }, [
    editor,
    handleMCQAnswerChange,
    handleShortAnswerChange,
    handleParsonsProblemChange,
    handleClickableAreaChange,
    handleDragDropMatchingChange,
    handlePollChange,
    handleFillInTheBlankChange,
    getBlockAnswerState,
    isReadOnly,
    hasSubmission,
    grader,
  ]);

  // Force editor to re-render when answer state changes (for submission switching)
  useEffect(() => {
    if (editor && !editor.isDestroyed) {
      console.log(
        "[AssignmentViewer] Forcing editor re-render with answer state:",
        answerState
      );

      // Update editor storage to trigger node view updates
      (editor.storage as any).answerStateVersion = Date.now();

      // Force a full re-render by updating a meta property
      const tr = editor.state.tr;
      tr.setMeta("forceUpdate", true);
      editor.view.dispatch(tr);

      // Also force view update
      editor.view.updateState(editor.state);
    }
  }, [editor, answerState]);

  // Cleanup effect for proper resource management
  useEffect(() => {
    return () => {
      // Destroy editor instance if it exists
      if (editorRef.current && !editorRef.current.isDestroyed) {
        try {
          editorRef.current.destroy();
        } catch (error) {
          console.warn("Error destroying viewer editor instance:", error);
        }
      }
    };
  }, []);

  if (!editor) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin text-purple-600 mx-auto mb-4" />
          <p className="text-muted-foreground">Loading assignment...</p>
        </div>
      </div>
    );
  }

  const handleRecoverContent = useCallback(async () => {
    setIsRecovering(true);
    try {
      // Attempt to reload the assignment content
      window.location.reload();
    } catch (error) {
      console.error("Failed to recover content:", error);
    } finally {
      setIsRecovering(false);
    }
  }, []);

  const handleResubmit = useCallback(async () => {
    if (!assignment) return;

    try {
      setIsSubmitting(true);
      // Create a new submission with current answer state
      const submissionValues: Record<string, string[]> = {};
      Object.keys(answerState).forEach((key) => {
        const state = answerState[key];
        if ('answer' in state && state.answer) {
          submissionValues[key] = [state.answer];
        } else if ('selectedOptions' in state && state.selectedOptions) {
          submissionValues[key] = state.selectedOptions;
        } else if ('solution' in state && state.solution) {
          submissionValues[key] = state.solution;
        } else if ('selectedLines' in state && state.selectedLines) {
          submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
        } else if ('matches' in state && state.matches) {
          submissionValues[key] = [JSON.stringify(state.matches)];
        } else if ('answers' in state && state.answers) {
          submissionValues[key] = [JSON.stringify(state.answers)];
        }
      });

      const response = await apiClient.createOrUpdateSubmission({
        assignment_id: assignment.id,
        values: submissionValues,
        course_id: assignment.course_id,
      });

      const newSubmissionId = response.data.id;
      setSubmissionId(newSubmissionId);
      setSubmissionStatus("in-progress");
      onSubmissionCreated?.(newSubmissionId);
      onSubmissionStatusChange?.("in-progress");

      toast({
        title: "Ready to resubmit",
        description: "You can now make changes and submit again.",
      });
    } catch (error: any) {
      console.error("Failed to create resubmission:", error);
      toast({
        title: "Resubmission failed",
        description: error.message || "Failed to create new submission",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    assignment,
    answerState,
    onSubmissionCreated,
    onSubmissionStatusChange,
    toast,
  ]);

  const handleUnsubmit = useCallback(async () => {
    if (!assignment) return;
    try {
      setIsSubmitting(true);
      // Create a NEW in-progress submission so the old submitted one is preserved as a record
      const submissionValues: Record<string, string[]> = {};
      Object.keys(answerState).forEach((key) => {
        const state = answerState[key];
        if ('answer' in state && state.answer) {
          submissionValues[key] = [state.answer];
        } else if ('selectedOptions' in state && state.selectedOptions) {
          submissionValues[key] = state.selectedOptions;
        } else if ('solution' in state && state.solution) {
          submissionValues[key] = state.solution;
        } else if ('selectedLines' in state && state.selectedLines) {
          submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
        } else if ('matches' in state && state.matches) {
          submissionValues[key] = [JSON.stringify(state.matches)];
        } else if ('answers' in state && state.answers) {
          submissionValues[key] = [JSON.stringify(state.answers)];
        }
      });
      const response = await apiClient.createOrUpdateSubmission({
        assignment_id: assignment.id,
        values: submissionValues,
        course_id: assignment.course_id,
      });
      const newSubmissionId = response.data.id;
      setSubmissionId(newSubmissionId);
      setSubmissionStatus("in-progress");
      onSubmissionCreated?.(newSubmissionId);
      onSubmissionStatusChange?.("in-progress");
      toast({
        title: "Unsubmitted",
        description: "Make your changes and resubmit when ready.",
      });
    } catch (error: any) {
      toast({
        title: "Failed to unsubmit",
        description: error.message || "Failed to unsubmit",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [assignment, answerState, onSubmissionCreated, onSubmissionStatusChange, toast]);

  const handleRetryAutograde = useCallback(async () => {
    if (!submissionId) {
      return;
    }

    try {
      setIsRetryingAutograde(true);

      const autogradeResponse = await apiClient.autogradeSubmission(
        submissionId
      );

      if (
        autogradeResponse.data.grader &&
        autogradeResponse.data.totalPossiblePoints !== undefined
      ) {
        // Score visibility is enabled, show the score
        const g = autogradeResponse.data.grader;
        const score = (Number(g.raw_assignment_score) || 0) + (Number(g.raw_rubric_score) || 0) + (parseFloat(g.score_modifier) || 0);
        const totalPoints = autogradeResponse.data.totalPossiblePoints;

        toast({
          title: "Autograding Successful",
          description: `Your score: ${score} / ${totalPoints} points`,
        });

        // Update submission status to graded
        setSubmissionStatus("graded");
        onSubmissionStatusChange?.("graded");
      } else {
        // Score visibility is disabled
        toast({
          title: "Autograding Successful",
          description: "Your assignment has been automatically graded.",
        });
      }

      // Clear autograding failure state
      setAutogradingFailed(false);
    } catch (error: any) {
      console.error("Retry autograding failed:", error);

      // Log detailed error information for debugging
      if (error.response) {
        console.error("Retry autograding error response:", {
          status: error.response.status,
          data: error.response.data,
        });
      }

      toast({
        title: "Autograding Failed",
        description:
          "Automatic grading failed again. Your instructor will grade your submission manually.",
        variant: "destructive",
      });
    } finally {
      setIsRetryingAutograde(false);
    }
  }, [submissionId, toast, onSubmissionStatusChange]);

  const handleSubmit = useCallback(async () => {
    // Prevent submission in preview mode
    if (previewMode) {
      toast({
        title: "Preview Mode",
        description: "Submissions are disabled in preview mode.",
      });
      return;
    }

    // Block submission if past due and late submissions not allowed
    if (isSubmissionBlocked) {
      toast({
        title: "Submissions Closed",
        description:
          "The due date has passed and late submissions are not allowed.",
        variant: "destructive",
      });
      return;
    }

    if (!submissionId) {
      toast({
        title: "No submission to submit",
        description: "Please answer at least one question before submitting.",
        variant: "destructive",
      });
      return;
    }

    if (submissionStatus === "submitted" || submissionStatus === "graded") {
      toast({
        title: "Already submitted",
        description: "This assignment has already been submitted.",
        variant: "destructive",
      });
      return;
    }

    try {
      setIsSubmitting(true);

      // Step 1: Ensure latest answers are saved before submitting
      if (isStudent && !isReadOnly) {
        const submissionValues: Record<string, string[]> = {};
        Object.keys(answerState).forEach((key) => {
          const state = answerState[key];
          if ('answer' in state && state.answer) {
            submissionValues[key] = [state.answer];
          } else if ('selectedOptions' in state && state.selectedOptions) {
            submissionValues[key] = state.selectedOptions;
          } else if ('solution' in state && state.solution) {
            submissionValues[key] = state.solution;
          } else if ('selectedLines' in state && state.selectedLines) {
            submissionValues[key] = state.selectedLines.map((n: number) => n.toString());
          } else if ('matches' in state && state.matches) {
            submissionValues[key] = [JSON.stringify(state.matches)];
          } else if ('answers' in state && state.answers) {
            submissionValues[key] = [JSON.stringify(state.answers)];
          }
        });

        // Save immediately before submitting
        if (Object.keys(submissionValues).length > 0) {
          await apiClient.updateSubmissionValues(
            submissionId,
            submissionValues
          );
        }
      }

      // Step 2: Submit the assignment
      justSubmittedRef.current = true;
      await apiClient.submitSubmission(submissionId);
      setSubmissionStatus("submitted");
      onSubmissionStatusChange?.("submitted");

      // Step 2: Trigger autograding
      try {
        const autogradeResponse = await apiClient.autogradeSubmission(
          submissionId
        );

        if (
          autogradeResponse.data.grader &&
          autogradeResponse.data.totalPossiblePoints !== undefined
        ) {
          // Score visibility is enabled, show the score
          const g2 = autogradeResponse.data.grader;
          const score = (Number(g2.raw_assignment_score) || 0) + (Number(g2.raw_rubric_score) || 0) + (parseFloat(g2.score_modifier) || 0);
          const totalPoints = autogradeResponse.data.totalPossiblePoints;

          toast({
            title: "Assignment Submitted & Graded",
            description: `Your score: ${score} / ${totalPoints} points`,
          });

          // Update submission status to graded
          setSubmissionStatus("graded");
          onSubmissionStatusChange?.("graded");
        } else {
          // Score visibility is disabled, show success without scores
          toast({
            title: "Assignment Submitted",
            description:
              autogradeResponse.data.message ||
              "Your assignment has been submitted successfully.",
          });
        }

        // Clear any previous autograding failure state
        setAutogradingFailed(false);
        setShowSuccessModal(true);
      } catch (autogradeError: any) {
        console.error("Autograding failed:", autogradeError);

        // Log detailed error information for debugging
        if (autogradeError.response) {
          console.error("Autograding error response:", {
            status: autogradeError.response.status,
            data: autogradeError.response.data,
          });
        }

        // Mark autograding as failed
        setAutogradingFailed(true);

        // Submission still succeeded, just show a warning about autograding
        toast({
          title: "Assignment Submitted",
          description:
            "Your assignment was submitted, but automatic grading encountered an issue. Your instructor will grade it manually.",
          variant: "default",
        });

        setShowSuccessModal(true);
      }
    } catch (error: any) {
      console.error("Failed to submit assignment:", error);

      // Provide detailed error message
      let errorMessage = "Failed to submit your assignment. Please try again.";
      if (error.response?.data?.error?.message) {
        errorMessage = error.response.data.error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      toast({
        title: "Submission failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [
    submissionId,
    submissionStatus,
    toast,
    onSubmissionStatusChange,
    isStudent,
    isReadOnly,
    previewMode,
    answerState,
    isSubmissionBlocked,
    hasPreviousSubmission,
  ]);

  // Shared submission selector popover (used in submitted & graded banners)
  const submissionSelectorPopover = (
    <Popover
      minWidth="auto"
      trigger={
        <button className="flex items-center gap-2 text-sm border border-border rounded-md px-3 py-1.5 bg-card hover:border-foreground/30 hover:bg-accent transition-colors">
          <span>
            {allSubmissions.findIndex(
              (s) => s.id === (selectedSubmissionId || submissionId)
            ) === 0
              ? "Latest Submission"
              : `Submission ${
                  allSubmissions.length -
                  allSubmissions.findIndex(
                    (s) => s.id === (selectedSubmissionId || submissionId)
                  )
                }`}
          </span>
          <ChevronDown className="w-4 h-4 text-muted-foreground" />
        </button>
      }
      content={
        <div className="w-80 max-h-96 overflow-y-auto">
          <div className="p-3 border-b border-border bg-muted">
            <h3 className="font-semibold text-foreground">
              Submission History
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {allSubmissions.length} submission
              {allSubmissions.length !== 1 ? "s" : ""}
            </p>
          </div>
          <div className="divide-y">
            {allSubmissions.map((sub, index) => {
              const isSelected =
                sub.id === (selectedSubmissionId || submissionId);
              const label =
                index === 0
                  ? "Latest Submission"
                  : `Submission ${allSubmissions.length - index}`;
              const timestamp = new Date(sub.timestamp).toLocaleString(
                "en-US",
                {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                }
              );

              return (
                <button
                  key={sub.id}
                  onClick={() => onSubmissionSelect?.(sub.id)}
                  className={`w-full p-3 text-left hover:bg-accent transition-colors ${
                    isSelected
                      ? "bg-primary/10 border-l-4 border-purple-600"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-muted-foreground" />
                        <span className="text-sm font-medium text-foreground">
                          {label}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 ml-6">
                        {timestamp}
                      </p>
                      {sub.status === "graded" &&
                        sub.grade !== null &&
                        sub.grade !== undefined && (
                          <div className="text-sm font-semibold text-purple-600 mt-1 ml-6">
                            Grade: {sub.grade}
                          </div>
                        )}
                    </div>
                    <div>
                      <span
                        className={`text-xs px-2 py-1 rounded-full font-medium ${
                          sub.status === "graded"
                            ? "bg-purple-100 text-purple-700"
                            : sub.status === "submitted"
                            ? "bg-green-100 text-green-700"
                            : "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400"
                        }`}
                      >
                        {sub.status === "in-progress"
                          ? "In Progress"
                          : sub.status === "submitted"
                          ? "Submitted"
                          : sub.status === "graded"
                          ? "Graded"
                          : sub.status}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      }
      className=""
    />
  );

  return (
    <div className="h-full flex flex-col bg-muted/50 relative">
      {/* Due Date Countdown Banner */}
      {isStudent && timeRemaining != null && timeRemaining > 0 && !countdownDismissed && submissionStatus === "in-progress" && (
        <div className="px-4 py-2 border-b border-border">
          <div className={`${timeRemaining < 60 ? "bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800" : "bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800"} rounded-lg px-4 py-3 flex items-center justify-between`}>
            <div className="flex items-center gap-2">
              <Clock className={`w-4 h-4 ${timeRemaining < 60 ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"}`} />
              <span className={`text-sm font-medium ${timeRemaining < 60 ? "text-red-800 dark:text-red-300" : "text-amber-800 dark:text-amber-300"}`}>
                {isTimedAssignment ? `Time remaining: ${formatCountdown(timeRemaining)}` : `Due in ${formatCountdown(timeRemaining)}`}
              </span>
            </div>
            <button
              onClick={() => setCountdownDismissed(true)}
              className={`flex items-center gap-1 text-xs ${timeRemaining < 60 ? "text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-200" : "text-amber-600 dark:text-amber-400 hover:text-amber-800 dark:hover:text-amber-200"} transition-colors`}
              aria-label="Hide countdown"
            >
              <ChevronRight className="w-3.5 h-3.5" />
              <span>Hide time</span>
            </button>
          </div>
        </div>
      )}

      {/* No Submission Banner */}
      {!hasSubmission && !previewMode && (
        <div className="bg-yellow-50 dark:bg-yellow-950/30 border-b border-yellow-200 dark:border-yellow-800 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            <span className="font-medium text-yellow-800">
              No submission yet - This student has not submitted this assignment
            </span>
          </div>
        </div>
      )}

      {/* Submitted Banner */}
      {isStudent && effectiveStatus === "submitted" && hasSubmission && (
        <div className="px-4 py-2 border-b border-border">
          <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-800 rounded-lg px-4 py-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="font-medium flex items-center gap-2 text-green-800 dark:text-green-300">
                {grader?.raw_assignment_score != null && totalPossiblePoints != null ? (
                  <>
                    Assignment Submitted — Your score: {(Number(grader.raw_assignment_score) || 0) + (Number(grader.raw_rubric_score) || 0) + (parseFloat(grader.score_modifier) || 0)} / {totalPossiblePoints} points
                    {(!grader.reviewed_at) && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center px-2 py-0.5 rounded bg-orange-500 text-white text-xs font-semibold cursor-help">
                              Pending
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="bg-card border-border text-foreground">
                            <p>Instructor has not marked as reviewed</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </>
                ) : showResponsesAfterSubmission ? (
                  "Assignment Submitted — You can view your responses below"
                ) : (
                  "Assignment Submitted — Your answers are locked"
                )}
              </span>
            </div>
            {(allSubmissions?.length ?? 0) > 1 && (
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-sm text-green-700 dark:text-green-400">Viewing:</span>
                {submissionSelectorPopover}
              </div>
            )}
          </div>
        </div>
      )}

      {/* In-Progress Banner (instructor viewing a student's in-progress submission) */}
      {locked && !isStudent && submissionStatus === "in-progress" && hasSubmission && (
        <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            <span className="font-medium text-amber-800 dark:text-amber-300">
              In Progress — Student has not submitted this assignment yet
            </span>
          </div>
        </div>
      )}

      {/* Graded Banner */}
      {isStudent && effectiveStatus === "graded" && hasSubmission && (
        <div className="px-4 py-2 border-b border-border">
          {grader?.raw_assignment_score != null && totalPossiblePoints != null ? (
            <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-lg px-4 py-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-medium flex items-center gap-2 text-purple-800 dark:text-purple-300">
                  Assignment Graded — Your score: {(Number(grader.raw_assignment_score) || 0) + (Number(grader.raw_rubric_score) || 0) + (parseFloat(grader.score_modifier) || 0)} / {totalPossiblePoints} points
                  {(!grader.reviewed_at) && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center px-2 py-0.5 rounded bg-orange-500 text-white text-xs font-semibold cursor-help">
                            Pending
                          </span>
                        </TooltipTrigger>
                        <TooltipContent className="bg-card border-border text-foreground">
                          <p>Instructor has not marked as reviewed</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </span>
              </div>
              {(allSubmissions?.length ?? 0) > 1 && (
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-sm text-purple-700 dark:text-purple-400">Viewing:</span>
                  {submissionSelectorPopover}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-muted border border-border rounded-lg px-4 py-3 flex items-center justify-center gap-2">
              <Clock className="w-5 h-5 text-muted-foreground flex-shrink-0" />
              <span className="font-medium text-muted-foreground">
                Grades have not been released yet
              </span>
            </div>
          )}
        </div>
      )}

      {/* Content Error Banner */}
      {contentError && (
        <div className="bg-yellow-50 dark:bg-yellow-950/30 border-b border-yellow-200 dark:border-yellow-800 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-yellow-600" />
              <div>
                <p className="text-sm font-medium text-yellow-800">
                  Content Recovery
                </p>
                <p className="text-sm text-yellow-700">{contentError}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleRecoverContent}
              disabled={isRecovering}
              className="border-yellow-300 text-yellow-700 hover:bg-yellow-100"
            >
              {isRecovering ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Reloading...
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reload Page
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Editor Content or Submission Success Screen */}
      <div className="flex-1 min-h-0 overflow-auto">
        {effectiveStatus === "submitted" && !showResponsesAfterSubmission ? (
          // Show submission success screen when responses are disabled
          <div className="max-w-2xl mx-auto p-8">
            <div className="bg-card rounded-lg border border-border p-8 text-center">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg
                  className="w-10 h-10 text-green-600"
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
              <h2 className="text-2xl font-bold text-foreground mb-2">
                Assignment Submitted Successfully
              </h2>
              <p className="text-muted-foreground mb-6">
                Your submission has been recorded and will be reviewed by your
                instructor.
              </p>
              <div className="bg-muted rounded-lg p-4 mb-6">
                <div className="text-sm text-muted-foreground mb-1">Submitted at</div>
                <div className="text-lg font-medium text-foreground">
                  {submissionTimestamp
                    ? new Date(submissionTimestamp).toLocaleString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })
                    : "Just now"}
                </div>
              </div>
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                <p className="text-sm text-blue-800 dark:text-blue-400">
                  <strong>Note:</strong> Your instructor has disabled viewing
                  responses after submission. You will be notified when your
                  assignment has been graded.
                </p>
              </div>
            </div>
          </div>
        ) : isLoadingSubmission ? (
          // Show skeleton loader while loading submission
          <AssignmentContentSkeleton />
        ) : (
          // Show normal editor content
          <div className="max-w-4xl mx-auto mt-4 p-8 relative bg-card rounded-t-lg shadow-md border border-border/50 border-b-0 min-h-[calc(100%-1rem)]">
            {/* Collapsed countdown pill */}
            {isStudent && timeRemaining != null && timeRemaining > 0 && countdownDismissed && submissionStatus === "in-progress" && (
              <button
                onClick={() => setCountdownDismissed(false)}
                className={`absolute top-2 right-2 z-10 flex items-center gap-1 rounded-full px-2 py-1 transition-colors ${timeRemaining < 60 ? "bg-red-100 dark:bg-red-900/60 border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-200 dark:hover:bg-red-800/60" : "bg-amber-100 dark:bg-amber-900/60 border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/60"}`}
                aria-label="Show countdown"
              >
                <Clock className="w-3.5 h-3.5" />
              </button>
            )}
            <div className="relative editor-container">
              <EditorContent
                editor={editor}
                className="assignment-viewer-content prose prose-lg max-w-none focus:outline-none min-h-[200px] [&_.ProseMirror]:cursor-default [&_.ProseMirror]:min-h-[200px] [&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ml-8 [&_ol]:ml-8 [&_ul]:pl-4 [&_ol]:pl-4 [&_li]:pl-2"
              />
            </div>
          </div>
        )}
      </div>

      {/* Fixed Bottom Bar for Students (hidden in preview mode) */}
      {isStudent && !previewMode && (
        <div className="border-t border-border bg-background shadow-lg z-40">
          <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              {effectiveStatus === "submitted" && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-blue-600">
                    ✓ Submitted
                  </span>
                  {isLateSubmission && (
                    <span className="text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-full">
                      Late
                    </span>
                  )}
                </div>
              )}
              {effectiveStatus === "graded" && (
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-purple-600">
                    ✓ Graded
                  </span>
                  {isLateSubmission && (
                    <span className="text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2 py-0.5 rounded-full">
                      Late
                    </span>
                  )}
                </div>
              )}
              {effectiveStatus === "in-progress" && !isSubmissionBlocked && (
                <div className="text-sm text-muted-foreground">In Progress</div>
              )}
              {isSubmissionBlocked && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400 font-medium">
                  <Clock className="w-4 h-4" />
                  <span>{timedExpired ? "Time Expired" : "Submissions Closed"}</span>
                </div>
              )}
              {isPastDue && allowLateSubmissions && !timedExpired && effectiveStatus === "in-progress" && (
                <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Past Due - Will be marked as late</span>
                </div>
              )}
              {autogradingFailed && effectiveStatus === "submitted" && (
                <div className="flex items-center gap-2 text-sm text-amber-600">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Autograding failed</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {autogradingFailed && effectiveStatus === "submitted" && (
                <Button
                  onClick={handleRetryAutograde}
                  disabled={isRetryingAutograde}
                  variant="outline"
                  size="lg"
                  className="border-amber-600 text-amber-600 hover:bg-amber-50"
                >
                  {isRetryingAutograde ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Retrying...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Retry Autograding
                    </>
                  )}
                </Button>
              )}
              {(effectiveStatus === "submitted" || effectiveStatus === "graded") ? (
                allowResubmissions && !isSubmissionBlocked && (
                  <Button
                    onClick={handleUnsubmit}
                    disabled={isSubmitting}
                    variant="outline"
                    size="lg"
                    className="border-purple-600 text-purple-600 hover:bg-primary/10 dark:border-purple-400 dark:text-purple-400"
                  >
                    {isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Unsubmitting...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Unsubmit
                      </>
                    )}
                  </Button>
                )
              ) : (
                <Button
                  onClick={handleSubmit}
                  disabled={
                    isSubmitting ||
                    !submissionId ||
                    previewMode ||
                    isSubmissionBlocked
                  }
                  className="bg-purple-600 hover:bg-purple-700 dark:bg-purple-800 dark:hover:bg-purple-900 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                  size="lg"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : isSubmissionBlocked ? (
                    <>
                      <Clock className="w-4 h-4 mr-2" />
                      {timedExpired ? "Time Expired" : "Submissions Closed"}
                    </>
                  ) : hasPreviousSubmission ? (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Resubmit
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Submit Assignment
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submission Success Modal */}
      <SubmissionSuccessModal
        isOpen={showSuccessModal}
        onClose={() => setShowSuccessModal(false)}
        assignmentName={assignment.name}
        assignmentId={assignment.id}
        courseSlug={courseSlug}
      />

    </div>
  );
};

export default AssignmentViewer;
