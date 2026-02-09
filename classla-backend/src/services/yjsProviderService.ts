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

// Track cleanup timeouts for documents with no connections
const cleanupTimeouts = new Map<string, NodeJS.Timeout>();

// Grace period before cleaning up a document with no connections (ms)
const CLEANUP_GRACE_PERIOD = 30000; // 30 seconds

// Track recently deleted documents to prevent on-demand recreation
// When a file is deleted, we add its docId here; the yjs-update handler
// checks this set and refuses to recreate documents that were just deleted
const recentlyDeletedDocuments = new Set<string>();
const RECENTLY_DELETED_GRACE_PERIOD = 30000; // 30 seconds

// Environment prefix for YJS document isolation (prevents local/prod conflicts)
const YJS_ENV_PREFIX = process.env.YJS_ENVIRONMENT_PREFIX ||
  (process.env.NODE_ENV === 'production' ? 'prod' : 'dev');

/**
 * Get document ID from bucket ID and file path
 * Includes environment prefix to isolate local dev from production
 */
export function getDocumentId(bucketId: string, filePath: string): string {
  return `${YJS_ENV_PREFIX}:${bucketId}:${filePath}`;
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
    const doc = documents.get(docId)!;
    const ytext = doc.getText("content");
    const currentContent = ytext.toString();
    logger.info(`[Yjs] 📎 Returning CACHED document for ${docId}`, {
      contentLength: currentContent.length,
      contentPreview: currentContent.substring(0, 100)
    });
    return doc;
  }

  logger.info(`[Yjs] 🆕 Creating NEW document for ${docId}`, {
    bucket: bucketInfo.bucket_name,
    region: bucketInfo.region
  });

  // Create new document
  const doc = new Y.Doc();
  documents.set(docId, doc);
  documentBuckets.set(docId, bucketInfo);

  // Try to load from S3
  try {
    const existingState = await loadYjsDocumentFromS3(bucketInfo, filePath);
    if (existingState) {
      Y.applyUpdate(doc, existingState);
      const ytext = doc.getText("content");
      const loadedContent = ytext.toString();
      logger.info(`[Yjs] ✅ Loaded Y.js document from S3: ${docId}`, {
        stateSize: existingState.length,
        contentLength: loadedContent.length,
        contentPreview: loadedContent.substring(0, 100)
      });
    } else {
      logger.info(`[Yjs] ⚠️ No existing state in S3, created new empty document: ${docId}`);
    }
  } catch (error: any) {
    logger.error(`[Yjs] ❌ Failed to load Y.js document from S3 for ${docId}:`, error);
    // Continue with empty document
  }

  // Set up periodic snapshot saves with improved reliability
  let updateCount = 0;
  let lastSaveTime = Date.now();
  const SAVE_DEBOUNCE_MS = 500; // Reduced to 500ms for faster saves (was 1s)
  const FORCE_SAVE_INTERVAL_MS = 5000; // Force save every 5 seconds (was 10s) regardless of updates
  
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
  
  doc.on("update", (update: Uint8Array, origin: any) => {
    updateCount++;
    lastSaveTime = Date.now();

    // Log update reception with origin tracking
    const ytext = doc.getText("content");
    const contentLength = ytext.toString().length;
    logger.info(`[Yjs] 📝 Update received for ${docId}`, {
      origin: origin || 'unknown',
      updateCount,
      contentLength,
      contentPreview: ytext.toString().substring(0, 50)
    });

    // Debounce saves (1 second for faster persistence)
    if (saveTimeouts.has(docId)) {
      clearTimeout(saveTimeouts.get(docId)!);
      logger.debug(`[Yjs] ⏳ Cleared previous save timeout for ${docId}`);
    }

    const timeout = setTimeout(async () => {
      try {
        const shouldSaveSnapshot = updateCount >= 50 || documentsNeedingSnapshot.has(docId);
        const currentContent = doc.getText("content").toString();
        logger.info(`[Yjs] 💾 Starting S3 save for ${docId}`, {
          contentLength: currentContent.length,
          shouldSaveSnapshot,
          updateCount,
          contentPreview: currentContent.substring(0, 50)
        });

        await saveYjsDocumentToS3(bucketInfo, filePath, doc, shouldSaveSnapshot);
        lastSaveTime = Date.now();
        if (shouldSaveSnapshot) {
          documentsNeedingSnapshot.delete(docId);
          updateCount = 0;
        }
        logger.info(`[Yjs] ✅ S3 save completed for ${docId}`, {
          updateCount,
          savedSnapshot: shouldSaveSnapshot,
          contentLength: currentContent.length
        });
      } catch (error: any) {
        logger.error(`[Yjs] ❌ Failed to save Y.js document to S3 for ${docId}:`, error);
        // Retry after a short delay
        setTimeout(async () => {
          try {
            await saveYjsDocumentToS3(bucketInfo, filePath, doc, true);
            logger.info(`[Yjs] 🔄 Retry save succeeded for ${docId}`);
          } catch (retryError: any) {
            logger.error(`[Yjs] ❌ Retry save failed for ${docId}:`, retryError);
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
        // docId format: env:bucketId:filePath - skip first two parts to get filePath
        const filePath = docId.split(":").slice(2).join(":");
        saveYjsDocumentToS3(bucketInfo, filePath, doc, true).catch((error) => {
          logger.error(`Failed to save Y.js document during cleanup for ${docId}:`, error);
        });
      }
    }

    // Clear force save interval
    if ((doc as any)._forceSaveInterval) {
      clearInterval((doc as any)._forceSaveInterval);
    }

    // Clear any pending cleanup timeout
    if (cleanupTimeouts.has(docId)) {
      clearTimeout(cleanupTimeouts.get(docId)!);
      cleanupTimeouts.delete(docId);
    }

    documents.delete(docId);
    documentBuckets.delete(docId);

    if (saveTimeouts.has(docId)) {
      clearTimeout(saveTimeouts.get(docId)!);
      saveTimeouts.delete(docId);
    }

    // Track recently deleted documents to prevent on-demand recreation
    // (e.g., container sending a stale yjs-update after we cleaned up)
    if (skipSave) {
      recentlyDeletedDocuments.add(docId);
      setTimeout(() => {
        recentlyDeletedDocuments.delete(docId);
      }, RECENTLY_DELETED_GRACE_PERIOD);
    }

    logger.info(`[Yjs] 🧹 Cleaned up document ${docId}`);
  }
}

/**
 * Schedule cleanup for a document after grace period (if no clients reconnect)
 */
function scheduleDocumentCleanup(docId: string, io: SocketIOServer): void {
  // Cancel any existing cleanup timeout
  if (cleanupTimeouts.has(docId)) {
    clearTimeout(cleanupTimeouts.get(docId)!);
  }

  const timeout = setTimeout(() => {
    // Check again if room is still empty
    const room = io.of("/yjs").adapter.rooms.get(docId);
    const roomSize = room?.size || 0;

    if (roomSize === 0) {
      logger.info(`[Yjs] 🧹 No connections for ${docId} after grace period, cleaning up`);
      cleanupDocument(docId);
    } else {
      logger.info(`[Yjs] 🔄 Document ${docId} has ${roomSize} connections, skipping cleanup`);
    }

    cleanupTimeouts.delete(docId);
  }, CLEANUP_GRACE_PERIOD);

  cleanupTimeouts.set(docId, timeout);
  logger.info(`[Yjs] ⏰ Scheduled cleanup for ${docId} in ${CLEANUP_GRACE_PERIOD / 1000}s`);
}

/**
 * Cancel scheduled cleanup (e.g., when a client reconnects)
 */
function cancelDocumentCleanup(docId: string): void {
  if (cleanupTimeouts.has(docId)) {
    clearTimeout(cleanupTimeouts.get(docId)!);
    cleanupTimeouts.delete(docId);
    logger.info(`[Yjs] ❌ Cancelled cleanup for ${docId} (client reconnected)`);
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

      // Get user info - handle both WorkOS users and managed students
      let userData;
      let userError;

      if (sessionData.isManagedStudent) {
        // For managed students, look up by user ID directly
        const result = await supabase
          .from("users")
          .select("id, email, is_admin, is_managed")
          .eq("id", sessionData.userId)
          .eq("is_managed", true)
          .single();

        userData = result.data;
        userError = result.error;
      } else {
        // For WorkOS users, look up by workos_user_id
        const result = await supabase
          .from("users")
          .select("id, email, is_admin, workos_user_id")
          .eq("workos_user_id", sessionData.workosUserId)
          .single();

        userData = result.data;
        userError = result.error;
      }

      if (userError || !userData) {
        logger.warn("Y.js WebSocket connection rejected: User not found", {
          socketId: socket.id,
          isManagedStudent: sessionData.isManagedStudent,
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

      const isContainer = socket.userId === "container";

      logger.info(`[Yjs Server] 📥 subscribe-document request received`, {
        bucketId,
        filePath,
        socketId: socket.id,
        userId: socket.userId,
        isContainer
      });

      if (!bucketId || !filePath) {
        socket.emit("error", { message: "bucketId and filePath are required" });
        return;
      }

      // Skip subscription for recently deleted documents to prevent recreation
      const docIdCheck = getDocumentId(bucketId, filePath);
      if (recentlyDeletedDocuments.has(docIdCheck)) {
        logger.info(`[Yjs Server] ⏭️ Skipping subscription for recently deleted document: ${docIdCheck}`);
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
          logger.warn(`[Yjs Server] ❌ Bucket not found for subscription`, { bucketId, filePath, socketId: socket.id });
          socket.emit("error", { message: "Bucket not found" });
          return;
        }

        // Check if user has access (owner or enrolled in course)
        // Containers (userId === "container") have access to all buckets
        if (!isContainer && bucket.user_id !== socket.userId) {
          // Check if user is enrolled in the course
          if (bucket.course_id) {
            const { data: enrollment } = await supabase
              .from("course_enrollments")
              .select("id")
              .eq("course_id", bucket.course_id)
              .eq("user_id", socket.userId)
              .single();

            if (!enrollment) {
              logger.warn(`[Yjs Server] ❌ Access denied for subscription`, { bucketId, filePath, socketId: socket.id, userId: socket.userId });
              socket.emit("error", { message: "Access denied" });
              return;
            }
          } else {
            logger.warn(`[Yjs Server] ❌ Access denied for subscription (no course)`, { bucketId, filePath, socketId: socket.id, userId: socket.userId });
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

        // Cancel any pending cleanup since a client is now connected
        cancelDocumentCleanup(docId);

        // Get room info for logging
        const room = yjsNamespace.adapter.rooms.get(docId);
        const roomSize = room ? room.size : 0;
        const clientList = room ? Array.from(room) : [];

        // Log with clear indication if this is a container subscription
        if (isContainer) {
          logger.info(`[Yjs Server] 🐳 CONTAINER subscribed to document ${docId}`, {
            socketId: socket.id,
            roomSize,
            currentClients: clientList,
            filePath
          });
        } else {
          logger.info(`[Yjs Server] 🔔 Client subscribed to document ${docId}`, {
            socketId: socket.id,
            userId: socket.userId,
            roomSize,
            currentClients: clientList
          });
        }

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
          isContainer,
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
      
      // Clean up Y.js document when a file is deleted to prevent saves from recreating it
      if (action === "delete") {
        cleanupDocument(docId, true); // skipSave=true prevents recreating file
        logger.info(`[Yjs] Cleaned up document for deleted file: ${docId}`);
      }

      logger.debug("File tree change broadcasted", { bucketId, filePath, action });
    });

    // Handle document updates (Y.js protocol)
    socket.on("yjs-update", async (data: { bucketId: string; filePath: string; update: string }) => {
      const { bucketId, filePath, update } = data;
      const docId = getDocumentId(bucketId, filePath);
      const isContainer = socket.userId === "container";

      // Get room info to see who will receive this update
      const room = yjsNamespace.adapter.rooms.get(docId);
      const roomSize = room ? room.size : 0;
      const clientsInRoom = room ? Array.from(room) : [];

      logger.info(`[Yjs Server] 📥 Received yjs-update from ${isContainer ? "CONTAINER" : "client"} ${socket.id}`, {
        docId,
        updateSize: update.length,
        socketId: socket.id,
        userId: socket.userId,
        isContainer,
        roomSize,
        clientsInRoom,
        willBroadcastTo: clientsInRoom.filter(id => id !== socket.id)
      });

      let doc = documents.get(docId);
      let bucketInfo = documentBuckets.get(docId);

      // CRITICAL FIX: If document doesn't exist, create it on-demand
      // This handles race conditions where yjs-update arrives before subscribe-document
      // BUT: Skip if this document was recently deleted (prevents stale updates from recreating files)
      if (!doc || !bucketInfo) {
        if (recentlyDeletedDocuments.has(docId)) {
          logger.info(`[Yjs Server] ⏭️ Skipping on-demand creation for recently deleted document: ${docId}`);
          return;
        }
        logger.warn(`[Yjs Server] ⚠️ Document not found for yjs-update, creating on-demand: ${docId}`);

        // Look up bucket info from database
        const { data: bucket, error: bucketError } = await supabase
          .from("s3_buckets")
          .select("*")
          .eq("id", bucketId)
          .is("deleted_at", null)
          .single();

        if (bucketError || !bucket) {
          logger.error(`[Yjs Server] ❌ Bucket not found for on-demand document creation: ${bucketId}`);
          socket.emit("error", { message: "Bucket not found" });
          return;
        }

        // Create document on-demand
        bucketInfo = {
          bucket_name: bucket.bucket_name,
          region: bucket.region || "us-east-1",
        };

        doc = await getOrCreateDocument(bucketId, filePath, bucketInfo);

        // Join the room for this document
        socket.join(docId);
        socket.join(`bucket:${bucketId}`);

        logger.info(`[Yjs Server] ✅ Created document on-demand for yjs-update: ${docId}`);
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
        
        // CRITICAL: For new files OR significant updates from container, save immediately to S3 (no debounce)
        // This ensures:
        // 1. New files appear in S3 file listings quickly
        // 2. Container's authoritative content is persisted immediately (e.g., after backend restart)
        const isContainerUpdate = socket.userId === "container";
        const isSignificantUpdate = wasEmpty && afterContent.length > 0; // Was empty, now has content

        if (isContainerUpdate && (isNewFile || isSignificantUpdate)) {
          try {
            await saveYjsDocumentToS3(bucketInfo, filePath, doc, false);
            logger.info(`[Yjs Server] ⚡ Immediate save for container update: ${filePath}`, {
              isNewFile,
              isSignificantUpdate,
              contentLength: afterContent.length
            });
          } catch (error: any) {
            logger.error(`[Yjs Server] Failed to immediately save container update ${filePath}:`, error);
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

      // Check each document room and schedule cleanup if empty
      // Socket.IO removes the socket from rooms before the disconnect event fires,
      // so we can check room sizes directly
      for (const docId of documents.keys()) {
        const room = yjsNamespace.adapter.rooms.get(docId);
        const roomSize = room?.size || 0;

        if (roomSize === 0) {
          // No more clients in this room, schedule cleanup
          scheduleDocumentCleanup(docId, io);
        }
      }
    });

    socket.on("error", (error) => {
      logger.error("Y.js WebSocket error", {
        socketId: socket.id,
        userId: socket.userId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    });
  });

  // Periodic cleanup of unused documents (every 5 minutes)
  setInterval(() => {
    logger.info(`[Yjs] 📊 Status: ${documents.size} documents in memory, ${cleanupTimeouts.size} pending cleanups`);

    // Check for orphaned documents (in memory but no connected clients)
    for (const docId of documents.keys()) {
      const room = yjsNamespace.adapter.rooms.get(docId);
      const roomSize = room?.size || 0;

      if (roomSize === 0 && !cleanupTimeouts.has(docId)) {
        // Orphaned document - no clients and no pending cleanup
        logger.info(`[Yjs] 🧹 Found orphaned document ${docId}, scheduling cleanup`);
        scheduleDocumentCleanup(docId, io);
      }
    }
  }, 300000); // 5 minutes
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
      const filePath = docId.split(":").slice(2).join(":");
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

