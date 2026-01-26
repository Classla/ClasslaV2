import { Server as SocketIOServer } from "socket.io";
import { AuthenticatedSocket } from "./websocket";
import { logger } from "../utils/logger";
import * as Y from "yjs";
import { loadYjsDocumentFromS3, saveYjsDocumentToS3 } from "./yjsPersistenceService";
import { supabase } from "../middleware/auth";

// Map of document IDs to Y.js documents
const documents = new Map<string, Y.Doc>();

// Map of document IDs to bucket info
const documentBuckets = new Map<string, { bucket_name: string; region: string }>();

// Map of document IDs to save timeouts (for debouncing)
const saveTimeouts = new Map<string, NodeJS.Timeout>();

// Track which documents need snapshot saves
const documentsNeedingSnapshot = new Set<string>();

/**
 * Get document ID from bucket ID and file path
 */
function getDocumentId(bucketId: string, filePath: string): string {
  return `${bucketId}:${filePath}`;
}

/**
 * Get or create a Y.js document
 */
export async function getOrCreateDocument(
  bucketId: string,
  filePath: string,
  bucketInfo: { bucket_name: string; region: string }
): Promise<Y.Doc> {
  const docId = getDocumentId(bucketId, filePath);
  
  if (documents.has(docId)) {
    return documents.get(docId)!;
  }

  // Create new document
  const doc = new Y.Doc();
  documents.set(docId, doc);
  documentBuckets.set(docId, bucketInfo);

  // Try to load from S3
  try {
    const existingState = await loadYjsDocumentFromS3(bucketInfo, filePath);
    if (existingState) {
      Y.applyUpdate(doc, existingState);
      logger.info(`Loaded Y.js document from S3: ${docId}`);
    } else {
      logger.info(`Created new Y.js document: ${docId}`);
    }
  } catch (error: any) {
    logger.error(`Failed to load Y.js document from S3 for ${docId}:`, error);
    // Continue with empty document
  }

  // Set up periodic snapshot saves with improved reliability
  let updateCount = 0;
  let lastSaveTime = Date.now();
  const SAVE_DEBOUNCE_MS = 1000; // Reduced to 1s for even faster saves to reduce race conditions
  const FORCE_SAVE_INTERVAL_MS = 10000; // Force save every 10 seconds regardless of updates
  
  // Force save interval to ensure data is never lost
  const forceSaveInterval = setInterval(async () => {
    if (documents.has(docId)) {
      const timeSinceLastSave = Date.now() - lastSaveTime;
      if (timeSinceLastSave >= FORCE_SAVE_INTERVAL_MS) {
        try {
          const shouldSaveSnapshot = updateCount >= 50 || documentsNeedingSnapshot.has(docId);
          await saveYjsDocumentToS3(bucketInfo, filePath, doc, shouldSaveSnapshot);
          lastSaveTime = Date.now();
          if (shouldSaveSnapshot) {
            documentsNeedingSnapshot.delete(docId);
            updateCount = 0;
          }
          logger.debug(`[Yjs] Periodic save completed for ${docId}`);
        } catch (error: any) {
          logger.error(`Failed to force save Y.js document to S3 for ${docId}:`, error);
        }
      }
    } else {
      clearInterval(forceSaveInterval);
    }
  }, FORCE_SAVE_INTERVAL_MS);
  
  doc.on("update", () => {
    updateCount++;
    lastSaveTime = Date.now();
    
    // Debounce saves (reduced to 2 seconds for faster persistence)
    if (saveTimeouts.has(docId)) {
      clearTimeout(saveTimeouts.get(docId)!);
    }

    const timeout = setTimeout(async () => {
      try {
        const shouldSaveSnapshot = updateCount >= 50 || documentsNeedingSnapshot.has(docId);
        await saveYjsDocumentToS3(bucketInfo, filePath, doc, shouldSaveSnapshot);
        lastSaveTime = Date.now();
        if (shouldSaveSnapshot) {
          documentsNeedingSnapshot.delete(docId);
          updateCount = 0;
        }
        logger.debug(`[Yjs] Debounced save completed for ${docId}`, {
          updateCount,
          savedSnapshot: shouldSaveSnapshot
        });
      } catch (error: any) {
        logger.error(`Failed to save Y.js document to S3 for ${docId}:`, error);
        // Retry after a short delay
        setTimeout(async () => {
          try {
            await saveYjsDocumentToS3(bucketInfo, filePath, doc, true);
            logger.info(`[Yjs] Retry save succeeded for ${docId}`);
          } catch (retryError: any) {
            logger.error(`[Yjs] Retry save failed for ${docId}:`, retryError);
          }
        }, 1000);
      }
      saveTimeouts.delete(docId);
    }, SAVE_DEBOUNCE_MS);

    saveTimeouts.set(docId, timeout);
    
    // Mark for snapshot save if needed (reduced threshold from 100 to 50)
    if (updateCount >= 50) {
      documentsNeedingSnapshot.add(docId);
    }
  });
  
  // Store cleanup function for interval
  (doc as any)._forceSaveInterval = forceSaveInterval;

  return doc;
}

/**
 * Force save a document immediately (for page unload, etc.)
 */
export async function forceSaveDocument(bucketId: string, filePath: string): Promise<void> {
  const docId = getDocumentId(bucketId, filePath);
  const doc = documents.get(docId);
  if (doc) {
    const bucketInfo = documentBuckets.get(docId);
    if (bucketInfo) {
      try {
        await saveYjsDocumentToS3(bucketInfo, filePath, doc, true);
        logger.info(`[Yjs] Force save completed for ${docId}`);
      } catch (error: any) {
        logger.error(`[Yjs] Force save failed for ${docId}:`, error);
        throw error;
      }
    }
  }
}

/**
 * Clean up document when no longer needed
 */
export function cleanupDocument(docId: string, skipSave: boolean = false): void {
  const doc = documents.get(docId);
  if (doc) {
    // Save final state before cleanup (unless skipSave is true, e.g., when file is being deleted)
    if (!skipSave) {
    const bucketInfo = documentBuckets.get(docId);
    if (bucketInfo) {
      const filePath = docId.split(":").slice(1).join(":");
      saveYjsDocumentToS3(bucketInfo, filePath, doc, true).catch((error) => {
        logger.error(`Failed to save Y.js document during cleanup for ${docId}:`, error);
      });
      }
    }

    // Clear force save interval
    if ((doc as any)._forceSaveInterval) {
      clearInterval((doc as any)._forceSaveInterval);
    }

    documents.delete(docId);
    documentBuckets.delete(docId);
    
    if (saveTimeouts.has(docId)) {
      clearTimeout(saveTimeouts.get(docId)!);
      saveTimeouts.delete(docId);
    }
  }
}

/**
 * Setup Y.js WebSocket provider namespace
 */
export function setupYjsWebSocket(io: SocketIOServer): void {
  const yjsNamespace = io.of("/yjs");

  logger.info("Setting up Y.js WebSocket namespace at /yjs");

  // Apply authentication middleware
  yjsNamespace.use(async (socket: AuthenticatedSocket, next) => {
    try {
      // Get request from socket
      const req = socket.request as any;

      // Check for container service token first (for container connections)
      // Try multiple sources: headers, auth object, and query params
      const serviceToken = 
        (req.headers["x-container-service-token"] as string) ||
        (socket.handshake.auth?.token as string) ||
        (socket.handshake.query?.token as string);
      const expectedServiceToken = process.env.CONTAINER_SERVICE_TOKEN;

      logger.info("Y.js WebSocket authentication attempt", {
        socketId: socket.id,
        hasServiceToken: !!serviceToken,
        hasExpectedToken: !!expectedServiceToken,
        serviceTokenLength: serviceToken?.length || 0,
        expectedTokenLength: expectedServiceToken?.length || 0,
        serviceTokenValue: serviceToken ? `${serviceToken.substring(0, 10)}...` : "none",
        expectedTokenValue: expectedServiceToken ? `${expectedServiceToken.substring(0, 10)}...` : "none",
        tokensMatch: serviceToken === expectedServiceToken,
        headers: Object.keys(req.headers),
        headerToken: req.headers["x-container-service-token"] ? `${(req.headers["x-container-service-token"] as string).substring(0, 10)}...` : "none",
        authToken: socket.handshake.auth?.token ? `${(socket.handshake.auth.token as string).substring(0, 10)}...` : "none",
        queryToken: socket.handshake.query?.token ? `${(socket.handshake.query.token as string).substring(0, 10)}...` : "none",
        auth: socket.handshake.auth,
        query: socket.handshake.query,
      });

      if (serviceToken && expectedServiceToken && serviceToken === expectedServiceToken) {
        // Container authentication - allow connection
        socket.userId = "container"; // Special user ID for containers
        socket.isAuthenticated = true;
        logger.info("Y.js WebSocket connection authenticated (container)", {
          socketId: socket.id,
        });
        return next();
      }

      // Allow test bucket connections in development without authentication
      // Check if this is a test bucket connection by checking the bucketId in the handshake
      const testBucketId = "00000000-0000-0000-0000-000000000001";
      const testUserId = "00000000-0000-0000-0000-000000000000";
      const isTestConnection = process.env.NODE_ENV === 'development' && 
                               (socket.handshake.query?.bucketId === testBucketId ||
                                socket.handshake.auth?.bucketId === testBucketId ||
                                req.headers["x-test-bucket-id"] === testBucketId);
      
      if (isTestConnection) {
        // Test bucket connection - allow without session
        socket.userId = testUserId;
        socket.isAuthenticated = true;
        logger.info("Y.js WebSocket connection authenticated (test bucket)", {
          socketId: socket.id,
          bucketId: testBucketId,
        });
        return next();
      }

      // Otherwise, try session-based authentication (for frontend)
      const cookies = req.headers.cookie || "";
      const sessionCookieName = "classla.sid";
      const sessionIdMatch = cookies.match(new RegExp(`${sessionCookieName}=([^;]+)`));

      if (!sessionIdMatch) {
        logger.warn("Y.js WebSocket connection rejected: No session cookie or service token", {
          socketId: socket.id,
          cookies: cookies.substring(0, 100), // Log first 100 chars for debugging
          hasServiceToken: !!serviceToken,
        });
        return next(new Error("No session cookie or service token found"));
      }

      const sessionId = sessionIdMatch[1];
      req.sessionID = sessionId;
      req.session = null as any;

      // Import session middleware and session management service
      const { sessionMiddleware } = await import("../config/session");
      const { sessionManagementService } = await import("./session");

      // Use the session middleware to load the session
      await new Promise<void>((resolve, reject) => {
        const mockRes = {
          cookie: () => {},
          end: () => {},
          writeHead: () => {},
        } as any;

        sessionMiddleware(req as any, mockRes, (err: any) => {
          if (err) {
            logger.warn("Session middleware error in Y.js WebSocket", {
              socketId: socket.id,
              error: err.message,
            });
            reject(err);
            return;
          }
          resolve();
        });
      });

      // Validate session using session management service
      let sessionData;
      try {
        sessionData = await sessionManagementService.validateSession(req);
      } catch (error) {
        logger.warn("Y.js WebSocket connection rejected: Session validation error", {
          socketId: socket.id,
          error: error instanceof Error ? error.message : "Unknown",
        });
        return next(
          new Error(`Session validation failed: ${error instanceof Error ? error.message : "Unknown error"}`)
        );
      }

      if (!sessionData) {
        logger.warn("Y.js WebSocket connection rejected: Invalid session", {
          socketId: socket.id,
        });
        return next(new Error("Invalid or expired session"));
      }

      // Get user info
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("id, email, is_admin, workos_user_id")
        .eq("workos_user_id", sessionData.workosUserId)
        .single();

      if (userError || !userData) {
        logger.warn("Y.js WebSocket connection rejected: User not found", {
          socketId: socket.id,
        });
        return next(new Error("User not found"));
      }

      socket.userId = userData.id;
      socket.isAuthenticated = true;

      logger.info("Y.js WebSocket connection authenticated", {
        socketId: socket.id,
        userId: userData.id,
      });

      next();
    } catch (error) {
      logger.error("Y.js WebSocket authentication error", {
        socketId: socket.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      next(new Error("Authentication failed"));
    }
  });

  // Handle connection
  yjsNamespace.on("connection", async (socket: AuthenticatedSocket) => {
    logger.info("Y.js WebSocket client connected", {
      socketId: socket.id,
      userId: socket.userId,
    });

    // Handle document subscription
    socket.on("subscribe-document", async (data: { bucketId: string; filePath: string }) => {
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

        // Check if user has access (owner or enrolled in course)
        // Containers (userId === "container") have access to all buckets
        if (socket.userId !== "container" && bucket.user_id !== socket.userId) {
          // Check if user is enrolled in the course
          if (bucket.course_id) {
            const { data: enrollment } = await supabase
              .from("enrollments")
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

        // S3 buckets are always in us-east-1
        const bucketInfo = {
          bucket_name: bucket.bucket_name,
          region: bucket.region || "us-east-1",
        };

        // Get or create document
        const doc = await getOrCreateDocument(bucketId, filePath, bucketInfo);
        const docId = getDocumentId(bucketId, filePath);

        // Join room for this document
        socket.join(docId);
        // Also join bucket room for file tree change notifications
        socket.join(`bucket:${bucketId}`);

        // Get room info for logging
        const room = yjsNamespace.adapter.rooms.get(docId);
        const roomSize = room ? room.size : 0;
        
        logger.info(`[Yjs Server] 🔔 Client subscribed to document ${docId}`, {
          socketId: socket.id,
          userId: socket.userId,
          roomSize,
          currentClients: room ? Array.from(room) : []
        });

        // Send initial document state
        const ytext = doc.getText("content");
        const currentContent = ytext.toString();
        const state = Y.encodeStateAsUpdate(doc);
        socket.emit("document-state", {
          bucketId,
          filePath,
          state: Buffer.from(state).toString("base64"),
        });

        logger.info(`[Yjs Server] ✅ Sent initial document state for ${docId}`, {
          socketId: socket.id,
          contentLength: currentContent.length,
          contentPreview: currentContent.substring(0, 50)
        });
      } catch (error: any) {
        logger.error("Failed to subscribe to Y.js document:", error);
        socket.emit("error", { message: error.message || "Failed to subscribe" });
      }
    });

    // Handle document unsubscription
    socket.on("unsubscribe-document", (data: { bucketId: string; filePath: string }) => {
      const { bucketId, filePath } = data;
      const docId = getDocumentId(bucketId, filePath);
      socket.leave(docId);
    });

    // Handle file tree changes (file creation/deletion)
    socket.on("file-tree-change", (data: { bucketId: string; filePath: string; action: "create" | "delete" }) => {
      const { bucketId, filePath, action } = data;
      const docId = getDocumentId(bucketId, filePath);
      
      // Broadcast to all clients subscribed to this bucket
      // Use a room for the bucket to broadcast file tree changes
      const bucketRoom = `bucket:${bucketId}`;
      socket.to(bucketRoom).emit("file-tree-change", {
        bucketId,
        filePath,
        action,
      });
      
      logger.debug("File tree change broadcasted", { bucketId, filePath, action });
    });

    // Handle document updates (Y.js protocol)
    socket.on("yjs-update", async (data: { bucketId: string; filePath: string; update: string }) => {
      const { bucketId, filePath, update } = data;
      const docId = getDocumentId(bucketId, filePath);
      
      logger.info(`[Yjs Server] 📥 Received yjs-update from socket ${socket.id}`, {
        docId,
        updateSize: update.length,
        socketId: socket.id,
        userId: socket.userId
      });
      
      const doc = documents.get(docId);
      if (!doc) {
        logger.error(`[Yjs Server] ❌ Document not found: ${docId}`);
        socket.emit("error", { message: "Document not found" });
        return;
      }

      // Get bucket info for this document
      const bucketInfo = documentBuckets.get(docId);
      if (!bucketInfo) {
        logger.error(`[Yjs Server] ❌ Bucket info not found for document: ${docId}`);
        socket.emit("error", { message: "Bucket info not found" });
        return;
      }

      try {
        // Get current content before update
        const ytext = doc.getText("content");
        const beforeContent = ytext.toString();
        const wasEmpty = beforeContent.length === 0;
        
        // Apply update to document
        // CRITICAL: Apply update with origin to track where it came from
        // This helps with debugging and prevents echo loops
        const updateBuffer = Buffer.from(update, "base64");
        Y.applyUpdate(doc, updateBuffer, socket.userId === "container" ? "container" : "client");
        
        const afterContent = ytext.toString();
        const isNewFile = wasEmpty && afterContent.length > 0;
        // NOTE: Empty files are valid! Do NOT auto-delete when content becomes empty.
        // File deletion should only happen via explicit delete actions (file-tree-change delete events)
        
        logger.info(`[Yjs Server] ✅ Applied update to document ${docId}`, {
          beforeLength: beforeContent.length,
          afterLength: afterContent.length,
          changed: beforeContent !== afterContent,
          contentPreview: afterContent.substring(0, 50),
          isNewFile,
          socketUserId: socket.userId,
          isContainer: socket.userId === "container"
        });
        
        // CRITICAL: For new files from container, save immediately to S3 (no debounce)
        // This ensures the file appears in S3 file listings quickly
        if (isNewFile && socket.userId === "container") {
          try {
            await saveYjsDocumentToS3(bucketInfo, filePath, doc, false);
            logger.info(`[Yjs Server] ⚡ Immediate save for new file from container: ${filePath}`);
          } catch (error: any) {
            logger.error(`[Yjs Server] Failed to immediately save new file ${filePath}:`, error);
            // Don't throw - let the normal debounced save handle it
          }
        }
        
        // If this is a new file (was empty, now has content) from container, broadcast file-tree-change
        // CRITICAL: Check if this is from container AND it's a new file
        if (isNewFile && socket.userId === "container") {
          const bucketRoom = `bucket:${bucketId}`;
          yjsNamespace.to(bucketRoom).emit("file-tree-change", {
            bucketId,
            filePath,
            action: "create",
          });
          
          logger.info(`[Yjs Server] 📢 Broadcasted file-tree-change (create) for new file from container: ${filePath}`, {
            bucketId,
            bucketRoom,
            beforeLength: beforeContent.length,
            afterLength: afterContent.length
          });
        } else if (isNewFile && socket.userId !== "container") {
          // Log when it's a new file but NOT from container (for debugging)
          logger.debug(`[Yjs Server] New file detected but not from container: ${filePath}`, {
            socketUserId: socket.userId,
            beforeLength: beforeContent.length,
            afterLength: afterContent.length
          });
        } else if (!isNewFile && socket.userId === "container" && wasEmpty && afterContent.length > 0) {
          // Edge case: Document was empty but update didn't trigger isNewFile (maybe document was just created)
          // This can happen if the document was created in the same transaction
          logger.info(`[Yjs Server] 📢 Edge case: File created from container (document was empty): ${filePath}`, {
            bucketId,
            beforeLength: beforeContent.length,
            afterLength: afterContent.length
          });
          const bucketRoom = `bucket:${bucketId}`;
          yjsNamespace.to(bucketRoom).emit("file-tree-change", {
            bucketId,
            filePath,
            action: "create",
          });
        }
        
        // NOTE: We do NOT auto-delete files when content becomes empty!
        // Empty files are valid. File deletion should only happen via:
        // 1. Explicit file-tree-change delete events from frontend
        // 2. Direct DELETE API calls to /api/s3buckets/:bucketId/files/*
        // This prevents files from being deleted when users backspace all content.

        // Get all sockets in the room
        const room = yjsNamespace.adapter.rooms.get(docId);
        const roomSize = room ? room.size : 0;
        const socketIdsInRoom = room ? Array.from(room) : [];
        const isSenderInRoom = socketIdsInRoom.includes(socket.id);
        
        logger.info(`[Yjs Server] 📤 Broadcasting update to room ${docId}`, {
          roomSize,
          socketIds: socketIdsInRoom,
          senderId: socket.id,
          isSenderInRoom,
          willReceive: socketIdsInRoom.filter(id => id !== socket.id)
        });

        // Broadcast to other clients in the same room (excluding sender)
        // CRITICAL: Verify docId matches the filePath to prevent cross-file contamination
        const expectedDocId = getDocumentId(bucketId, filePath);
        if (docId !== expectedDocId) {
          logger.error(`[Yjs Server] ❌ CRITICAL: Document ID mismatch!`, {
            receivedDocId: docId,
            expectedDocId,
            bucketId,
            filePath,
            socketId: socket.id
          });
          socket.emit("error", { message: "Document ID mismatch" });
          return;
        }
        
        const broadcastResult = socket.to(docId).emit("yjs-update", {
          bucketId,
          filePath, // CRITICAL: Use the filePath from the received data, not from docId
          update,
        });

        logger.info(`[Yjs Server] ✅ Broadcasted yjs-update to room ${docId}`, {
          recipients: roomSize - 1, // Excluding sender
          actualRecipients: socketIdsInRoom.filter(id => id !== socket.id).length,
          broadcastResult: !!broadcastResult,
          filePath, // Log filePath to verify it's correct
          docId,
          expectedDocId
        });
      } catch (error: any) {
        logger.error(`[Yjs Server] ❌ Failed to apply Y.js update for ${docId}:`, error);
        socket.emit("error", { message: "Failed to apply update" });
      }
    });

    // Handle disconnect
    socket.on("disconnect", (reason) => {
      logger.info("Y.js WebSocket client disconnected", {
        socketId: socket.id,
        userId: socket.userId,
        reason,
      });

      // Note: We don't cleanup documents on disconnect since other clients might be using them
      // Documents are cleaned up when they're no longer referenced (garbage collection)
    });

    socket.on("error", (error) => {
      logger.error("Y.js WebSocket error", {
        socketId: socket.id,
        userId: socket.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
  });

  // Periodic cleanup of unused documents (every 10 minutes)
  setInterval(() => {
    // For now, we keep documents in memory
    // In the future, we could implement LRU cache or similar
    logger.debug(`Y.js documents in memory: ${documents.size}`);
  }, 600000); // 10 minutes
}

/**
 * Get Y.js document (for external use)
 */
export function getYjsDocument(bucketId: string, filePath: string): Y.Doc | null {
  const docId = getDocumentId(bucketId, filePath);
  return documents.get(docId) || null;
}

/**
 * Force save all documents to S3
 */
export async function saveAllDocumentsToS3(): Promise<void> {
  const promises: Promise<void>[] = [];
  
  for (const [docId, doc] of documents.entries()) {
    const bucketInfo = documentBuckets.get(docId);
    if (bucketInfo) {
      const filePath = docId.split(":").slice(1).join(":");
      promises.push(
        saveYjsDocumentToS3(bucketInfo, filePath, doc, true).catch((error) => {
          logger.error(`Failed to save document ${docId} during batch save:`, error);
        })
      );
    }
  }

  await Promise.all(promises);
  logger.info(`Saved ${promises.length} Y.js documents to S3`);
}

