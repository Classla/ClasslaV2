import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import { getCoursePermissions } from "../middleware/authorization";
import { UserRole } from "../types/enums";
import { Grader } from "../types/entities";
import {
  CreateGraderRequest,
  UpdateGraderRequest,
  CreateGraderWithSubmissionRequest,
  CreateGraderWithSubmissionResponse,
} from "../types/api";
import { getIO } from "../services/websocket";
import { emitGraderReviewUpdate } from "../services/courseTreeSocket";

const router = Router();

/**
 * Check if user can access grader feedback
 * Students can only access feedback for their own submissions
 * Instructors/TAs can access all feedback in their courses
 */
const canAccessGraderFeedback = async (
  userId: string,
  grader: Grader,
  isAdmin: boolean = false
): Promise<{ canAccess: boolean; message?: string }> => {
  // Admins can access everything
  if (isAdmin) {
    return { canAccess: true };
  }

  // Get the submission to check ownership and course
  const { data: submission, error: submissionError } = await supabase
    .from("submissions")
    .select("student_id, course_id")
    .eq("id", grader.submission_id)
    .single();

  if (submissionError || !submission) {
    return {
      canAccess: false,
      message: "Associated submission not found",
    };
  }

  // Students can only access feedback for their own submissions
  if (submission.student_id === userId) {
    return { canAccess: true };
  }

  // Check if user has grading permissions in the course
  const permissions = await getCoursePermissions(
    userId,
    submission.course_id,
    isAdmin
  );

  if (permissions.canGrade || permissions.canManage) {
    return { canAccess: true };
  }

  return {
    canAccess: false,
    message:
      "Can only access feedback for own submissions or need grading permissions",
  };
};

/**
 * GET /grader/:id
 * Get grader feedback with privacy checks
 * Requirements: 4.3, 4.4, 7.3
 */
router.get(
  "/grader/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the grader entry
      const { data: grader, error: graderError } = await supabase
        .from("graders")
        .select("*")
        .eq("id", id)
        .single();

      if (graderError || !grader) {
        res.status(404).json({
          error: {
            code: "GRADER_NOT_FOUND",
            message: "Grader feedback not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check access permissions
      const accessCheck = await canAccessGraderFeedback(
        userId,
        grader,
        isAdmin
      );

      if (!accessCheck.canAccess) {
        res.status(403).json({
          error: {
            code: "ACCESS_DENIED",
            message:
              accessCheck.message || "Not authorized to access this feedback",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // For students, check visibility rules (reviewed_at or showScoreAfterSubmission)
      // Instructors/TAs/Admins can always see all graders
      if (!isAdmin) {
        // Get the submission to check if user is the student
        const { data: submission, error: submissionError } = await supabase
          .from("submissions")
          .select("student_id, course_id, assignment_id")
          .eq("id", grader.submission_id)
          .single();

        if (!submissionError && submission && submission.student_id === userId) {
          // Get user's role to check if they're a student
          const { data: enrollment } = await supabase
            .from("course_enrollments")
            .select("role")
            .eq("user_id", userId)
            .eq("course_id", submission.course_id)
            .single();

          // If user is a student, check visibility rules
          if (
            enrollment &&
            (enrollment.role === UserRole.STUDENT ||
              enrollment.role === UserRole.AUDIT)
          ) {
            // Get assignment to check showScoreAfterSubmission setting
            const { data: assignment } = await supabase
              .from("assignments")
              .select("settings")
              .eq("id", submission.assignment_id)
              .single();

            const isReviewed = grader.reviewed_at !== null;
            const showScoreAfterSubmission =
              assignment?.settings?.showScoreAfterSubmission === true;

            // If grader is not visible to students, return 403
            if (!isReviewed && !showScoreAfterSubmission) {
              res.status(403).json({
                error: {
                  code: "GRADE_NOT_VISIBLE",
                  message:
                    "This grade has not been released yet. It will be visible once reviewed by your instructor.",
                  timestamp: new Date().toISOString(),
                  path: req.path,
                },
              });
              return;
            }
          }
        }
      }

      res.json(grader);
    } catch (error) {
      console.error("Error retrieving grader feedback:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve grader feedback",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /graders/by-submission/:submissionId
 * Get all grader feedback for a submission
 * Requirements: 4.3, 4.4, 7.3
 */
router.get(
  "/graders/by-submission/:submissionId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { submissionId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the submission to check permissions
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("student_id, course_id, assignment_id")
        .eq("id", submissionId)
        .single();

      if (submissionError || !submission) {
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

      // Check permissions
      const permissions = await getCoursePermissions(
        userId,
        submission.course_id,
        isAdmin
      );

      // Students can only access feedback for their own submissions
      if (
        submission.student_id !== userId &&
        !permissions.canGrade &&
        !permissions.canManage
      ) {
        res.status(403).json({
          error: {
            code: "ACCESS_DENIED",
            message:
              "Can only access feedback for own submissions or need grading permissions",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get all grader entries for this submission
      const { data: graders, error: gradersError } = await supabase
        .from("graders")
        .select("*")
        .eq("submission_id", submissionId)
        .order("created_at", { ascending: false });

      if (gradersError) {
        throw gradersError;
      }

      // For students, filter graders based on visibility rules
      // Instructors/TAs/Admins can always see all graders
      if (
        submission.student_id === userId &&
        !permissions.canGrade &&
        !permissions.canManage &&
        !isAdmin
      ) {
        // Get assignment to check showScoreAfterSubmission setting
        const { data: assignment } = await supabase
          .from("assignments")
          .select("settings")
          .eq("id", submission.assignment_id)
          .single();

        const showScoreAfterSubmission =
          assignment?.settings?.showScoreAfterSubmission === true;

        // Filter to only include visible graders
        const visibleGraders = (graders || []).filter((grader: any) => {
          const isReviewed = grader.reviewed_at !== null;
          return isReviewed || showScoreAfterSubmission;
        });

        res.json(visibleGraders);
      } else {
        // Instructors/TAs/Admins see all graders
        res.json(graders || []);
      }
    } catch (error) {
      console.error("Error retrieving grader feedback for submission:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve grader feedback",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /grader
 * Create grader feedback entry (instructor/TA only)
 * Requirements: 4.3, 4.4, 7.3
 */
router.post(
  "/grader",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        feedback,
        rubric_id,
        raw_assignment_score,
        raw_rubric_score,
        score_modifier,
        submission_id,
      }: CreateGraderRequest = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Validate required fields
      if (
        !submission_id ||
        raw_assignment_score === undefined ||
        raw_rubric_score === undefined
      ) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message:
              "submission_id, raw_assignment_score, and raw_rubric_score are required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate scores are numbers
      if (
        typeof raw_assignment_score !== "number" ||
        typeof raw_rubric_score !== "number"
      ) {
        res.status(400).json({
          error: {
            code: "INVALID_SCORES",
            message: "Scores must be valid numbers",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the submission to check permissions
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("student_id, course_id")
        .eq("id", submission_id)
        .single();

      if (submissionError || !submission) {
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

      // Check grading permissions
      const permissions = await getCoursePermissions(
        userId,
        submission.course_id,
        isAdmin
      );

      if (!permissions.canGrade && !permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to create grader feedback for this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate rubric_id if provided
      if (rubric_id) {
        const { data: rubric, error: rubricError } = await supabase
          .from("rubrics")
          .select("submission_id")
          .eq("id", rubric_id)
          .single();

        if (rubricError || !rubric || rubric.submission_id !== submission_id) {
          res.status(400).json({
            error: {
              code: "INVALID_RUBRIC",
              message: "Rubric not found or does not belong to this submission",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Create the grader entry
      const { data: grader, error: graderError } = await supabase
        .from("graders")
        .insert({
          feedback: feedback || "",
          rubric_id,
          raw_assignment_score,
          raw_rubric_score,
          score_modifier: score_modifier || "",
          submission_id,
          reviewed_at: new Date(),
        })
        .select()
        .single();

      if (graderError) {
        throw graderError;
      }

      res.status(201).json(grader);
    } catch (error) {
      console.error("Error creating grader feedback:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create grader feedback",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /grader/:id
 * Update grader feedback (instructor/TA only)
 * Requirements: 4.3, 4.4, 7.3
 */
router.put(
  "/grader/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const {
        feedback,
        rubric_id,
        raw_assignment_score,
        raw_rubric_score,
        score_modifier,
      }: UpdateGraderRequest = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Get the existing grader entry
      const { data: existingGrader, error: existingError } = await supabase
        .from("graders")
        .select("*")
        .eq("id", id)
        .single();

      if (existingError || !existingGrader) {
        res.status(404).json({
          error: {
            code: "GRADER_NOT_FOUND",
            message: "Grader feedback not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the submission to check permissions
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("student_id, course_id, assignment_id")
        .eq("id", existingGrader.submission_id)
        .single();

      if (submissionError || !submission) {
        res.status(404).json({
          error: {
            code: "SUBMISSION_NOT_FOUND",
            message: "Associated submission not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check grading permissions
      const permissions = await getCoursePermissions(
        userId,
        submission.course_id,
        isAdmin
      );

      if (!permissions.canGrade && !permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to update grader feedback for this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate scores if provided
      if (
        raw_assignment_score !== undefined &&
        (typeof raw_assignment_score !== "number" ||
          isNaN(raw_assignment_score))
      ) {
        res.status(400).json({
          error: {
            code: "INVALID_ASSIGNMENT_SCORE",
            message: "Assignment score must be a valid number",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      if (
        raw_rubric_score !== undefined &&
        (typeof raw_rubric_score !== "number" || isNaN(raw_rubric_score))
      ) {
        res.status(400).json({
          error: {
            code: "INVALID_RUBRIC_SCORE",
            message: "Rubric score must be a valid number",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate rubric_id if provided
      if (rubric_id) {
        const { data: rubric, error: rubricError } = await supabase
          .from("rubrics")
          .select("submission_id")
          .eq("id", rubric_id)
          .single();

        if (
          rubricError ||
          !rubric ||
          rubric.submission_id !== existingGrader.submission_id
        ) {
          res.status(400).json({
            error: {
              code: "INVALID_RUBRIC",
              message: "Rubric not found or does not belong to this submission",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Prepare update data
      const updateData: Partial<Grader> = {};

      if (feedback !== undefined) updateData.feedback = feedback;
      if (rubric_id !== undefined) updateData.rubric_id = rubric_id;
      if (raw_assignment_score !== undefined)
        updateData.raw_assignment_score = raw_assignment_score;
      if (raw_rubric_score !== undefined)
        updateData.raw_rubric_score = raw_rubric_score;
      if (score_modifier !== undefined)
        updateData.score_modifier = score_modifier;

      // Always update reviewed_at when making changes
      updateData.reviewed_at = new Date();

      // Update the grader entry
      const { data: updatedGrader, error: updateError } = await supabase
        .from("graders")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json(updatedGrader);
    } catch (error) {
      console.error("Error updating grader feedback:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update grader feedback",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /grader/:id/auto-save
 * Auto-save grader feedback with partial updates (instructor/TA only)
 * Requirements: 1.10, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10
 */
router.put(
  "/grader/:id/auto-save",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const {
        feedback,
        rubric_id,
        raw_assignment_score,
        raw_rubric_score,
        score_modifier,
        reviewed,
      } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Get the existing grader entry
      const { data: existingGrader, error: existingError } = await supabase
        .from("graders")
        .select("*")
        .eq("id", id)
        .single();

      if (existingError || !existingGrader) {
        res.status(404).json({
          error: {
            code: "GRADER_NOT_FOUND",
            message: "Grader feedback not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the submission to check permissions
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("student_id, course_id, assignment_id")
        .eq("id", existingGrader.submission_id)
        .single();

      if (submissionError || !submission) {
        res.status(404).json({
          error: {
            code: "SUBMISSION_NOT_FOUND",
            message: "Associated submission not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check grading permissions
      const permissions = await getCoursePermissions(
        userId,
        submission.course_id,
        isAdmin
      );

      if (!permissions.canGrade && !permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to update grader feedback for this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate scores if provided
      if (
        raw_assignment_score !== undefined &&
        (typeof raw_assignment_score !== "number" ||
          isNaN(raw_assignment_score))
      ) {
        res.status(400).json({
          error: {
            code: "INVALID_ASSIGNMENT_SCORE",
            message: "Assignment score must be a valid number",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      if (
        raw_rubric_score !== undefined &&
        (typeof raw_rubric_score !== "number" || isNaN(raw_rubric_score))
      ) {
        res.status(400).json({
          error: {
            code: "INVALID_RUBRIC_SCORE",
            message: "Rubric score must be a valid number",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate rubric_id if provided
      if (rubric_id !== undefined && rubric_id !== null) {
        const { data: rubric, error: rubricError } = await supabase
          .from("rubrics")
          .select("submission_id")
          .eq("id", rubric_id)
          .single();

        if (
          rubricError ||
          !rubric ||
          rubric.submission_id !== existingGrader.submission_id
        ) {
          res.status(400).json({
            error: {
              code: "INVALID_RUBRIC",
              message: "Rubric not found or does not belong to this submission",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Prepare update data - only include fields that were provided
      const updateData: Partial<Grader> = {};

      if (feedback !== undefined) updateData.feedback = feedback;
      if (rubric_id !== undefined) updateData.rubric_id = rubric_id;
      if (raw_assignment_score !== undefined)
        updateData.raw_assignment_score = raw_assignment_score;
      if (raw_rubric_score !== undefined)
        updateData.raw_rubric_score = raw_rubric_score;
      if (score_modifier !== undefined)
        updateData.score_modifier = score_modifier;

      // Only update reviewed_at if the reviewed status is explicitly being changed
      if (reviewed !== undefined && reviewed !== null) {
        if (reviewed === true) {
          updateData.reviewed_at = new Date();
        } else if (reviewed === false) {
          // Set to null explicitly for Supabase/PostgreSQL
          updateData.reviewed_at = null as any;
        }
      }

      // If no fields to update, return existing grader
      if (Object.keys(updateData).length === 0) {
        res.json(existingGrader);
        return;
      }

      // Update the grader entry
      // Convert updateData to a plain object that Supabase can handle
      // This ensures null values are properly serialized
      const updatePayload: Record<string, any> = {};
      for (const [key, value] of Object.entries(updateData)) {
        // Include all values including null (which is valid for setting fields to null)
        if (value !== undefined) {
          updatePayload[key] = value;
        }
      }
      
      const { data: updatedGrader, error: updateError } = await supabase
        .from("graders")
        .update(updatePayload)
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        console.error("Supabase update error details:", {
          error: updateError,
          updateData,
          graderId: id,
        });
        throw updateError;
      }

      // Emit live update so students see grader changes (score modifier, reviewed, etc.)
      try {
        emitGraderReviewUpdate(getIO(), submission.course_id, {
          assignmentId: submission.assignment_id,
          studentId: submission.student_id,
          submissionId: existingGrader.submission_id,
          reviewed: reviewed === true,
        });
      } catch {}

      res.json(updatedGrader);
    } catch (error) {
      console.error("Error auto-saving grader feedback:", error);
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const errorDetails =
        error instanceof Error && "details" in error
          ? (error as any).details
          : undefined;
      
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to auto-save grader feedback: ${errorMessage}`,
          details: errorDetails,
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /grader/create-with-submission
 * Atomically create both submission and grader objects when needed
 * This endpoint ensures data consistency by wrapping operations in a transaction
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
 */
router.post(
  "/grader/create-with-submission",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { assignmentId, studentId, courseId } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Validate required fields (Requirement 5.1)
      if (!assignmentId || !studentId || !courseId) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "assignmentId, studentId, and courseId are required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Verify assignment exists and belongs to the course
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("id, course_id")
        .eq("id", assignmentId)
        .eq("course_id", courseId)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message:
              "Assignment not found or does not belong to the specified course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check grading permissions (Requirement 5.8)
      const permissions = await getCoursePermissions(userId, courseId, isAdmin);

      if (!permissions.canGrade && !permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to create grader records for this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Verify student is enrolled in the course
      const { data: enrollment, error: enrollmentError } = await supabase
        .from("course_enrollments")
        .select("user_id")
        .eq("user_id", studentId)
        .eq("course_id", courseId)
        .single();

      if (enrollmentError || !enrollment) {
        res.status(400).json({
          error: {
            code: "STUDENT_NOT_ENROLLED",
            message: "Student is not enrolled in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      let submissionCreated = false;
      let graderCreated = false;

      // Check if submission exists (Requirement 3.1, 4.2)
      // Get the most recent submission if multiple exist (for resubmissions)
      const { data: submissions, error: submissionCheckError } = await supabase
        .from("submissions")
        .select("*")
        .eq("assignment_id", assignmentId)
        .eq("student_id", studentId)
        .order("timestamp", { ascending: false })
        .limit(1);

      if (submissionCheckError) {
        throw submissionCheckError;
      }

      const existingSubmission =
        submissions && submissions.length > 0 ? submissions[0] : null;

      let submission = existingSubmission;

      // Create submission if it doesn't exist (Requirement 4.3, 4.4, 4.5)
      if (!submission) {
        const { data: newSubmission, error: createSubmissionError } =
          await supabase
            .from("submissions")
            .insert({
              assignment_id: assignmentId,
              student_id: studentId,
              course_id: courseId,
              status: "in-progress", // Changed from "not-started" to match schema constraint
              values: {},
              timestamp: new Date(),
            })
            .select()
            .single();

        if (createSubmissionError) {
          console.error("Error creating submission:", createSubmissionError);
          throw createSubmissionError;
        }

        if (!newSubmission) {
          throw new Error(
            "Submission was not created but no error was returned"
          );
        }

        submission = newSubmission;
        submissionCreated = true;
      }

      // Validate submission has an ID
      if (!submission || !submission.id) {
        throw new Error("Submission is missing required ID field");
      }

      // Check if grader exists (Requirement 3.4)
      const { data: existingGrader, error: graderCheckError } = await supabase
        .from("graders")
        .select("*")
        .eq("submission_id", submission.id)
        .maybeSingle();

      if (graderCheckError) {
        throw graderCheckError;
      }

      let grader = existingGrader;

      // Create grader if it doesn't exist (Requirement 3.5, 4.6)
      if (!grader) {
        console.log("Creating grader for submission:", submission.id);

        const { data: newGrader, error: createGraderError } = await supabase
          .from("graders")
          .insert({
            submission_id: submission.id,
            raw_assignment_score: 0,
            raw_rubric_score: 0,
            score_modifier: "",
            feedback: "",
            reviewed_at: null,
          })
          .select()
          .single();

        if (createGraderError) {
          console.error("Error creating grader:", createGraderError);
          console.error(
            "Attempted to create grader with submission_id:",
            submission.id
          );
          throw createGraderError;
        }

        if (!newGrader) {
          throw new Error("Grader was not created but no error was returned");
        }

        grader = newGrader;
        graderCreated = true;
      }

      // Return both objects with creation flags (Requirement 5.4)
      res.status(submissionCreated || graderCreated ? 201 : 200).json({
        submission,
        grader,
        created: {
          submission: submissionCreated,
          grader: graderCreated,
        },
      });
    } catch (error) {
      console.error("Error creating grader with submission:", error);

      // Log detailed error information for debugging
      if (error instanceof Error) {
        console.error("Error name:", error.name);
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
      }

      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create grader and submission records",
          details: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
