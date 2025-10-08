import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import {
  getCoursePermissions,
  getUserCourseRole,
} from "../middleware/authorization";
import { UserRole, SubmissionStatus } from "../types/enums";
import { Submission, Grader, BlockScore } from "../types/entities";
import { AutogradeResponse } from "../types/api";

const router = Router();

/**
 * MCQ Block interface - represents a multiple choice question block
 */
interface MCQBlock {
  id: string;
  question: string;
  options: Array<{
    id: string;
    text: string;
    isCorrect: boolean;
  }>;
  allowMultiple: boolean;
  points: number;
  explanation?: string;
}

/**
 * Extract MCQ blocks from assignment content
 * Recursively traverses TipTap document structure to find all MCQ blocks
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8
 */
function extractMCQBlocks(assignmentContent: string): MCQBlock[] {
  try {
    const content = JSON.parse(assignmentContent);
    const mcqBlocks: MCQBlock[] = [];

    // Recursively traverse the TipTap document structure
    function traverse(node: any) {
      if (node.type === "mcqBlock" && node.attrs?.mcqData) {
        const mcqData = node.attrs.mcqData;

        // Validate MCQ data structure
        if (
          mcqData.id &&
          Array.isArray(mcqData.options) &&
          typeof mcqData.points === "number"
        ) {
          mcqBlocks.push(mcqData);
        } else {
          console.warn(
            `Invalid MCQ block data for block ${mcqData.id || "unknown"}`
          );
        }
      }

      // Recursively process child nodes
      if (node.content && Array.isArray(node.content)) {
        node.content.forEach(traverse);
      }
    }

    traverse(content);
    return mcqBlocks;
  } catch (error) {
    console.error("Failed to parse assignment content:", error);
    return [];
  }
}

/**
 * Calculate score for a single MCQ block
 * Awards full points for exact match, zero for incorrect/partial answers
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */
function calculateBlockScore(
  block: MCQBlock,
  studentAnswer: string[] | undefined
): number {
  // No answer provided
  if (!studentAnswer || !Array.isArray(studentAnswer)) {
    return 0;
  }

  // Get correct answer IDs
  const correctAnswerIds = block.options
    .filter((option) => option.isCorrect)
    .map((option) => option.id);

  // No correct answers defined
  if (correctAnswerIds.length === 0) {
    return 0;
  }

  // Sort arrays for comparison
  const sortedStudentAnswer = [...studentAnswer].sort();
  const sortedCorrectAnswers = [...correctAnswerIds].sort();

  // Check if arrays are equal (all correct answers selected, no incorrect ones)
  const isCorrect =
    sortedStudentAnswer.length === sortedCorrectAnswers.length &&
    sortedStudentAnswer.every(
      (answer, index) => answer === sortedCorrectAnswers[index]
    );

  return isCorrect ? block.points : 0;
}

/**
 * Calculate total possible points from MCQ blocks
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */
function calculateTotalPoints(mcqBlocks: MCQBlock[]): number {
  return mcqBlocks.reduce((total, block) => total + block.points, 0);
}

/**
 * Core autograding function
 * Fetches submission and assignment, calculates scores, creates/updates grader
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8
 */
export async function autogradeSubmission(submissionId: string): Promise<{
  grader: Grader;
  totalPossiblePoints: number;
}> {
  // 1. Fetch submission
  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select("*")
    .eq("id", submissionId)
    .single();

  if (submissionError || !submission) {
    throw new Error("Submission not found");
  }

  // 2. Fetch assignment
  const { data: assignment, error: assignmentError } = await supabase
    .from("assignments")
    .select("*")
    .eq("id", submission.assignment_id)
    .single();

  if (assignmentError || !assignment) {
    throw new Error("Assignment not found");
  }

  // 3. Parse assignment content to extract MCQ blocks
  const mcqBlocks = extractMCQBlocks(assignment.content);

  // 4. Calculate scores for each block
  const blockScores: Record<string, BlockScore> = {};
  let totalRawScore = 0;

  for (const block of mcqBlocks) {
    const studentAnswer = submission.values[block.id];
    const score = calculateBlockScore(block, studentAnswer);

    blockScores[block.id] = {
      awarded: score,
      possible: block.points,
    };

    totalRawScore += score;
  }

  // 5. Create or update grader object using upsert to handle race conditions
  // The unique constraint on submission_id ensures only one grader per submission
  const { data: grader, error: upsertError } = await supabase
    .from("graders")
    .upsert(
      {
        submission_id: submissionId,
        raw_assignment_score: totalRawScore,
        raw_rubric_score: 0,
        score_modifier: "",
        feedback: "",
        block_scores: blockScores,
        reviewed_at: null,
      },
      {
        onConflict: "submission_id",
        ignoreDuplicates: false, // Update if exists
      }
    )
    .select()
    .single();

  if (upsertError || !grader) {
    console.error("Failed to upsert grader:", upsertError);
    throw new Error("Failed to create or update grader");
  }

  // 6. Update submission status to graded
  // Note: grader_id is not set for autograded submissions (it's for manual grading by instructors)
  const { error: statusUpdateError } = await supabase
    .from("submissions")
    .update({
      status: SubmissionStatus.GRADED,
    })
    .eq("id", submissionId);

  if (statusUpdateError) {
    throw new Error("Failed to update submission status");
  }

  return { grader, totalPossiblePoints: calculateTotalPoints(mcqBlocks) };
}

/**
 * Check if user can autograde a specific submission
 * Students can only autograde their own submissions
 * Instructors/TAs can autograde any submission in their courses
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */
const canAutogradeSubmission = async (
  userId: string,
  submission: Submission,
  isAdmin: boolean = false
): Promise<{ canAutograde: boolean; message?: string; role?: UserRole }> => {
  // Admins can autograde anything
  if (isAdmin) {
    return { canAutograde: true, role: UserRole.ADMIN };
  }

  // Check if this is the student's own submission
  if (submission.student_id === userId) {
    return { canAutograde: true, role: UserRole.STUDENT };
  }

  // Get user's role in the course
  const userRole = await getUserCourseRole(userId, submission.course_id);

  // If user is not enrolled in the course, deny access
  if (!userRole) {
    return {
      canAutograde: false,
      message: "Not enrolled in the course containing this submission",
    };
  }

  // Students and Audit users can ONLY autograde their own submissions
  if (userRole === UserRole.STUDENT || userRole === UserRole.AUDIT) {
    return {
      canAutograde: false,
      message: "Students can only autograde their own submissions",
      role: userRole,
    };
  }

  // Check if user has grading permissions in the course
  const permissions = await getCoursePermissions(
    userId,
    submission.course_id,
    isAdmin
  );

  // Instructors and TAs with grading permissions can autograde all submissions
  if (permissions.canGrade || permissions.canManage) {
    return { canAutograde: true, role: userRole };
  }

  return {
    canAutograde: false,
    message: "Insufficient permissions to autograde this submission",
    role: userRole,
  };
};

/**
 * POST /api/autograder/grade/:submissionId
 * Autograde a submission by calculating scores for MCQ blocks
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8
 */
router.post(
  "/autograder/grade/:submissionId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { submissionId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Validate submission ID format
      if (!submissionId || typeof submissionId !== "string") {
        res.status(400).json({
          error: {
            code: "INVALID_SUBMISSION_ID",
            message: "Invalid submission ID format",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Fetch the submission (Requirement 11.1)
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("*")
        .eq("id", submissionId)
        .single();

      if (submissionError || !submission) {
        console.error("Submission not found:", submissionId, submissionError);
        res.status(404).json({
          error: {
            code: "SUBMISSION_NOT_FOUND",
            message: "Submission not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check authorization (Requirement 11.5)
      const authCheck = await canAutogradeSubmission(
        userId,
        submission,
        isAdmin
      );

      if (!authCheck.canAutograde) {
        console.warn("Authorization failed for autograding:", {
          userId,
          submissionId,
          message: authCheck.message,
        });
        res.status(403).json({
          error: {
            code: "ACCESS_DENIED",
            message:
              authCheck.message ||
              "Not authorized to autograde this submission",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Perform autograding
      const { grader, totalPossiblePoints } = await autogradeSubmission(
        submissionId
      );

      // Fetch assignment to check visibility settings (Requirement 11.2)
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("settings")
        .eq("id", submission.assignment_id)
        .single();

      if (assignmentError || !assignment) {
        console.error(
          "Assignment not found:",
          submission.assignment_id,
          assignmentError
        );
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Determine if scores should be visible
      const showScoreAfterSubmission =
        assignment.settings?.showScoreAfterSubmission ?? false;
      const isInstructorOrTA =
        authCheck.role === UserRole.INSTRUCTOR ||
        authCheck.role === UserRole.TEACHING_ASSISTANT ||
        authCheck.role === UserRole.ADMIN;

      // Format response based on visibility settings
      // Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8
      if (showScoreAfterSubmission || isInstructorOrTA) {
        // Return full score data
        const response: AutogradeResponse = {
          success: true,
          grader,
          totalPossiblePoints,
        };
        res.json(response);
      } else {
        // Return success without scores (for students when visibility is disabled)
        const response: AutogradeResponse = {
          success: true,
          message: "Assignment graded successfully",
        };
        res.json(response);
      }
    } catch (error) {
      // Comprehensive error handling (Requirements 11.3, 11.4, 11.6, 11.7, 11.8)
      console.error("Error autograding submission:", {
        submissionId: req.params.submissionId,
        userId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });

      // Check for specific error types
      if (error instanceof Error) {
        if (error.message === "Submission not found") {
          res.status(404).json({
            error: {
              code: "SUBMISSION_NOT_FOUND",
              message: "Submission not found",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }

        if (error.message === "Assignment not found") {
          res.status(404).json({
            error: {
              code: "ASSIGNMENT_NOT_FOUND",
              message: "Assignment not found",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }

        if (
          error.message.includes("Failed to parse") ||
          error.message.includes("parse assignment content")
        ) {
          res.status(500).json({
            error: {
              code: "INVALID_ASSIGNMENT_CONTENT",
              message:
                "Failed to parse assignment content. The assignment may be malformed.",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }

        if (
          error.message.includes("Failed to create grader") ||
          error.message.includes("Failed to update grader") ||
          error.message.includes("Failed to update submission status")
        ) {
          res.status(500).json({
            error: {
              code: "DATABASE_ERROR",
              message: "Database operation failed during autograding",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Generic error response
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to autograde submission. Please try again later.",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
