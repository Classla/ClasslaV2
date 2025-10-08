import React, { useState, useEffect, useCallback, useRef } from "react";
import { Grader } from "../types";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { useToast } from "../hooks/use-toast";
import { useEnsureGrader } from "../hooks/useEnsureGrader";
import { Loader2 } from "lucide-react";

interface GradingControlsProps {
  grader: Grader | null;
  assignmentId: string;
  studentId: string;
  courseId: string;
  onUpdate: (updates: Partial<Grader>) => void;
  onGraderCreated?: (grader: Grader) => void;
  autoSave?: boolean;
}

export const GradingControls: React.FC<GradingControlsProps> = React.memo(
  ({
    grader: initialGrader,
    assignmentId,
    studentId,
    courseId,
    onUpdate,
    onGraderCreated,
    autoSave = true,
  }) => {
    const { toast } = useToast();
    const [isSaving, setIsSaving] = useState(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Use the ensureGrader hook for auto-creation
    const { grader, isCreating, ensureGrader } = useEnsureGrader(
      assignmentId,
      studentId,
      courseId,
      initialGrader
    );

    // Notify parent when grader is created/updated
    useEffect(() => {
      if (grader && onGraderCreated) {
        console.log("[GradingControls] Notifying parent of grader:", {
          grader,
          hasBlockScores: !!grader.block_scores,
          blockScores: grader.block_scores,
        });
        onGraderCreated(grader);
      }
    }, [grader, onGraderCreated]);

    // Local state for form fields
    const [scoreModifier, setScoreModifier] = useState(
      grader?.score_modifier || "0"
    );
    const [feedback, setFeedback] = useState(grader?.feedback || "");
    const [isReviewed, setIsReviewed] = useState(!!grader?.reviewed_at);

    // Update local state when grader prop changes
    useEffect(() => {
      setScoreModifier(grader?.score_modifier || "0");
      setFeedback(grader?.feedback || "");
      setIsReviewed(!!grader?.reviewed_at);
    }, [grader]);

    // Cleanup timeout on unmount
    useEffect(() => {
      return () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
      };
    }, []);

    // Calculate final grade
    const calculateFinalGrade = useCallback(
      (modifier: string): number => {
        const rawAssignmentScore = grader?.raw_assignment_score || 0;
        const rawRubricScore = grader?.raw_rubric_score || 0;
        const baseScore = rawAssignmentScore + rawRubricScore;
        const modifierValue = parseFloat(modifier) || 0;
        return baseScore + modifierValue;
      },
      [grader]
    );

    const finalGrade = calculateFinalGrade(scoreModifier);

    // Debounced auto-save (500ms)
    useEffect(() => {
      if (!autoSave) return;

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Only save if there are changes
      const hasChanges =
        scoreModifier !== (grader?.score_modifier || "0") ||
        feedback !== (grader?.feedback || "") ||
        isReviewed !== !!grader?.reviewed_at;

      if (hasChanges) {
        saveTimeoutRef.current = setTimeout(() => {
          handleSave();
        }, 500);
      }

      return () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
      };
    }, [scoreModifier, feedback, isReviewed, autoSave, grader]);

    const handleSave = async () => {
      setIsSaving(true);

      try {
        const updates: any = {
          score_modifier: scoreModifier,
          feedback,
        };

        // Only update reviewed status if the checkbox state changed
        // Backend expects 'reviewed' boolean, not 'reviewed_at' timestamp
        if (isReviewed !== !!grader?.reviewed_at) {
          updates.reviewed = isReviewed;
        }

        await onUpdate(updates);

        // Show success toast for manual saves
        if (!autoSave) {
          toast({
            title: "Saved",
            description: "Grading information saved successfully",
          });
        }
      } catch (error) {
        console.error("Error saving grading information:", error);
        toast({
          title: "Error",
          description: "Failed to save grading information",
          variant: "destructive",
        });
      } finally {
        setIsSaving(false);
      }
    };

    const handleScoreModifierChange = (
      e: React.ChangeEvent<HTMLInputElement>
    ) => {
      const value = e.target.value;
      // Allow empty string, negative sign, or valid numbers
      if (value === "" || value === "-" || !isNaN(parseFloat(value))) {
        setScoreModifier(value);
      }
    };

    const handleFeedbackChange = (
      e: React.ChangeEvent<HTMLTextAreaElement>
    ) => {
      setFeedback(e.target.value);
    };

    const handleReviewedChange = async (checked: boolean) => {
      // Ensure grader exists before updating reviewed status
      if (!grader && !isCreating) {
        try {
          await ensureGrader();
        } catch (error) {
          console.error("Failed to create grader:", error);
          toast({
            title: "Error",
            description: "Failed to initialize grading. Please try again.",
            variant: "destructive",
          });
          return; // Don't update the checkbox if creation failed
        }
      }
      setIsReviewed(checked);
    };

    // Handle focus on input fields - ensure grader exists before allowing input
    const handleFocus = async () => {
      if (!grader && !isCreating) {
        try {
          await ensureGrader();
        } catch (error) {
          console.error("Failed to create grader:", error);
          toast({
            title: "Error",
            description: "Failed to initialize grading. Please try again.",
            variant: "destructive",
          });
        }
      }
    };

    return (
      <div className="space-y-6 p-6 border border-gray-200 rounded-lg bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 pb-4">
          <h3 className="text-lg font-bold text-gray-900">Grading Controls</h3>
          {isSaving && (
            <div className="flex items-center text-sm text-purple-600 font-medium">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </div>
          )}
        </div>

        {/* Loading indicator during grader creation */}
        {isCreating && (
          <div className="flex items-center justify-center p-4 bg-purple-50 rounded-md border border-purple-200">
            <Loader2 className="h-5 w-5 animate-spin text-purple-600 mr-2" />
            <span className="text-sm text-purple-900 font-medium">
              Initializing grading...
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Autograded Score (read-only) */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-gray-700">
              Autograded Score
            </Label>
            <div className="flex h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 font-medium">
              {grader?.raw_assignment_score !== undefined
                ? `${grader.raw_assignment_score}`
                : "-"}
            </div>
          </div>

          {/* Raw Rubric Score (read-only) */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-gray-700">
              Raw Rubric Score
            </Label>
            <div className="flex h-10 w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm text-gray-700 font-medium">
              {grader?.raw_rubric_score !== undefined
                ? `${grader.raw_rubric_score}`
                : "-"}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Score Modifier (editable) */}
          <div className="space-y-2">
            <Label
              htmlFor="score-modifier"
              className="text-sm font-semibold text-gray-700"
            >
              Score Modifier
            </Label>
            <Input
              id="score-modifier"
              type="text"
              value={scoreModifier}
              onChange={handleScoreModifierChange}
              onFocus={handleFocus}
              disabled={isCreating}
              placeholder="0"
              className="border-gray-300 focus:border-purple-500 focus:ring-purple-500"
            />
          </div>

          {/* Final Grade (calculated, read-only) */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-gray-700">
              Final Grade
            </Label>
            <div className="flex h-10 w-full rounded-md border-2 border-purple-200 bg-purple-50 px-3 py-2 text-sm font-bold text-purple-900">
              {finalGrade}
            </div>
          </div>
        </div>

        {/* Feedback textarea */}
        <div className="space-y-2">
          <Label
            htmlFor="feedback"
            className="text-sm font-semibold text-gray-700"
          >
            Feedback
          </Label>
          <Textarea
            id="feedback"
            value={feedback}
            onChange={handleFeedbackChange}
            onFocus={handleFocus}
            disabled={isCreating}
            placeholder="Enter feedback for the student..."
            rows={6}
            className="border-gray-300 focus:border-purple-500 focus:ring-purple-500 resize-none"
          />
        </div>

        {/* Reviewed checkbox */}
        <div className="flex items-center space-x-3 p-4 bg-gray-50 rounded-md border border-gray-200">
          <Checkbox
            id="reviewed"
            checked={isReviewed}
            onCheckedChange={handleReviewedChange}
            disabled={isCreating}
            className="data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
          />
          <Label
            htmlFor="reviewed"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer text-gray-900"
          >
            Mark as Reviewed
            {grader?.reviewed_at && (
              <span className="ml-2 text-xs text-gray-500 font-normal">
                (Last reviewed: {new Date(grader.reviewed_at).toLocaleString()})
              </span>
            )}
          </Label>
        </div>
      </div>
    );
  }
);

GradingControls.displayName = "GradingControls";
