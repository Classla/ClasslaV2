import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  startTransition,
} from "react";
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
import { DiscussionBlockViewer } from "../../../components/extensions/DiscussionBlockViewer";
import { validateMCQData, sanitizeMCQData } from "../../../components/extensions/MCQBlock";
import { Button } from "../../../components/ui/button";
import { apiClient } from "../../../lib/api";
import { useToast } from "../../../hooks/use-toast";
import SubmissionSuccessModal from "./SubmissionSuccessModal";
import { randomizeMCQBlocks } from "../../../utils/randomization";
import { Popover } from "../../../components/ui/popover";
import AssignmentContentSkeleton from "./AssignmentContentSkeleton";

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
  previewMode?: boolean; // If true, this is a teacher preview - disable all submissions
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
  previewMode = false,
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
  const allowResubmissions = assignment.settings?.allowResubmissions ?? false;

  // Viewer is read-only when:
  // 1. Explicitly locked (viewing submitted work or instructor viewing student work)
  // 2. Submission is submitted/graded and resubmissions are not allowed
  const isReadOnly =
    locked ||
    (!allowResubmissions &&
      (submissionStatus === "submitted" || submissionStatus === "graded"));

  // Performance optimization: Use refs to avoid unnecessary re-renders
  const editorRef = useRef<any>(null);
  const answerStateRef = useRef<AnswerState>({});

  // Fetch submission data when submissionId changes - always from backend
  useEffect(() => {
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
                    // Single string - could be answer, solution, or JSON
                    try {
                      const parsed = JSON.parse(value[0]);
                      if (typeof parsed === "object" && !Array.isArray(parsed)) {
                        // It's a matches or answers object
                        if (Object.keys(parsed).every((k) => typeof parsed[k] === "string")) {
                          // Check if it looks like answers (blankId -> answer) or matches (itemId -> zoneId)
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
                        // It's a regular string answer
                        newAnswerState[blockId] = {
                          answer: value[0],
                          timestamp: new Date(submission.timestamp),
                        };
                      }
                    } catch {
                      // Not JSON, it's a regular string answer
                      newAnswerState[blockId] = {
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
        console.error("Failed to fetch submission data:", error);
        startTransition(() => {
          setIsLoadingSubmission(false);
        });
      }
    };

    fetchSubmissionData();
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
      if (!isStudent) return; // Only students can save submissions
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
          } else {
            // Create new submission
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

        // Auto-save to backend if student
        if (isStudent) {
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

      // Auto-save to backend if student
      if (isStudent) {
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
    [answerState, saveAnswerState, onAnswerChange, isStudent, autoSaveSubmission]
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

      if (isStudent) {
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
    [answerState, saveAnswerState, onAnswerChange, isStudent, autoSaveSubmission]
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

      if (isStudent) {
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
    [answerState, saveAnswerState, onAnswerChange, isStudent, autoSaveSubmission]
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

      if (isStudent) {
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
    [answerState, saveAnswerState, onAnswerChange, isStudent, autoSaveSubmission]
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

      if (isStudent) {
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
    [answerState, saveAnswerState, onAnswerChange, isStudent, autoSaveSubmission]
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

      if (isStudent) {
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
    [answerState, saveAnswerState, onAnswerChange, isStudent, autoSaveSubmission]
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
                    "p-4 bg-red-50 border border-red-200 rounded-md my-4";
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
          <div class="p-4 bg-red-50 border border-red-200 rounded-md my-4" role="alert">
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
          <p className="text-gray-600">Loading assignment...</p>
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
        const score = autogradeResponse.data.grader.raw_assignment_score;
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
          const score = autogradeResponse.data.grader.raw_assignment_score;
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
  ]);

  return (
    <div className="h-full flex flex-col bg-white relative">
      {/* Preview Mode Banner */}
      {previewMode && (
        <div className="bg-amber-100 border-b border-amber-300 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-2">
            <span className="font-medium text-amber-800">
              Preview Mode - This is how students will see this assignment. Submissions are disabled.
            </span>
          </div>
        </div>
      )}

      {/* No Submission Banner */}
      {!hasSubmission && !previewMode && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-2">
            <AlertTriangle className="w-5 h-5 text-yellow-600" />
            <span className="font-medium text-yellow-800">
              No submission yet - This student has not submitted this assignment
            </span>
          </div>
        </div>
      )}

      {/* Submitted Banner */}
      {isStudent && submissionStatus === "submitted" && hasSubmission && (
        <div className="bg-green-600 text-white px-4 py-3 border-b border-green-700">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-medium">
              {showResponsesAfterSubmission
                ? "Assignment Submitted - You can view your responses below"
                : "Assignment Submitted - Your answers are locked"}
            </span>
          </div>
        </div>
      )}

      {/* Graded Banner */}
      {isStudent && submissionStatus === "graded" && hasSubmission && (
        <div className="bg-purple-600 text-white px-4 py-3 border-b border-purple-700">
          <div className="max-w-4xl mx-auto flex items-center justify-center gap-2">
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <span className="font-medium">
              Assignment Graded - View your results below
            </span>
          </div>
        </div>
      )}

      {/* Submission Selector Header */}
      {isStudent && hasSubmission && allSubmissions.length > 1 && (
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <div className="max-w-4xl mx-auto flex items-center justify-end">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Viewing:</span>
              <Popover
                trigger={
                  <button className="flex items-center gap-2 text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white hover:border-gray-400 hover:bg-gray-50 transition-colors">
                    <span>
                      {allSubmissions.findIndex(
                        (s) => s.id === (selectedSubmissionId || submissionId)
                      ) === 0
                        ? "Latest Submission"
                        : `Submission ${
                            allSubmissions.length -
                            allSubmissions.findIndex(
                              (s) =>
                                s.id === (selectedSubmissionId || submissionId)
                            )
                          }`}
                    </span>
                    <ChevronDown className="w-4 h-4 text-gray-500" />
                  </button>
                }
                content={
                  <div className="w-80 max-h-96 overflow-y-auto">
                    <div className="p-3 border-b bg-gray-50">
                      <h3 className="font-semibold text-gray-900">
                        Submission History
                      </h3>
                      <p className="text-xs text-gray-600 mt-1">
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
                        const timestamp = new Date(
                          sub.timestamp
                        ).toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        });

                        return (
                          <button
                            key={sub.id}
                            onClick={() => onSubmissionSelect?.(sub.id)}
                            className={`w-full p-3 text-left hover:bg-gray-50 transition-colors ${
                              isSelected
                                ? "bg-purple-50 border-l-4 border-purple-600"
                                : ""
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <Clock className="w-4 h-4 text-gray-400" />
                                  <span className="text-sm font-medium text-gray-900">
                                    {label}
                                  </span>
                                </div>
                                <p className="text-xs text-gray-600 mt-1 ml-6">
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
                                      : "bg-blue-100 text-blue-700"
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
                className="right-0"
              />
            </div>
          </div>
        </div>
      )}

      {/* Content Error Banner */}
      {contentError && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3">
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
      <div className="flex-1 overflow-auto pb-24">
        {submissionStatus === "submitted" && !showResponsesAfterSubmission ? (
          // Show submission success screen when responses are disabled
          <div className="max-w-2xl mx-auto p-8">
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
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
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Assignment Submitted Successfully
              </h2>
              <p className="text-gray-600 mb-6">
                Your submission has been recorded and will be reviewed by your
                instructor.
              </p>
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <div className="text-sm text-gray-600 mb-1">Submitted at</div>
                <div className="text-lg font-medium text-gray-900">
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
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <p className="text-sm text-blue-800">
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
          <div className="max-w-4xl mx-auto p-8 relative">
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
        <div className="sticky bottom-0 left-0 right-0 border-t border-gray-200 bg-white shadow-lg z-40">
          <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-4">
              {submissionStatus === "submitted" && (
                <div className="text-sm font-medium text-blue-600">
                  ✓ Submitted
                </div>
              )}
              {submissionStatus === "graded" && (
                <div className="text-sm font-medium text-purple-600">
                  ✓ Graded
                </div>
              )}
              {submissionStatus === "in-progress" && (
                <div className="text-sm text-gray-600">In Progress</div>
              )}
              {autogradingFailed && submissionStatus === "submitted" && (
                <div className="flex items-center gap-2 text-sm text-amber-600">
                  <AlertTriangle className="w-4 h-4" />
                  <span>Autograding failed</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              {autogradingFailed && submissionStatus === "submitted" && (
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
              {allowResubmissions && submissionStatus === "submitted" && (
                <Button
                  onClick={handleResubmit}
                  disabled={isSubmitting}
                  variant="outline"
                  size="lg"
                  className="border-purple-600 text-purple-600 hover:bg-purple-50"
                >
                  {isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Resubmit
                    </>
                  )}
                </Button>
              )}
              <Button
                onClick={handleSubmit}
                disabled={
                  isSubmitting ||
                  submissionStatus === "submitted" ||
                  submissionStatus === "graded" ||
                  !submissionId ||
                  previewMode
                }
                className="bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50 disabled:cursor-not-allowed"
                size="lg"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Submitting...
                  </>
                ) : submissionStatus === "submitted" ? (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Submitted
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4 mr-2" />
                    Submit Assignment
                  </>
                )}
              </Button>
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
