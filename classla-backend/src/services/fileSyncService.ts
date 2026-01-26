import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "./websocket";
import { logger } from "../utils/logger";

interface FileChangeEvent {
  bucketId: string;
  filePath: string;
  content: string;
  etag?: string;
  source: "frontend" | "container";
  userId?: string;
  timestamp: number;
}

interface FileOperation {
  type: "insert" | "delete" | "replace";
  position: number;
  length: number;
  text: string;
  version: number;
}

// Track connected clients per bucket/file
const bucketSubscriptions = new Map<string, Set<string>>(); // bucketId -> Set of socketIds
const fileSubscriptions = new Map<string, Set<string>>(); // bucketId:filePath -> Set of socketIds
const socketBuckets = new Map<string, Set<string>>(); // socketId -> Set of bucketIds

// Track operation history per file for OT
const fileOperations = new Map<string, FileOperation[]>(); // bucketId:filePath -> operations

/**
 * Setup file sync WebSocket namespace
 */
export function setupFileSyncWebSocket(io: SocketIOServer): void {
  const fileSyncNamespace = io.of("/file-sync");

  logger.info("Setting up File Sync WebSocket namespace at /file-sync");

  // Apply authentication middleware (reuse from main namespace)
  fileSyncNamespace.use(async (socket: AuthenticatedSocket, next) => {
    try {
      // Get request from socket
      const req = socket.request as any;

      // Parse cookies manually
      const cookies = req.headers.cookie || "";
      const sessionCookieName = "classla.sid";
      const sessionIdMatch = cookies.match(new RegExp(`${sessionCookieName}=([^;]+)`));

      if (!sessionIdMatch) {
        logger.warn("File Sync WebSocket connection rejected: No session cookie", {
          socketId: socket.id,
        });
        return next(new Error("No session cookie found"));
      }

      const sessionId = sessionIdMatch[1];
      req.sessionID = sessionId;
      req.session = null as any;

      // Import session middleware and session management service
      const { sessionMiddleware } = await import("../config/session");
      const { sessionManagementService } = await import("./session");

      // Use the session middleware to load the session (same approach as AI WebSocket)
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
            logger.warn("Session middleware error in File Sync WebSocket", {
              socketId: socket.id,
              error: err.message,
            });
            reject(err);
            return;
          }

          // Session should now be loaded in req.session
          if (req.session) {
            logger.info("Session loaded via middleware in File Sync WebSocket", {
              socketId: socket.id,
              hasUser: !!(req.session as any).user,
            });
          } else {
            logger.warn("Session middleware ran but no session found in File Sync WebSocket", {
              socketId: socket.id,
            });
          }
          resolve();
        });
      });

      // Validate session using session management service
      let sessionData;
      try {
        sessionData = await sessionManagementService.validateSession(req);
      } catch (error) {
        logger.warn("File Sync WebSocket connection rejected: Session validation error", {
          socketId: socket.id,
          error: error instanceof Error ? error.message : "Unknown",
        });
        return next(
          new Error(`Session validation failed: ${error instanceof Error ? error.message : "Unknown error"}`)
        );
      }

      if (!sessionData) {
        logger.warn("File Sync WebSocket connection rejected: Invalid session", {
          socketId: socket.id,
          sessionId: sessionId.substring(0, 10) + "...",
          hasSession: !!req.session,
        });
        return next(new Error("Invalid or expired session"));
      }

      // Get user info
      const { supabase } = await import("../middleware/auth");
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id, email, is_admin, workos_user_id")
        .eq("workos_user_id", sessionData.workosUserId)
        .single();

      if (userError || !userData) {
        logger.warn("File Sync WebSocket connection rejected: User not found", {
          socketId: socket.id,
        });
        return next(new Error("User not found"));
      }

      socket.userId = userData.id;
      socket.isAuthenticated = true;

      logger.info("File Sync WebSocket connection authenticated", {
        socketId: socket.id,
        userId: userData.id,
      });

      next();
    } catch (error) {
      logger.error("File Sync WebSocket authentication error", {
        socketId: socket.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(new Error("Authentication failed"));
    }
  });

  // Handle connection
  fileSyncNamespace.on("connection", (socket: AuthenticatedSocket) => {
    logger.info("File Sync WebSocket client connected", {
      socketId: socket.id,
      userId: socket.userId,
    });

    // Subscribe to a bucket
    socket.on("subscribe-bucket", (data: { bucketId: string }) => {
      const { bucketId } = data;
      if (!bucketId) {
        socket.emit("error", { message: "bucketId is required" });
        return;
      }

      // Add socket to bucket subscriptions
      if (!bucketSubscriptions.has(bucketId)) {
        bucketSubscriptions.set(bucketId, new Set());
      }
      bucketSubscriptions.get(bucketId)!.add(socket.id);

      // Track which buckets this socket is subscribed to
      if (!socketBuckets.has(socket.id)) {
        socketBuckets.set(socket.id, new Set());
      }
      socketBuckets.get(socket.id)!.add(bucketId);

      logger.info("Socket subscribed to bucket", {
        socketId: socket.id,
        bucketId,
      });

      socket.emit("subscribed", { bucketId });
    });

    // Subscribe to a specific file
    socket.on("subscribe-file", (data: { bucketId: string; filePath: string }) => {
      const { bucketId, filePath } = data;
      if (!bucketId || !filePath) {
        socket.emit("error", { message: "bucketId and filePath are required" });
        return;
      }

      const key = `${bucketId}:${filePath}`;
      if (!fileSubscriptions.has(key)) {
        fileSubscriptions.set(key, new Set());
      }
      fileSubscriptions.get(key)!.add(socket.id);

      logger.info("Socket subscribed to file", {
        socketId: socket.id,
        bucketId,
        filePath,
      });

      socket.emit("subscribed", { bucketId, filePath });
    });

    // Unsubscribe from bucket
    socket.on("unsubscribe-bucket", (data: { bucketId: string }) => {
      const { bucketId } = data;
      if (bucketId && bucketSubscriptions.has(bucketId)) {
        bucketSubscriptions.get(bucketId)!.delete(socket.id);
        if (bucketSubscriptions.get(bucketId)!.size === 0) {
          bucketSubscriptions.delete(bucketId);
        }
      }
      if (socketBuckets.has(socket.id)) {
        socketBuckets.get(socket.id)!.delete(bucketId);
      }
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      logger.info("File Sync WebSocket client disconnected", {
        socketId: socket.id,
        userId: socket.userId,
        reason,
      });

      // Clean up subscriptions
      if (socketBuckets.has(socket.id)) {
        const buckets = socketBuckets.get(socket.id)!;
        buckets.forEach((bucketId) => {
          if (bucketSubscriptions.has(bucketId)) {
            bucketSubscriptions.get(bucketId)!.delete(socket.id);
            if (bucketSubscriptions.get(bucketId)!.size === 0) {
              bucketSubscriptions.delete(bucketId);
            }
          }
        });
        socketBuckets.delete(socket.id);
      }

      // Clean up file subscriptions
      fileSubscriptions.forEach((sockets, key) => {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          fileSubscriptions.delete(key);
        }
      });
    });

    socket.on("error", (error) => {
      logger.error("File Sync WebSocket error", {
        socketId: socket.id,
        userId: socket.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
  });
}

/**
 * Broadcast file change to all subscribed clients
 */
export function broadcastFileChange(event: FileChangeEvent): void {
  const io = require("./websocket").getIO();
  const fileSyncNamespace = io.of("/file-sync");

  const { bucketId, filePath } = event;
  const fileKey = `${bucketId}:${filePath}`;

  // Get all sockets subscribed to this bucket
  const bucketSockets = bucketSubscriptions.get(bucketId) || new Set();
  // Get all sockets subscribed to this specific file
  const fileSockets = fileSubscriptions.get(fileKey) || new Set();
  // Combine both sets
  const allSockets = new Set([...bucketSockets, ...fileSockets]);

  if (allSockets.size === 0) {
    logger.debug("No subscribers for file change", { bucketId, filePath });
    return;
  }

  logger.info("Broadcasting file change", {
    bucketId,
    filePath,
    subscriberCount: allSockets.size,
    source: event.source,
  });

  // Broadcast to all subscribed sockets
  allSockets.forEach((socketId) => {
    const socket = fileSyncNamespace.sockets.get(socketId);
    if (socket) {
      socket.emit("file-change", {
        bucketId: event.bucketId,
        filePath: event.filePath,
        content: event.content,
        etag: event.etag,
        source: event.source,
        userId: event.userId,
        timestamp: event.timestamp,
      });
    }
  });
}

/**
 * Track file operation for operational transform
 */
export function trackFileOperation(
  bucketId: string,
  filePath: string,
  operation: FileOperation
): void {
  const key = `${bucketId}:${filePath}`;
  if (!fileOperations.has(key)) {
    fileOperations.set(key, []);
  }
  const operations = fileOperations.get(key)!;
  operations.push(operation);
  // Keep only last 100 operations per file
  if (operations.length > 100) {
    operations.shift();
  }
}

/**
 * Get file operations for OT
 */
export function getFileOperations(
  bucketId: string,
  filePath: string,
  sinceVersion: number = 0
): FileOperation[] {
  const key = `${bucketId}:${filePath}`;
  const operations = fileOperations.get(key) || [];
  return operations.filter((op) => op.version > sinceVersion);
}

