/**
 * OT Provider Service - Socket.IO /ot namespace for Operational Transformation
 *
 * Uses server-authoritative OT where the server is the single source of truth.
 */

import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "./websocket";
import { logger } from "../utils/logger";
import { supabase } from "../middleware/auth";
import { OTServer } from "./ot/OTServer";
import { TextOperation } from "./ot/TextOperation";
import { S3Client, DeleteObjectCommand } from "@aws-sdk/client-s3";

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
 * Get in-memory document content (returns null if not loaded in OT)
 */
export function getDocumentContent(bucketId: string, filePath: string): string | null {
  return otServer.getDocumentContent(bucketId, filePath);
}

/**
 * Get all in-memory document contents for a bucket (used by container flush)
 */
export function getDocumentContentsForBucket(bucketId: string): { path: string; content: string }[] {
  return otServer.getDocumentContentsForBucket(bucketId);
}

/**
 * Force save all OT documents for a specific bucket to S3
 */
export async function forceSaveDocumentsForBucket(bucketId: string): Promise<string[]> {
  return otServer.forceSaveDocumentsForBucket(bucketId);
}

/**
 * Clean up a document
 */
export function cleanupDocument(docId: string, skipSave: boolean = false): void {
  otServer.cleanupDocument(docId, skipSave);
}

/**
 * Set bucket sync mode
 */
export function setBucketMode(bucketId: string, mode: 'A' | 'B'): void {
  otServer.setBucketMode(bucketId, mode);
}

/**
 * Get bucket sync mode
 */
export function getBucketMode(bucketId: string): 'A' | 'B' {
  return otServer.getBucketMode(bucketId);
}

/**
 * Delete a file from S3 (used when container reports a file deletion)
 */
async function deleteFileFromS3(bucketId: string, filePath: string): Promise<void> {
  const { data: bucket, error } = await supabase
    .from("s3_buckets")
    .select("bucket_name, region")
    .eq("id", bucketId)
    .is("deleted_at", null)
    .single();

  if (error || !bucket) {
    logger.warn(`[OT] Cannot delete from S3: bucket ${bucketId} not found`);
    return;
  }

  const s3Client = new S3Client({
    region: bucket.region || "us-east-1",
    credentials:
      process.env.IDE_MANAGER_ACCESS_KEY_ID && process.env.IDE_MANAGER_SECRET_ACCESS_KEY
        ? {
            accessKeyId: process.env.IDE_MANAGER_ACCESS_KEY_ID,
            secretAccessKey: process.env.IDE_MANAGER_SECRET_ACCESS_KEY,
          }
        : undefined,
  });

  await s3Client.send(new DeleteObjectCommand({
    Bucket: bucket.bucket_name,
    Key: filePath,
  }));

  logger.info(`[OT] Deleted ${filePath} from S3 bucket ${bucket.bucket_name}`);
}

/**
 * Setup OT WebSocket namespace
 */
// Track container sockets: bucketId → socketId
const containerSockets: Map<string, string> = new Map();

export function setupOTWebSocket(io: SocketIOServer): void {
  const otNamespace = io.of("/ot");

  logger.info("[OT] Setting up OT WebSocket namespace at /ot");

  // Authentication middleware
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
     * Container registration — container connects and registers its bucketId.
     * This activates Mode B (container filesystem = authority).
     */
    socket.on(
      "container-register",
      (data: { bucketId: string }) => {
        const { bucketId } = data;
        if (socket.userId !== "container") {
          socket.emit("container-registered", { success: false, error: "Not a container" });
          return;
        }
        if (!bucketId) {
          socket.emit("container-registered", { success: false, error: "bucketId required" });
          return;
        }

        containerSockets.set(bucketId, socket.id);
        socket.join(`container:${bucketId}`);
        socket.join(`bucket:${bucketId}`);
        setBucketMode(bucketId, 'B');

        logger.info(`[OT] Container registered for bucket ${bucketId}`, { socketId: socket.id });
        socket.emit("container-registered", { success: true, bucketId });
      }
    );

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

          const operationPayload = {
            documentId,
            operation: result.operation.toJSON(),
            authorId: socket.userId || "unknown",
            revision: result.revision,
          };

          // Broadcast to all other clients in the document room
          socket.to(documentId).emit("remote-operation", operationPayload);

          // Also forward to registered container (separate room to avoid double-delivery)
          const colonIdx = documentId.indexOf(":");
          if (colonIdx > 0) {
            const bucketId = documentId.substring(0, colonIdx);
            if (containerSockets.has(bucketId) && socket.userId !== "container") {
              otNamespace.to(`container:${bucketId}`).emit("remote-operation", operationPayload);
            }
          }
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

        // Also forward to container (if registered and sender is not the container)
        if (containerSockets.has(bucketId) && socket.userId !== "container") {
          otNamespace.to(`container:${bucketId}`).emit("file-tree-change", { bucketId, filePath, action });
        }

        if (action === "delete") {
          const documentId = getDocumentId(bucketId, filePath);
          otServer.cleanupDocument(documentId, true);
          // Also delete from DB
          otServer.deleteDocumentPermanently(documentId).catch((e) => {
            logger.error(`[OT] Failed to permanently delete ${documentId}:`, e);
          });
          logger.info(`[OT] Cleaned up document for deleted file: ${documentId}`);

          // If container initiated the delete, also remove from S3
          if (socket.userId === "container") {
            deleteFileFromS3(bucketId, filePath).catch((e) => {
              logger.error(`[OT] Failed to delete ${filePath} from S3:`, e);
            });
          }
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

      // If this was a container socket, switch bucket back to Mode A and flush to S3
      if (socket.userId === "container") {
        for (const [bucketId, socketId] of containerSockets.entries()) {
          if (socketId === socket.id) {
            containerSockets.delete(bucketId);
            setBucketMode(bucketId, 'A');
            // Flush all documents for this bucket to S3 (Mode A needs current S3)
            otServer.forceSaveDocumentsForBucket(bucketId).catch((e) => {
              logger.error(`[OT] Failed to flush bucket ${bucketId} on container disconnect:`, e);
            });
            logger.info(`[OT] Container disconnected for bucket ${bucketId}, switched to Mode A`);
          }
        }
      }

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
