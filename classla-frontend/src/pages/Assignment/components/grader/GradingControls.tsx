import React, { useState, useEffect, useCallback, useRef } from "react";
import { Grader, RubricSchema, Rubric } from "../../../../types";
import { Input } from "../../../../components/ui/input";
import { Textarea } from "../../../../components/ui/textarea";
import { Checkbox } from "../../../../components/ui/checkbox";
import { Label } from "../../../../components/ui/label";
import { useToast } from "../../../../hooks/use-toast";
import { useEnsureGrader } from "../../../../hooks/useEnsureGrader";
import { Loader2 } from "lucide-react";
import { apiClient } from "../../../../lib/api";
import RubricGrading from "./rubric/RubricGrading";

interface GradingControlsProps {
  grader: Grader | null;
  assignmentId: string;
  studentId: string;
  courseId: string;
  submissionId?: string;
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
    submissionId,
    onUpdate,
    onGraderCreated,
    autoSave = true,
  }) => {
    const { toast } = useToast();
    const [isSaving, setIsSaving] = useState(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const [rubricSchema, setRubricSchema] = useState<RubricSchema | null>(null);
    const [rubric, setRubric] = useState<Rubric | null>(null);
    const [isLoadingRubric, setIsLoadingRubric] = useState(true);

    // Use the ensureGrader hook - don't auto-create submissions/graders
    const { grader, isCreating, ensureGrader } = useEnsureGrader(
      assignmentId,
      studentId,
      courseId,
      initialGrader,
      false
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

    // Load rubric schema and rubric instance
    useEffect(() => {
      const loadRubric = async () => {
        try {
          setIsLoadingRubric(true);
          // Load rubric schema
          const schemaResponse = await apiClient.getRubricSchema(assignmentId);
          const schema = schemaResponse.data;
          setRubricSchema(schema);

          // Load rubric instance if submission exists
          if (submissionId) {
            try {
              const rubricResponse = await apiClient.getRubric(submissionId);
              const rubricData = rubricResponse.data;
              setRubric(rubricData);

              // Calculate and update raw_rubric_score if grader exists
              if (grader && rubricData.values) {
                const rubricScore = rubricData.values.reduce(
                  (sum: number, val: number) => sum + val,
                  0
                );
                // Only update if the score is different
                if (grader.raw_rubric_score !== rubricScore) {
                  await onUpdate({ raw_rubric_score: rubricScore });
                }
              }
            } catch (error: any) {
              // 404 is expected if no rubric instance exists yet
              if (error.statusCode !== 404) {
                console.error("Failed to load rubric:", error);
              }
            }
          }
        } catch (error: any) {
          // 404 is expected if no rubric schema exists
          if (error.statusCode !== 404) {
            console.error("Failed to load rubric schema:", error);
          }
        } finally {
          setIsLoadingRubric(false);
        }
      };

      loadRubric();
    }, [assignmentId, submissionId, grader, onUpdate]);

    // Cleanup timeout on unmount
    useEffect(() => {
      return () => {
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
        }
      };
    }, []);

    // Calculate rubric score from values
    const calculateRubricScore = useCallback(
      (values: number[]): number => {
        if (!rubricSchema) return 0;
        return values.reduce((sum, val) => sum + val, 0);
      },
      [rubricSchema]
    );

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
    // Note: reviewed status is handled separately with immediate save, so we exclude it from debounced save
    useEffect(() => {
      if (!autoSave) return;

      // Clear existing timeout
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      // Only save if there are changes (excluding reviewed status which is saved immediately)
      const hasChanges =
        scoreModifier !== (grader?.score_modifier || "0") ||
        feedback !== (grader?.feedback || "");

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
    }, [scoreModifier, feedback, autoSave, grader]); // Removed isReviewed from dependencies

    const handleSave = async () => {
      setIsSaving(true);

      try {
        const updates: any = {
          score_modifier: scoreModifier,
          feedback,
        };

        // Note: reviewed status is NOT included in debounced auto-save
        // It's handled separately with immediate save in handleReviewedChange
        // This prevents race conditions where debounced save overwrites immediate save

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

    const handleRubricUpdate = async (values: number[]) => {
      if (!rubricSchema || !submissionId) return;

      try {
        const rubricScore = calculateRubricScore(values);

        if (rubric) {
          // Update existing rubric
          await apiClient.updateRubric(rubric.id, { values });
        } else {
          // Create new rubric
          const response = await apiClient.createRubric({
            submission_id: submissionId,
            rubric_schema_id: rubricSchema.id,
            values,
          });
          setRubric(response.data);
        }

        // Update grader's raw_rubric_score
        if (grader) {
          await onUpdate({ raw_rubric_score: rubricScore });
        }
      } catch (error) {
        console.error("Error updating rubric:", error);
        toast({
          title: "Error",
          description: "Failed to update rubric scores",
          variant: "destructive",
        });
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
      
      // Update local state immediately for responsive UI
      setIsReviewed(checked);
      
      // If auto-save is enabled, trigger immediate save for reviewed status changes
      // This ensures the change is saved right away rather than waiting for debounce
      if (autoSave && grader) {
        // Clear any pending debounced saves to prevent them from overwriting this change
        if (saveTimeoutRef.current) {
          clearTimeout(saveTimeoutRef.current);
          saveTimeoutRef.current = null;
        }
        
        try {
          const updates: any = {
            reviewed: checked,
          };
          await onUpdate(updates);
        } catch (error) {
          console.error("Failed to save reviewed status:", error);
          // Revert the checkbox state on error
          setIsReviewed(!checked);
          toast({
            title: "Error",
            description: "Failed to update reviewed status",
            variant: "destructive",
          });
        }
      }
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

    // Show skeleton loader while creating grader
    if (isCreating) {
      return (
        <div className="space-y-6 p-6 border border-border rounded-lg bg-card shadow-sm animate-pulse">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div className="h-6 bg-accent rounded w-40"></div>
            <div className="flex items-center">
              <Loader2 className="h-4 w-4 animate-spin text-primary mr-2" />
              <span className="text-sm text-primary font-medium">
                Initializing grading...
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="h-4 bg-accent rounded w-32"></div>
              <div className="h-10 bg-muted rounded"></div>
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-accent rounded w-32"></div>
              <div className="h-10 bg-muted rounded"></div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="h-4 bg-accent rounded w-28"></div>
              <div className="h-10 bg-muted rounded"></div>
            </div>
            <div className="space-y-2">
              <div className="h-4 bg-accent rounded w-24"></div>
              <div className="h-10 bg-muted rounded"></div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="h-4 bg-accent rounded w-20"></div>
            <div className="h-24 bg-muted rounded"></div>
          </div>

          <div className="flex items-center space-x-2">
            <div className="h-4 w-4 bg-accent rounded"></div>
            <div className="h-4 bg-accent rounded w-48"></div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-6 p-6 border border-border rounded-lg bg-card shadow-sm">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <h3 className="text-lg font-bold text-foreground">Grading Controls</h3>
          {isSaving && (
            <div className="flex items-center text-sm text-primary font-medium">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Autograded Score (read-only) */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-foreground">
              Autograded Score
            </Label>
            <div className="flex h-10 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground font-medium">
              {grader?.raw_assignment_score !== undefined
                ? `${grader.raw_assignment_score}`
                : "-"}
            </div>
          </div>

          {/* Raw Rubric Score (read-only) */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-foreground">
              Raw Rubric Score
            </Label>
            <div className="flex h-10 w-full rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground font-medium">
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
              className="text-sm font-semibold text-foreground"
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
              className="border-border focus:border-primary focus:ring-ring"
            />
          </div>

          {/* Final Grade (calculated, read-only) */}
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-foreground">
              Final Grade
            </Label>
            <div className="flex h-10 w-full rounded-md border-2 border-primary/30 bg-primary/10 px-3 py-2 text-sm font-bold text-primary">
              {finalGrade}
            </div>
          </div>
        </div>

        {/* Rubric Grading */}
        {!isLoadingRubric && rubricSchema && (
          <div className="pt-4">
            <RubricGrading
              rubricSchema={rubricSchema}
              rubric={rubric}
              onUpdate={handleRubricUpdate}
              disabled={isCreating}
            />
          </div>
        )}

        {/* Feedback textarea */}
        <div className="space-y-2">
          <Label
            htmlFor="feedback"
            className="text-sm font-semibold text-foreground"
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
            className="border-border focus:border-primary focus:ring-ring resize-none"
          />
        </div>

        {/* Reviewed checkbox */}
        <div className="flex items-center space-x-3 p-4 bg-muted rounded-md border border-border">
          <Checkbox
            id="reviewed"
            checked={isReviewed}
            onCheckedChange={handleReviewedChange}
            disabled={isCreating}
            className="data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
          />
          <Label
            htmlFor="reviewed"
            className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer text-foreground"
          >
            Mark as Reviewed
            {grader?.reviewed_at && (
              <span className="ml-2 text-xs text-muted-foreground font-normal">
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
