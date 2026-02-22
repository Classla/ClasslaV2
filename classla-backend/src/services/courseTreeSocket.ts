import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "./websocket";
import { sessionMiddleware } from "../config/session";
import { sessionManagementService } from "./session";
import { supabase } from "../middleware/auth";
import { logger } from "../utils/logger";

/**
 * Set up WebSocket namespace for course tree real-time updates.
 * Uses sessionData.userId directly (not workos_user_id) so managed students can connect.
 */
export function setupCourseTreeSocket(io: SocketIOServer): void {
  const namespace = io.of("/course-tree");

  logger.info("Setting up Course Tree WebSocket namespace at /course-tree");

  // Auth middleware — supports both regular and managed student sessions
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

      // Load session via express-session middleware
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

      const sessionData = await sessionManagementService.validateSession(req);

      if (!sessionData) {
        return next(new Error("Invalid or expired session"));
      }

      // Use sessionData.userId directly — works for both regular and managed students
      socket.userId = sessionData.userId;
      socket.isAuthenticated = true;

      next();
    } catch (error) {
      logger.error("Course Tree WebSocket auth error", {
        socketId: socket.id,
        error: error instanceof Error ? error.message : "Unknown",
      });
      next(new Error("Authentication failed"));
    }
  });

  // Handle connections
  namespace.on("connection", (socket: AuthenticatedSocket) => {
    socket.on("join-course", (courseId: string) => {
      if (courseId) {
        socket.join(`course:${courseId}`);
      }
    });

    socket.on("leave-course", (courseId: string) => {
      if (courseId) {
        socket.leave(`course:${courseId}`);
      }
    });

    // Instructor joins a room to watch a specific student's live answers
    socket.on("join-submission-grading", (submissionId: string) => {
      if (submissionId) {
        socket.join(`grading:${submissionId}`);
      }
    });

    socket.on("leave-submission-grading", (submissionId: string) => {
      if (submissionId) {
        socket.leave(`grading:${submissionId}`);
      }
    });

    // Student emits their full answer state; backend relays to watching instructors
    socket.on(
      "submission-answers",
      ({ submissionId, answers }: { submissionId: string; answers: any }) => {
        if (submissionId && answers) {
          socket
            .to(`grading:${submissionId}`)
            .emit("submission-answers", { submissionId, answers });
        }
      }
    );

    socket.on("disconnect", () => {
      // Rooms are automatically cleaned up on disconnect
    });
  });
}

/**
 * Emit a submission update event to all clients watching a course.
 */
export function emitSubmissionUpdate(
  io: SocketIOServer,
  courseId: string,
  data: { assignmentId: string; studentId: string; status: string }
): void {
  try {
    io.of("/course-tree")
      .to(`course:${courseId}`)
      .emit("submission-update", data);
  } catch (error) {
    logger.error("Failed to emit submission update", {
      courseId,
      data,
      error: error instanceof Error ? error.message : "Unknown",
    });
  }
}

/**
 * Emit a tree update event to all clients watching a course.
 */
export function emitTreeUpdate(
  io: SocketIOServer,
  courseId: string,
  event: string,
  data?: Record<string, any>
): void {
  try {
    io.of("/course-tree")
      .to(`course:${courseId}`)
      .emit("tree-update", { event, data });
  } catch (error) {
    logger.error("Failed to emit tree update", {
      courseId,
      event,
      error: error instanceof Error ? error.message : "Unknown",
    });
  }
}
