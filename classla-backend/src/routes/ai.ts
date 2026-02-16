import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import { getCoursePermissions, getUserCourseRole } from "../middleware/authorization";
import { UserRole } from "../types/enums";
import { generateContent, generateModelSolution, generateUnitTests } from "../services/ai";
import { logger } from "../utils/logger";

const router = Router();

/**
 * POST /api/ai/generate
 * Generate assignment content using AI
 * Requires: Authentication, Instructor/TA role for the assignment
 */
router.post(
  "/ai/generate",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { prompt, assignmentId } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Validate required parameters
      if (!prompt || typeof prompt !== "string") {
        res.status(400).json({
          error: {
            code: "INVALID_PROMPT",
            message: "Prompt is required and must be a string",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      if (!assignmentId || typeof assignmentId !== "string") {
        res.status(400).json({
          error: {
            code: "INVALID_ASSIGNMENT_ID",
            message: "Assignment ID is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate prompt length
      if (prompt.trim().length === 0) {
        res.status(400).json({
          error: {
            code: "EMPTY_PROMPT",
            message: "Prompt cannot be empty",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      if (prompt.length > 2000) {
        res.status(400).json({
          error: {
            code: "PROMPT_TOO_LONG",
            message: "Prompt must be 2000 characters or less",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Fetch the assignment
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("*, courses!inner(*)")
        .eq("id", assignmentId)
        .single();

      if (assignmentError || !assignment) {
        logger.warn("Assignment not found for AI generation", {
          assignmentId,
          userId,
          error: assignmentError?.message,
        });

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

      // Check user permissions (must be instructor or TA for the course)
      if (!isAdmin) {
        const userRole = await getUserCourseRole(userId, assignment.course_id);
        const permissions = await getCoursePermissions(
          userId,
          assignment.course_id,
          isAdmin
        );

        if (
          !permissions.canWrite &&
          userRole !== UserRole.INSTRUCTOR &&
          userRole !== UserRole.TEACHING_ASSISTANT
        ) {
          logger.warn("Unauthorized AI generation attempt", {
            assignmentId,
            userId,
            userRole,
          });

          res.status(403).json({
            error: {
              code: "PERMISSION_DENIED",
              message:
                "You must be an instructor or TA to generate AI content for assignments",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Get course information for context
      const { data: course } = await supabase
        .from("courses")
        .select("name")
        .eq("id", assignment.course_id)
        .single();

      logger.info("Generating AI content", {
        assignmentId,
        userId,
        promptLength: prompt.length,
      });

      // Generate content using AI service
      const generatedContent = await generateContent({
        prompt: prompt.trim(),
        assignmentContext: {
          name: assignment.name,
          courseName: course?.name,
        },
        userId: req.user!.id,
        userEmail: req.user!.email,
        assignmentId,
        courseId: assignment.course_id,
      });

      // Return the generated content
      res.json({
        success: true,
        data: {
          content: generatedContent,
        },
      });
    } catch (error: any) {
      logger.error("Failed to generate AI content", {
        error: error.message,
        stack: error.stack,
        assignmentId: req.body.assignmentId,
        userId: req.user?.id,
      });

      // Provide user-friendly error messages
      let errorCode = "AI_GENERATION_FAILED";
      let errorMessage = "Failed to generate content. Please try again.";

      if (error.message?.includes("Access denied")) {
        errorCode = "BEDROCK_ACCESS_DENIED";
        errorMessage = "AI service access denied. Please contact support.";
      } else if (error.message?.includes("timeout")) {
        errorCode = "AI_TIMEOUT";
        errorMessage = "AI request timed out. Please try again.";
      } else if (error.message?.includes("busy")) {
        errorCode = "AI_THROTTLED";
        errorMessage = "AI service is busy. Please try again in a moment.";
      } else if (error.message) {
        errorMessage = error.message;
      }

      res.status(500).json({
        error: {
          code: errorCode,
          message: errorMessage,
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /api/ai/generate-model-solution
 * Generate a model solution for an IDE block using AI
 * Requires: Authentication, Instructor/TA role for the course
 */
router.post(
  "/ai/generate-model-solution",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { assignmentId, ideBlockId } = req.body;
      const { id: userId, isAdmin, email: userEmail } = req.user!;

      if (!assignmentId || typeof assignmentId !== "string") {
        res.status(400).json({
          error: {
            code: "INVALID_ASSIGNMENT_ID",
            message: "Assignment ID is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      if (!ideBlockId || typeof ideBlockId !== "string") {
        res.status(400).json({
          error: {
            code: "INVALID_IDE_BLOCK_ID",
            message: "IDE block ID is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Fetch the assignment to get course_id
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("course_id")
        .eq("id", assignmentId)
        .single();

      if (assignmentError || !assignment) {
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

      // Check permissions
      if (!isAdmin) {
        const userRole = await getUserCourseRole(userId, assignment.course_id);
        const permissions = await getCoursePermissions(
          userId,
          assignment.course_id,
          isAdmin
        );

        if (
          !permissions.canWrite &&
          userRole !== UserRole.INSTRUCTOR &&
          userRole !== UserRole.TEACHING_ASSISTANT
        ) {
          res.status(403).json({
            error: {
              code: "PERMISSION_DENIED",
              message:
                "You must be an instructor or TA to generate AI content",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      logger.info("Generating AI model solution", {
        assignmentId,
        ideBlockId,
        userId,
      });

      const result = await generateModelSolution({
        assignmentId,
        ideBlockId,
        userId,
        userEmail,
        courseId: assignment.course_id,
      });

      res.json({
        success: true,
        modelSolutionBucketId: result.modelSolutionBucketId,
      });
    } catch (error: any) {
      logger.error("Failed to generate model solution", {
        error: error.message,
        stack: error.stack,
        assignmentId: req.body.assignmentId,
        userId: req.user?.id,
      });

      let errorCode = "AI_GENERATION_FAILED";
      let errorMessage = "Failed to generate model solution. Please try again.";

      if (error.message?.includes("Access denied")) {
        errorCode = "BEDROCK_ACCESS_DENIED";
        errorMessage = "AI service access denied. Please contact support.";
      } else if (error.message?.includes("timeout")) {
        errorCode = "AI_TIMEOUT";
        errorMessage = "AI request timed out. Please try again.";
      } else if (error.message?.includes("not found")) {
        errorCode = "NOT_FOUND";
        errorMessage = error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      res.status(500).json({
        error: {
          code: errorCode,
          message: errorMessage,
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /api/ai/generate-unit-tests
 * Generate unit tests for an IDE block using AI
 * Requires: Authentication, Instructor/TA role for the course
 */
router.post(
  "/ai/generate-unit-tests",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { assignmentId, ideBlockId } = req.body;
      const { id: userId, isAdmin, email: userEmail } = req.user!;

      if (!assignmentId || typeof assignmentId !== "string") {
        res.status(400).json({
          error: {
            code: "INVALID_ASSIGNMENT_ID",
            message: "Assignment ID is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      if (!ideBlockId || typeof ideBlockId !== "string") {
        res.status(400).json({
          error: {
            code: "INVALID_IDE_BLOCK_ID",
            message: "IDE block ID is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Fetch the assignment to get course_id
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("course_id")
        .eq("id", assignmentId)
        .single();

      if (assignmentError || !assignment) {
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

      // Check permissions
      if (!isAdmin) {
        const userRole = await getUserCourseRole(userId, assignment.course_id);
        const permissions = await getCoursePermissions(
          userId,
          assignment.course_id,
          isAdmin
        );

        if (
          !permissions.canWrite &&
          userRole !== UserRole.INSTRUCTOR &&
          userRole !== UserRole.TEACHING_ASSISTANT
        ) {
          res.status(403).json({
            error: {
              code: "PERMISSION_DENIED",
              message:
                "You must be an instructor or TA to generate AI content",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      logger.info("Generating AI unit tests", {
        assignmentId,
        ideBlockId,
        userId,
      });

      const result = await generateUnitTests({
        assignmentId,
        ideBlockId,
        userId,
        userEmail,
        courseId: assignment.course_id,
      });

      res.json({
        success: true,
        tests: result.tests,
      });
    } catch (error: any) {
      logger.error("Failed to generate unit tests", {
        error: error.message,
        stack: error.stack,
        assignmentId: req.body.assignmentId,
        userId: req.user?.id,
      });

      let errorCode = "AI_GENERATION_FAILED";
      let errorMessage = "Failed to generate unit tests. Please try again.";

      if (error.message?.includes("Access denied")) {
        errorCode = "BEDROCK_ACCESS_DENIED";
        errorMessage = "AI service access denied. Please contact support.";
      } else if (error.message?.includes("timeout")) {
        errorCode = "AI_TIMEOUT";
        errorMessage = "AI request timed out. Please try again.";
      } else if (error.message?.includes("not found")) {
        errorCode = "NOT_FOUND";
        errorMessage = error.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      res.status(500).json({
        error: {
          code: errorCode,
          message: errorMessage,
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;

