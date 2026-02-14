import { Router, Request, Response } from "express";
import { Server as SocketIOServer } from "socket.io";
import { supabase, authenticateToken } from "../middleware/auth";
import {
  getCoursePermissions,
  getUserCourseRole,
} from "../middleware/authorization";
import { UserRole } from "../types/enums";
import { logger } from "../utils/logger";
import { AuthenticatedSocket } from "../services/websocket";
import { sessionMiddleware } from "../config/session";
import { handleChatMessage } from "../services/aiChat";

const router = Router();

/**
 * Set up WebSocket namespace for AI Chat
 */
export function setupAIChatWebSocket(io: SocketIOServer): void {
  const namespace = io.of("/ai-chat");

  logger.info("Setting up AI Chat WebSocket namespace at /ai-chat");

  // Auth middleware (same pattern as /ai namespace)
  namespace.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const req = socket.request as any;
      const cookies = req.headers.cookie || "";

      const sessionCookieName = "classla.sid";
      const sessionIdMatch = cookies.match(
        new RegExp(`${sessionCookieName}=([^;]+)`)
      );

      if (!sessionIdMatch) {
        return next(new Error("No session cookie found"));
      }

      const sessionId = sessionIdMatch[1];
      req.sessionID = sessionId;
      req.session = null as any;

      const { sessionManagementService } = await import(
        "../services/session"
      );

      await new Promise<void>((resolve, reject) => {
        const mockRes = {
          cookie: () => {},
          end: () => {},
          writeHead: () => {},
        } as any;

        sessionMiddleware(req as any, mockRes, (err: any) => {
          if (err) {
            reject(err);
            return;
          }
          resolve();
        });
      });

      let sessionData;
      try {
        sessionData = await sessionManagementService.validateSession(req);
      } catch (error) {
        return next(
          new Error(
            `Session validation failed: ${error instanceof Error ? error.message : "Unknown error"}`
          )
        );
      }

      if (!sessionData) {
        return next(new Error("Invalid or expired session"));
      }

      // Look up user
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id, email, is_admin, workos_user_id")
        .eq("workos_user_id", sessionData.workosUserId)
        .single();

      if (userError || !userData) {
        return next(new Error("User not found"));
      }

      socket.userId = userData.id;
      socket.isAuthenticated = true;

      logger.info("AI Chat WebSocket connected", {
        socketId: socket.id,
        userId: userData.id,
      });

      next();
    } catch (error) {
      logger.error("AI Chat WebSocket auth error", {
        error: error instanceof Error ? error.message : "Unknown",
      });
      next(
        new Error(
          `Authentication failed: ${error instanceof Error ? error.message : "Unknown"}`
        )
      );
    }
  });

  namespace.on("connection", (socket: AuthenticatedSocket) => {
    logger.info("AI Chat WebSocket client connected", {
      socketId: socket.id,
      userId: socket.userId,
    });

    socket.on(
      "send-message",
      async (data: {
        sessionId: string;
        assignmentId: string;
        message: string;
        images?: Array<{
          data: string;
          media_type: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
        }>;
      }) => {
        const userId = socket.userId;
        if (!userId) {
          socket.emit("chat-error", {
            message: "Authentication required",
            sessionId: data.sessionId,
          });
          return;
        }

        if (!data.message || !data.sessionId || !data.assignmentId) {
          socket.emit("chat-error", {
            message: "sessionId, assignmentId, and message are required",
            sessionId: data.sessionId,
          });
          return;
        }

        try {
          // Fetch assignment to check permissions
          const { data: assignment, error: assignmentError } = await supabase
            .from("assignments")
            .select("course_id")
            .eq("id", data.assignmentId)
            .single();

          if (assignmentError || !assignment) {
            socket.emit("chat-error", {
              message: "Assignment not found",
              sessionId: data.sessionId,
            });
            return;
          }

          // Check if user is admin
          const { data: userData } = await supabase
            .from("users")
            .select("is_admin")
            .eq("id", userId)
            .single();

          const isAdmin = userData?.is_admin || false;

          // Check permissions (must be instructor or TA)
          if (!isAdmin) {
            const permissions = await getCoursePermissions(
              userId,
              assignment.course_id,
              false
            );
            if (!permissions.canWrite) {
              socket.emit("chat-error", {
                message:
                  "You must be an instructor or TA to use the AI assistant",
                sessionId: data.sessionId,
              });
              return;
            }
          }

          // Verify session belongs to this assignment and user
          const { data: session, error: sessionError } = await supabase
            .from("ai_chat_sessions")
            .select("assignment_id, user_id")
            .eq("id", data.sessionId)
            .single();

          if (sessionError || !session) {
            socket.emit("chat-error", {
              message: "Chat session not found",
              sessionId: data.sessionId,
            });
            return;
          }

          if (session.assignment_id !== data.assignmentId) {
            socket.emit("chat-error", {
              message: "Session does not belong to this assignment",
              sessionId: data.sessionId,
            });
            return;
          }

          await handleChatMessage({
            sessionId: data.sessionId,
            assignmentId: data.assignmentId,
            userId,
            isAdmin,
            userMessage: data.message,
            images: data.images,
            socket,
          });
        } catch (error: any) {
          logger.error("Error handling chat message", {
            error: error.message,
            sessionId: data.sessionId,
          });
          socket.emit("chat-error", {
            message: "Failed to process message",
            sessionId: data.sessionId,
          });
        }
      }
    );

    socket.on("disconnect", (reason) => {
      logger.info("AI Chat WebSocket disconnected", {
        socketId: socket.id,
        userId: socket.userId,
        reason,
      });
    });
  });
}

/**
 * GET /api/ai/chat/sessions?assignmentId=X
 * List chat sessions for an assignment
 */
router.get(
  "/ai/chat/sessions",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { assignmentId } = req.query;
      const { id: userId, isAdmin } = req.user!;

      if (!assignmentId || typeof assignmentId !== "string") {
        res.status(400).json({
          error: { code: "INVALID_PARAMS", message: "assignmentId is required" },
        });
        return;
      }

      // Fetch assignment to check permissions
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("course_id")
        .eq("id", assignmentId)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Assignment not found" },
        });
        return;
      }

      // Check permissions
      if (!isAdmin) {
        const permissions = await getCoursePermissions(
          userId,
          assignment.course_id,
          false
        );
        if (!permissions.canWrite) {
          res.status(403).json({
            error: {
              code: "PERMISSION_DENIED",
              message: "Instructor or TA access required",
            },
          });
          return;
        }
      }

      // Fetch sessions for this user and assignment
      const { data: sessions, error } = await supabase
        .from("ai_chat_sessions")
        .select("id, title, created_at, updated_at")
        .eq("assignment_id", assignmentId)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        res.status(500).json({
          error: { code: "DB_ERROR", message: error.message },
        });
        return;
      }

      res.json({ sessions: sessions || [] });
    } catch (error: any) {
      logger.error("Error listing chat sessions", { error: error.message });
      res.status(500).json({
        error: { code: "SERVER_ERROR", message: "Failed to list sessions" },
      });
    }
  }
);

/**
 * POST /api/ai/chat/sessions
 * Create a new chat session
 */
router.post(
  "/ai/chat/sessions",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { assignmentId, title } = req.body;
      const { id: userId, isAdmin } = req.user!;

      if (!assignmentId || typeof assignmentId !== "string") {
        res.status(400).json({
          error: { code: "INVALID_PARAMS", message: "assignmentId is required" },
        });
        return;
      }

      // Fetch assignment to check permissions
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("course_id")
        .eq("id", assignmentId)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Assignment not found" },
        });
        return;
      }

      // Check permissions
      if (!isAdmin) {
        const permissions = await getCoursePermissions(
          userId,
          assignment.course_id,
          false
        );
        if (!permissions.canWrite) {
          res.status(403).json({
            error: {
              code: "PERMISSION_DENIED",
              message: "Instructor or TA access required",
            },
          });
          return;
        }
      }

      const { data: session, error } = await supabase
        .from("ai_chat_sessions")
        .insert({
          assignment_id: assignmentId,
          user_id: userId,
          title: title || null,
          messages: [],
        })
        .select("id, title, created_at, updated_at")
        .single();

      if (error) {
        res.status(500).json({
          error: { code: "DB_ERROR", message: error.message },
        });
        return;
      }

      res.status(201).json({ session });
    } catch (error: any) {
      logger.error("Error creating chat session", { error: error.message });
      res.status(500).json({
        error: { code: "SERVER_ERROR", message: "Failed to create session" },
      });
    }
  }
);

/**
 * GET /api/ai/chat/sessions/:id
 * Get a specific chat session with messages
 */
router.get(
  "/ai/chat/sessions/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      const { data: session, error } = await supabase
        .from("ai_chat_sessions")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !session) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Session not found" },
        });
        return;
      }

      // Verify ownership (or admin)
      if (session.user_id !== userId && !isAdmin) {
        res.status(403).json({
          error: {
            code: "PERMISSION_DENIED",
            message: "You can only access your own sessions",
          },
        });
        return;
      }

      res.json({ session });
    } catch (error: any) {
      logger.error("Error getting chat session", { error: error.message });
      res.status(500).json({
        error: { code: "SERVER_ERROR", message: "Failed to get session" },
      });
    }
  }
);

/**
 * DELETE /api/ai/chat/sessions/:id
 * Delete a chat session
 */
router.delete(
  "/ai/chat/sessions/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Verify ownership
      const { data: session, error: fetchError } = await supabase
        .from("ai_chat_sessions")
        .select("user_id")
        .eq("id", id)
        .single();

      if (fetchError || !session) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Session not found" },
        });
        return;
      }

      if (session.user_id !== userId && !isAdmin) {
        res.status(403).json({
          error: {
            code: "PERMISSION_DENIED",
            message: "You can only delete your own sessions",
          },
        });
        return;
      }

      const { error } = await supabase
        .from("ai_chat_sessions")
        .delete()
        .eq("id", id);

      if (error) {
        res.status(500).json({
          error: { code: "DB_ERROR", message: error.message },
        });
        return;
      }

      res.json({ message: "Session deleted" });
    } catch (error: any) {
      logger.error("Error deleting chat session", { error: error.message });
      res.status(500).json({
        error: { code: "SERVER_ERROR", message: "Failed to delete session" },
      });
    }
  }
);

export default router;
