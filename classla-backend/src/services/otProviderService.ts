/**
 * OT Provider Service - Socket.IO /ot namespace for Operational Transformation
 *
 * Replaces the Yjs WebSocket provider. Uses server-authoritative OT where the
 * server is the single source of truth.
 */

import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "./websocket";
import { logger } from "../utils/logger";
import { supabase } from "../middleware/auth";
import { OTServer } from "./ot/OTServer";
import { TextOperation } from "./ot/TextOperation";

const otServer = new OTServer();

/**
 * Get document ID from bucket ID and file path
 */
export function getDocumentId(bucketId: string, filePath: string): string {
  return OTServer.getDocumentId(bucketId, filePath);
}

/**
 * Apply content from container (REST sync) and broadcast to connected clients
 */
export async function applyContainerContent(
  bucketId: string,
  filePath: string,
  content: string,
  io: SocketIOServer
): Promise<void> {
  const documentId = getDocumentId(bucketId, filePath);

  // Only apply if document is loaded in memory (active editing session)
  if (!otServer.hasDocument(documentId)) {
    return;
  }

  try {
    const result = await otServer.applyFullContent(documentId, content, "container");
    if (result) {
      // Broadcast to all clients subscribed to this document
      const otNamespace = io.of("/ot");
      otNamespace.to(documentId).emit("remote-operation", {
        documentId,
        operation: result.operation.toJSON(),
        authorId: "container",
        revision: result.revision,
      });
      logger.info(`[OT] Container content applied and broadcasted for ${documentId} (rev=${result.revision})`);
    }
  } catch (error: any) {
    logger.error(`[OT] Failed to apply container content for ${documentId}:`, error);
  }
}

/**
 * Force save a document
 */
export async function forceSaveDocument(bucketId: string, filePath: string): Promise<void> {
  const documentId = getDocumentId(bucketId, filePath);
  await otServer.forceSaveDocument(documentId);
}

/**
 * Save all documents
 */
export async function saveAllDocuments(): Promise<void> {
  await otServer.saveAllDocuments();
}

/**
 * Clean up a document
 */
export function cleanupDocument(docId: string, skipSave: boolean = false): void {
  otServer.cleanupDocument(docId, skipSave);
}

/**
 * Setup OT WebSocket namespace
 */
export function setupOTWebSocket(io: SocketIOServer): void {
  const otNamespace = io.of("/ot");

  logger.info("[OT] Setting up OT WebSocket namespace at /ot");

  // Authentication middleware - copied from yjsProviderService.ts
  otNamespace.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const req = socket.request as any;

      // Check for container service token first
      const serviceToken =
        (req.headers["x-container-service-token"] as string) ||
        (socket.handshake.auth?.token as string) ||
        (socket.handshake.query?.token as string);
      const expectedServiceToken = process.env.CONTAINER_SERVICE_TOKEN;

      if (serviceToken && expectedServiceToken && serviceToken === expectedServiceToken) {
        socket.userId = "container";
        socket.isAuthenticated = true;
        logger.info("[OT] Connection authenticated (container)", { socketId: socket.id });
        return next();
      }

      // Allow test bucket connections in development
      const testBucketId = "00000000-0000-0000-0000-000000000001";
      const testUserId = "00000000-0000-0000-0000-000000000000";
      const isTestConnection =
        process.env.NODE_ENV === "development" &&
        (socket.handshake.query?.bucketId === testBucketId ||
          socket.handshake.auth?.bucketId === testBucketId ||
          req.headers["x-test-bucket-id"] === testBucketId);

      if (isTestConnection) {
        socket.userId = testUserId;
        socket.isAuthenticated = true;
        logger.info("[OT] Connection authenticated (test bucket)", { socketId: socket.id });
        return next();
      }

      // Session-based authentication (for frontend)
      const cookies = req.headers.cookie || "";
      const sessionCookieName = "classla.sid";
      const sessionIdMatch = cookies.match(new RegExp(`${sessionCookieName}=([^;]+)`));

      if (!sessionIdMatch) {
        logger.warn("[OT] Connection rejected: No session cookie or service token", {
          socketId: socket.id,
        });
        return next(new Error("No session cookie or service token found"));
      }

      const sessionId = sessionIdMatch[1];
      req.sessionID = sessionId;
      req.session = null as any;

      const { sessionMiddleware } = await import("../config/session");
      const { sessionManagementService } = await import("./session");

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
        logger.warn("[OT] Connection rejected: Session validation error", {
          socketId: socket.id,
          error: error instanceof Error ? error.message : "Unknown",
        });
        return next(new Error("Session validation failed"));
      }

      if (!sessionData) {
        logger.warn("[OT] Connection rejected: Invalid session", { socketId: socket.id });
        return next(new Error("Invalid or expired session"));
      }

      // Get user info - handle both WorkOS users and managed students
      let userData;
      let userError;

      if (sessionData.isManagedStudent) {
        const result = await supabase
          .from("users")
          .select("id, email, is_admin, is_managed")
          .eq("id", sessionData.userId)
          .eq("is_managed", true)
          .single();
        userData = result.data;
        userError = result.error;
      } else {
        const result = await supabase
          .from("users")
          .select("id, email, is_admin, workos_user_id")
          .eq("workos_user_id", sessionData.workosUserId)
          .single();
        userData = result.data;
        userError = result.error;
      }

      if (userError || !userData) {
        logger.warn("[OT] Connection rejected: User not found", { socketId: socket.id });
        return next(new Error("User not found"));
      }

      socket.userId = userData.id;
      socket.isAuthenticated = true;
      logger.info("[OT] Connection authenticated", {
        socketId: socket.id,
        userId: userData.id,
      });
      next();
    } catch (error) {
      logger.error("[OT] Authentication error", {
        socketId: socket.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(new Error("Authentication failed"));
    }
  });

  // Handle connection
  otNamespace.on("connection", async (socket: AuthenticatedSocket) => {
    logger.info("[OT] Client connected", {
      socketId: socket.id,
      userId: socket.userId,
    });

    /**
     * Subscribe to a document
     */
    socket.on(
      "subscribe-document",
      async (data: { bucketId: string; filePath: string }) => {
        const { bucketId, filePath } = data;

        if (!bucketId || !filePath) {
          socket.emit("error", { message: "bucketId and filePath are required" });
          return;
        }

        try {
          // Verify bucket access
          const { data: bucket, error: bucketError } = await supabase
            .from("s3_buckets")
            .select("*")
            .eq("id", bucketId)
            .is("deleted_at", null)
            .single();

          if (bucketError || !bucket) {
            socket.emit("error", { message: "Bucket not found" });
            return;
          }

          // Check access (container has universal access)
          const isContainer = socket.userId === "container";
          if (!isContainer && bucket.user_id !== socket.userId) {
            if (bucket.course_id) {
              const { data: enrollment } = await supabase
                .from("course_enrollments")
                .select("id")
                .eq("course_id", bucket.course_id)
                .eq("user_id", socket.userId)
                .single();

              if (!enrollment) {
                socket.emit("error", { message: "Access denied" });
                return;
              }
            } else {
              socket.emit("error", { message: "Access denied" });
              return;
            }
          }

          const bucketInfo = {
            bucket_name: bucket.bucket_name,
            region: bucket.region || "us-east-1",
          };

          // Load or create document
          const doc = await otServer.createDocument(bucketId, filePath, bucketInfo);
          const documentId = doc.id;

          // Join rooms
          socket.join(documentId);
          socket.join(`bucket:${bucketId}`);

          // Cancel any pending cleanup
          otServer.cancelCleanup(documentId);

          // Send initial document state
          socket.emit("document-state", {
            documentId,
            content: doc.content,
            revision: doc.revision,
          });

          logger.info(`[OT] Client subscribed to ${documentId}`, {
            socketId: socket.id,
            userId: socket.userId,
            revision: doc.revision,
            contentLength: doc.content.length,
          });
        } catch (error: any) {
          logger.error("[OT] Failed to subscribe:", error);
          socket.emit("error", { message: error.message || "Failed to subscribe" });
        }
      }
    );

    /**
     * Receive an operation from a client
     */
    socket.on(
      "submit-operation",
      async (data: {
        documentId: string;
        revision: number;
        operation: (number | string)[];
      }) => {
        const { documentId, revision, operation } = data;

        try {
          const op = TextOperation.fromJSON(operation);
          const result = await otServer.receiveOperation(
            documentId,
            revision,
            op,
            socket.userId || "unknown"
          );

          // Acknowledge to sender
          socket.emit("ack", {
            documentId,
            revision: result.revision,
          });

          // Broadcast to all other clients in the room
          socket.to(documentId).emit("remote-operation", {
            documentId,
            operation: result.operation.toJSON(),
            authorId: socket.userId || "unknown",
            revision: result.revision,
          });
        } catch (error: any) {
          logger.error(`[OT] Failed to process operation for ${documentId}:`, {
            error: error.message,
            clientRevision: revision,
            socketId: socket.id,
          });
          socket.emit("error", {
            message: `Operation failed: ${error.message}`,
            documentId,
          });
        }
      }
    );

    /**
     * Unsubscribe from a document
     */
    socket.on(
      "unsubscribe-document",
      (data: { bucketId: string; filePath: string }) => {
        const { bucketId, filePath } = data;
        const documentId = getDocumentId(bucketId, filePath);
        socket.leave(documentId);
      }
    );

    /**
     * File tree changes (create/delete)
     */
    socket.on(
      "file-tree-change",
      (data: { bucketId: string; filePath: string; action: "create" | "delete" }) => {
        const { bucketId, filePath, action } = data;
        const bucketRoom = `bucket:${bucketId}`;
        socket.to(bucketRoom).emit("file-tree-change", { bucketId, filePath, action });

        if (action === "delete") {
          const documentId = getDocumentId(bucketId, filePath);
          otServer.cleanupDocument(documentId, true);
          // Also delete from DB
          otServer.deleteDocumentPermanently(documentId).catch((e) => {
            logger.error(`[OT] Failed to permanently delete ${documentId}:`, e);
          });
          logger.info(`[OT] Cleaned up document for deleted file: ${documentId}`);
        }
      }
    );

    /**
     * Cursor updates (passthrough)
     */
    socket.on(
      "cursor-update",
      (data: {
        documentId: string;
        cursor: { lineNumber: number; column: number } | null;
        selection: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null;
        user: { name: string; color: string };
      }) => {
        const { documentId } = data;
        socket.to(documentId).emit("remote-cursor", {
          ...data,
          clientId: socket.id,
        });
      }
    );

    /**
     * Handle disconnect
     */
    socket.on("disconnect", (reason) => {
      logger.info("[OT] Client disconnected", {
        socketId: socket.id,
        userId: socket.userId,
        reason,
      });

      // Schedule cleanup for documents with no clients
      for (const documentId of otServer.getDocumentIds()) {
        const room = otNamespace.adapter.rooms.get(documentId);
        if (!room || room.size === 0) {
          otServer.scheduleCleanup(documentId);
        }
      }
    });

    socket.on("error", (error) => {
      logger.error("[OT] Socket error", {
        socketId: socket.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
  });

  // Periodic cleanup of orphaned documents (every 5 minutes)
  setInterval(() => {
    const docCount = otServer.getDocumentIds().length;
    logger.info(`[OT] Status: ${docCount} documents in memory`);

    for (const documentId of otServer.getDocumentIds()) {
      const room = otNamespace.adapter.rooms.get(documentId);
      if (!room || room.size === 0) {
        otServer.scheduleCleanup(documentId);
      }
    }
  }, 300000);
}
