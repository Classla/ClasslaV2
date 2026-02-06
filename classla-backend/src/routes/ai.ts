import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import { getCoursePermissions, getUserCourseRole } from "../middleware/authorization";
import { UserRole } from "../types/enums";
import { generateContent, generateContentStream, generateModelSolution } from "../services/ai";
import { logger } from "../utils/logger";
import { AuthenticatedSocket } from "../services/websocket";
import { sessionMiddleware } from "../config/session";

const router = Router();

/**
 * Set up WebSocket namespace for AI generation
 */
export function setupAIWebSocket(io: SocketIOServer): void {
  const aiNamespace = io.of("/ai");
  
  logger.info("Setting up AI WebSocket namespace at /ai");

  // Apply authentication middleware to the /ai namespace
  // This MUST be set up before the connection handler
  aiNamespace.use(async (socket: AuthenticatedSocket, next) => {
    try {
      logger.info("AI WebSocket authentication attempt", {
        socketId: socket.id,
        hasCookies: !!socket.request.headers.cookie,
      });
      
      // Get request from socket
      const req = socket.request as any;
      
      // Parse cookies manually
      const cookies = req.headers.cookie || "";
      
      // Parse session ID from cookie
      const sessionCookieName = "classla.sid";
      const sessionIdMatch = cookies.match(new RegExp(`${sessionCookieName}=([^;]+)`));
      
      if (!sessionIdMatch) {
        logger.warn("AI WebSocket connection rejected: No session cookie", {
          socketId: socket.id,
          cookieHeader: cookies ? cookies.substring(0, 200) : "no cookies",
          allHeaders: Object.keys(socket.request.headers),
        });
        return next(new Error("No session cookie found"));
      }

      const sessionId = sessionIdMatch[1];
      logger.info("Found session ID", { socketId: socket.id, sessionId: sessionId.substring(0, 10) + "..." });
      
      // Set up request object for session validation
      req.sessionID = sessionId;
      req.session = null as any;
      
      // Import session management service
      const { sessionManagementService } = await import("../services/session");
      
      // Use the session middleware to load the session
      // This is the proper way to access sessions, even with memory store
      await new Promise<void>((resolve, reject) => {
        // Create a mock response object
        const mockRes = {
          cookie: () => {},
          end: () => {},
          writeHead: () => {},
        } as any;
        
        // Run the session middleware to load the session
        sessionMiddleware(req as any, mockRes, (err: any) => {
          if (err) {
            logger.warn("Session middleware error", {
              socketId: socket.id,
              error: err.message,
            });
            reject(err);
            return;
          }
          
          // Session should now be loaded in req.session
          if (req.session) {
            logger.info("Session loaded via middleware", { 
              socketId: socket.id,
              hasUser: !!(req.session as any).user
            });
          } else {
            logger.warn("Session middleware ran but no session found", { socketId: socket.id });
          }
          resolve();
        });
      });
      
      // Validate session using session management service
      let sessionData;
      try {
        sessionData = await sessionManagementService.validateSession(req);
      } catch (error) {
        logger.warn("AI WebSocket connection rejected: Session validation error", {
          socketId: socket.id,
          error: error instanceof Error ? error.message : "Unknown",
        });
        return next(new Error(`Session validation failed: ${error instanceof Error ? error.message : "Unknown error"}`));
      }
      
      if (!sessionData) {
        logger.warn("AI WebSocket connection rejected: Invalid session", {
          socketId: socket.id,
          sessionId: sessionId.substring(0, 10) + "...",
          hasSession: !!req.session,
        });
        return next(new Error("Invalid or expired session"));
      }

      // Extract user information from database
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id, email, is_admin, workos_user_id")
        .eq("workos_user_id", sessionData.workosUserId)
        .single();

      if (userError || !userData) {
        logger.warn("AI WebSocket connection rejected: User not found", {
          socketId: socket.id,
          workosUserId: sessionData.workosUserId,
          error: userError?.message,
        });
        return next(new Error("User not found"));
      }

      // Attach user info to socket
      socket.userId = userData.id;
      socket.isAuthenticated = true;

      logger.info("AI WebSocket connection authenticated", {
        socketId: socket.id,
        userId: userData.id,
      });

      next();
    } catch (error) {
      logger.error("AI WebSocket authentication error", {
        socketId: socket.id,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
      });
      next(new Error(`Authentication failed: ${error instanceof Error ? error.message : "Unknown error"}`));
    }
  });

  // This handler runs AFTER authentication middleware succeeds
  aiNamespace.on("connection", (socket: AuthenticatedSocket) => {
    logger.info("AI WebSocket client successfully connected", {
      socketId: socket.id,
      userId: socket.userId,
    });

    socket.on("generate", async (data: { prompt: string; assignmentId: string; requestId?: string; taggedAssignmentIds?: string[]; images?: Array<{ base64: string; mimeType: string }> }) => {
      const { prompt, assignmentId, requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`, taggedAssignmentIds = [], images = [] } = data;
      const userId = socket.userId;

      if (!userId) {
        socket.emit("stream-error", {
          message: "Authentication required",
          code: "AUTH_REQUIRED",
          requestId,
        });
        return;
      }

      // Validate required parameters
      if (!prompt || typeof prompt !== "string") {
        socket.emit("stream-error", {
          message: "Prompt is required and must be a string",
          code: "INVALID_PROMPT",
          requestId,
        });
        return;
      }

      if (!assignmentId || typeof assignmentId !== "string") {
        socket.emit("stream-error", {
          message: "Assignment ID is required",
          code: "INVALID_ASSIGNMENT_ID",
          requestId,
        });
        return;
      }

      // Validate prompt length
      if (prompt.trim().length === 0) {
        socket.emit("stream-error", {
          message: "Prompt cannot be empty",
          code: "EMPTY_PROMPT",
          requestId,
        });
        return;
      }

      if (prompt.length > 2000) {
        socket.emit("stream-error", {
          message: "Prompt must be 2000 characters or less",
          code: "PROMPT_TOO_LONG",
          requestId,
        });
        return;
      }

      try {
        // Fetch user data for logging
        const { data: userData, error: userError } = await supabase
          .from("users")
          .select("id, email")
          .eq("id", userId)
          .single();

        if (userError || !userData) {
          logger.warn("User not found for AI generation", {
            userId,
            error: userError?.message,
          });
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

          socket.emit("stream-error", {
            message: "Assignment not found",
            code: "ASSIGNMENT_NOT_FOUND",
            requestId,
          });
          return;
        }

        // Check user permissions (must be instructor or TA for the course)
        const userRole = await getUserCourseRole(userId, assignment.course_id);
        const permissions = await getCoursePermissions(
          userId,
          assignment.course_id,
          false // isAdmin - WebSocket auth already validated user
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

          socket.emit("stream-error", {
            message: "You must be an instructor or TA to generate AI content for assignments",
            code: "PERMISSION_DENIED",
            requestId,
          });
          return;
        }

        // Get course information for context
        const { data: course } = await supabase
          .from("courses")
          .select("name")
          .eq("id", assignment.course_id)
          .single();

        // Fetch tagged assignments if provided
        let taggedAssignments: Array<{ id: string; name: string; content: string }> = [];
        if (taggedAssignmentIds && taggedAssignmentIds.length > 0) {
          // Verify all tagged assignments belong to the same course
          const { data: taggedAssignmentsData, error: taggedError } = await supabase
            .from("assignments")
            .select("id, name, content")
            .in("id", taggedAssignmentIds)
            .eq("course_id", assignment.course_id); // Ensure same course

          if (!taggedError && taggedAssignmentsData) {
            taggedAssignments = taggedAssignmentsData.map(a => ({
              id: a.id,
              name: a.name,
              content: a.content || "",
            }));
          } else {
            logger.warn("Failed to fetch tagged assignments", {
              taggedAssignmentIds,
              error: taggedError?.message,
            });
          }
        }

        // Validate and filter images
        const validImages = (images || [])
          .filter(img => img.base64 && img.mimeType && img.mimeType.startsWith('image/'))
          .slice(0, 5); // Limit to 5 images

        logger.info("Starting AI content generation stream", {
          assignmentId,
          userId,
          promptLength: prompt.length,
          requestId,
          socketId: socket.id,
          taggedAssignmentsCount: taggedAssignments.length,
          taggedAssignments: taggedAssignments.map(a => ({ id: a.id, name: a.name })),
          imagesCount: validImages.length,
        });

        // Start streaming generation
        await generateContentStream({
          prompt: prompt.trim(),
          assignmentContext: {
            name: assignment.name,
            courseName: course?.name,
          },
          taggedAssignments: taggedAssignments.length > 0 ? taggedAssignments : undefined,
          images: validImages.length > 0 ? validImages : undefined,
          socket,
          requestId,
          assignmentId,
          userId: userData?.id || userId,
          userEmail: userData?.email,
          courseId: assignment.course_id,
        });
      } catch (error: any) {
        logger.error("Failed to start AI generation stream", {
          error: error.message,
          stack: error.stack,
          assignmentId,
          userId,
          requestId,
        });

        socket.emit("stream-error", {
          message: error.message || "Failed to start generation",
          code: "GENERATION_FAILED",
          requestId,
          assignmentId,
        });
      }
    });

    socket.on("disconnect", (reason) => {
      logger.info("AI WebSocket client disconnected", {
        socketId: socket.id,
        userId: socket.userId,
        reason,
      });
    });
  });
}

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

export default router;

