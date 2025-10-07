import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../lib/api";
import { Grader } from "../types";

/**
 * Hook to ensure a grader exists for a student's submission
 * Automatically creates submission and grader if they don't exist
 *
 * @param assignmentId - The assignment ID
 * @param studentId - The student's user ID
 * @param courseId - The course ID
 * @param existingGrader - The existing grader object (if any)
 * @returns Object with grader, isCreating state, ensureGrader function, and error
 */
export function useEnsureGrader(
  assignmentId: string,
  studentId: string,
  courseId: string,
  existingGrader: Grader | null
) {
  const [isCreating, setIsCreating] = useState(false);
  const [grader, setGrader] = useState<Grader | null>(existingGrader);
  const [error, setError] = useState<Error | null>(null);
  const queryClient = useQueryClient();

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
      setGrader(newGrader);

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

  return {
    grader,
    isCreating,
    ensureGrader,
    error,
  };
}
