import { useState, useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/api";
import { Grader } from "../types";

/**
 * Hook to ensure a grader exists for a student's submission
 * Automatically creates submission and grader if they don't exist
 * Auto-triggers grader creation on mount if grader is missing
 *
 * @param assignmentId - The assignment ID
 * @param studentId - The student's user ID
 * @param courseId - The course ID
 * @param existingGrader - The existing grader object (if any)
 * @param autoCreate - Whether to automatically create grader on mount (default: true)
 * @returns Object with grader, isCreating state, ensureGrader function, and error
 */
export function useEnsureGrader(
  assignmentId: string,
  studentId: string,
  courseId: string,
  existingGrader: Grader | null,
  autoCreate: boolean = true
) {
  const [isCreating, setIsCreating] = useState(false);
  const [grader, setGrader] = useState<Grader | null>(existingGrader);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();
  const hasAttemptedCreate = useRef(false);

  /**
   * Ensures a grader exists, creating submission and grader if needed
   * Returns the grader object (existing or newly created)
   */
  const ensureGrader = useCallback(async (): Promise<Grader> => {
    // If grader already exists, return it
    if (grader) {
      return grader;
    }

    // If already creating, wait for it to complete
    if (isCreating) {
      throw new Error("Grader creation already in progress");
    }

    setIsCreating(true);
    setError(null);

    try {
      const response = await apiClient.createGraderWithSubmission({
        assignmentId,
        studentId,
        courseId,
      });

      const newGrader = response.data.grader;
      const submissionId = response.data.submission.id;

      // Trigger autograding to populate block_scores
      try {
        console.log(
          "[useEnsureGrader] Triggering autograding for submission:",
          submissionId
        );
        const autogradeResponse = await apiClient.autogradeSubmission(
          submissionId
        );
        console.log("[useEnsureGrader] Autograding response:", {
          hasGrader: !!autogradeResponse.data.grader,
          grader: autogradeResponse.data.grader,
          hasBlockScores: !!autogradeResponse.data.grader?.block_scores,
          blockScores: autogradeResponse.data.grader?.block_scores,
        });
        // Update grader with autograded data if available
        if (autogradeResponse.data.grader) {
          setGrader(autogradeResponse.data.grader);
        } else {
          setGrader(newGrader);
        }
      } catch (autogradeError) {
        console.error(
          "Autograding failed after grader creation:",
          autogradeError
        );
        // Still set the grader even if autograding fails
        setGrader(newGrader);
      }

      // Invalidate relevant queries to refresh data
      queryClient.invalidateQueries({
        queryKey: ["submissions", "with-students"],
      });
      queryClient.invalidateQueries({
        queryKey: ["gradebook"],
      });

      return newGrader;
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to create grader");
      setError(error);
      throw error;
    } finally {
      setIsCreating(false);
    }
  }, [assignmentId, studentId, courseId, grader, isCreating, queryClient]);

  // Auto-create grader on mount if it doesn't exist
  useEffect(() => {
    // Only auto-create if enabled and we haven't already attempted
    if (!autoCreate || hasAttemptedCreate.current) {
      return;
    }

    // If grader doesn't exist and we're not already creating, trigger creation
    if (!grader && !isCreating) {
      hasAttemptedCreate.current = true;
      ensureGrader().catch((err) => {
        console.error("Auto-create grader failed:", err);
        // Error is already set in ensureGrader, no need to set again
      });
    }
  }, [autoCreate, grader, isCreating, ensureGrader]);

  // Update grader state when existingGrader prop changes
  useEffect(() => {
    setGrader(existingGrader);
  }, [existingGrader]);

  return {
    grader,
    isCreating,
    ensureGrader,
    error,
  };
}
