import { Server as SocketIOServer } from "socket.io";
import * as Y from "yjs";
import { logger } from "../utils/logger";
import { supabase } from "../middleware/auth";

// Map of course/template IDs to Y.js documents
const moduleTreeDocs = new Map<string, Y.Doc>();

// Map of document IDs to cleanup timeouts
const cleanupTimeouts = new Map<string, NodeJS.Timeout>();

// Grace period before cleaning up a document with no connections (ms)
const CLEANUP_GRACE_PERIOD = 60000; // 60 seconds

/**
 * Get document ID for a module tree
 */
function getModuleTreeDocId(courseId?: string, templateId?: string): string {
  if (courseId) {
    return `module-tree:course:${courseId}`;
  } else if (templateId) {
    return `module-tree:template:${templateId}`;
  }
  throw new Error("Either courseId or templateId must be provided");
}

/**
 * Get or create a module tree Y.js document
 */
export function getOrCreateModuleTreeDoc(courseId?: string, templateId?: string): Y.Doc {
  const docId = getModuleTreeDocId(courseId, templateId);

  if (moduleTreeDocs.has(docId)) {
    return moduleTreeDocs.get(docId)!;
  }

  logger.info(`[ModuleTreeYjs] Creating new module tree document: ${docId}`);
  const doc = new Y.Doc();

  // Initialize the structure
  const assignments = doc.getMap("assignments");
  const folders = doc.getMap("folders");
  const metadata = doc.getMap("metadata");

  metadata.set("lastUpdate", Date.now());
  metadata.set("courseId", courseId || null);
  metadata.set("templateId", templateId || null);

  moduleTreeDocs.set(docId, doc);

  return doc;
}

/**
 * Load initial module tree data from database
 */
export async function loadModuleTreeData(courseId?: string, templateId?: string): Promise<void> {
  const docId = getModuleTreeDocId(courseId, templateId);
  const doc = getOrCreateModuleTreeDoc(courseId, templateId);

  try {
    logger.info(`[ModuleTreeYjs] Loading module tree data for ${docId}`);

    // Load assignments
    const assignmentsQuery = supabase
      .from("assignments")
      .select("id, name, module_path, order_index, publish_times, due_dates_map, created_at, updated_at");

    if (courseId) {
      assignmentsQuery.eq("course_id", courseId);
    } else if (templateId) {
      assignmentsQuery.eq("template_id", templateId);
    }

    const { data: assignmentsData, error: assignmentsError } = await assignmentsQuery;

    if (assignmentsError) {
      logger.error(`[ModuleTreeYjs] Error loading assignments for ${docId}:`, assignmentsError);
      throw assignmentsError;
    }

    // Load folders
    const foldersQuery = supabase
      .from("folders")
      .select("id, name, path, order_index, created_at, updated_at");

    if (courseId) {
      foldersQuery.eq("course_id", courseId);
    } else if (templateId) {
      foldersQuery.eq("template_id", templateId);
    }

    const { data: foldersData, error: foldersError } = await foldersQuery;

    if (foldersError) {
      logger.error(`[ModuleTreeYjs] Error loading folders for ${docId}:`, foldersError);
      throw foldersError;
    }

    // Update Y.js document
    doc.transact(() => {
      const assignments = doc.getMap("assignments");
      const folders = doc.getMap("folders");

      // Clear existing data
      assignments.clear();
      folders.clear();

      // Populate assignments
      assignmentsData?.forEach((assignment) => {
        const assignmentMap = new Y.Map();
        assignmentMap.set("id", assignment.id);
        assignmentMap.set("name", assignment.name);
        assignmentMap.set("module_path", assignment.module_path || []);
        assignmentMap.set("order_index", assignment.order_index || 0);
        assignmentMap.set("publish_times", assignment.publish_times || {});
        assignmentMap.set("due_dates_map", assignment.due_dates_map || {});
        assignmentMap.set("created_at", assignment.created_at);
        assignmentMap.set("updated_at", assignment.updated_at);
        assignments.set(assignment.id, assignmentMap);
      });

      // Populate folders
      foldersData?.forEach((folder) => {
        const folderMap = new Y.Map();
        folderMap.set("id", folder.id);
        folderMap.set("name", folder.name);
        folderMap.set("path", folder.path || []);
        folderMap.set("order_index", folder.order_index || 0);
        folderMap.set("created_at", folder.created_at);
        folderMap.set("updated_at", folder.updated_at);
        folders.set(folder.id, folderMap);
      });

      // Update metadata
      const metadata = doc.getMap("metadata");
      metadata.set("lastUpdate", Date.now());
    });

    logger.info(`[ModuleTreeYjs] Loaded module tree data for ${docId}`, {
      assignmentsCount: assignmentsData?.length || 0,
      foldersCount: foldersData?.length || 0,
    });
  } catch (error) {
    logger.error(`[ModuleTreeYjs] Failed to load module tree data for ${docId}:`, error);
    throw error;
  }
}

/**
 * Broadcast assignment update to all connected clients
 */
export function broadcastAssignmentUpdate(
  io: SocketIOServer,
  assignmentId: string,
  assignmentData: any,
  action: "create" | "update" | "delete"
): void {
  const courseId = assignmentData.course_id;
  const templateId = assignmentData.template_id;

  if (!courseId && !templateId) {
    logger.warn(`[ModuleTreeYjs] Assignment ${assignmentId} has no course_id or template_id, skipping broadcast`);
    return;
  }

  const docId = getModuleTreeDocId(courseId, templateId);
  const doc = getOrCreateModuleTreeDoc(courseId, templateId);

  logger.info(`[ModuleTreeYjs] Broadcasting assignment ${action}: ${assignmentId} to ${docId}`);

  doc.transact(() => {
    const assignments = doc.getMap("assignments");

    if (action === "delete") {
      assignments.delete(assignmentId);
    } else {
      const assignmentMap = new Y.Map();
      assignmentMap.set("id", assignmentData.id);
      assignmentMap.set("name", assignmentData.name);
      assignmentMap.set("module_path", assignmentData.module_path || []);
      assignmentMap.set("order_index", assignmentData.order_index || 0);
      assignmentMap.set("publish_times", assignmentData.publish_times || {});
      assignmentMap.set("due_dates_map", assignmentData.due_dates_map || {});
      assignmentMap.set("created_at", assignmentData.created_at);
      assignmentMap.set("updated_at", assignmentData.updated_at);
      assignments.set(assignmentId, assignmentMap);
    }

    // Update metadata
    const metadata = doc.getMap("metadata");
    metadata.set("lastUpdate", Date.now());
  });

  // Broadcast the update to all connected clients
  const namespace = io.of("/yjs");
  const update = Y.encodeStateAsUpdate(doc);

  namespace.to(docId).emit("module-tree-update", {
    docId,
    courseId,
    templateId,
    update: Buffer.from(update).toString("base64"),
  });

  logger.info(`[ModuleTreeYjs] Broadcasted assignment ${action} to room ${docId}`);
}

/**
 * Broadcast folder update to all connected clients
 */
export function broadcastFolderUpdate(
  io: SocketIOServer,
  folderId: string,
  folderData: any,
  action: "create" | "update" | "delete"
): void {
  const courseId = folderData.course_id;
  const templateId = folderData.template_id;

  if (!courseId && !templateId) {
    logger.warn(`[ModuleTreeYjs] Folder ${folderId} has no course_id or template_id, skipping broadcast`);
    return;
  }

  const docId = getModuleTreeDocId(courseId, templateId);
  const doc = getOrCreateModuleTreeDoc(courseId, templateId);

  logger.info(`[ModuleTreeYjs] Broadcasting folder ${action}: ${folderId} to ${docId}`);

  doc.transact(() => {
    const folders = doc.getMap("folders");

    if (action === "delete") {
      folders.delete(folderId);
    } else {
      const folderMap = new Y.Map();
      folderMap.set("id", folderData.id);
      folderMap.set("name", folderData.name);
      folderMap.set("path", folderData.path || []);
      folderMap.set("order_index", folderData.order_index || 0);
      folderMap.set("created_at", folderData.created_at);
      folderMap.set("updated_at", folderData.updated_at);
      folders.set(folderId, folderMap);
    }

    // Update metadata
    const metadata = doc.getMap("metadata");
    metadata.set("lastUpdate", Date.now());
  });

  // Broadcast the update to all connected clients
  const namespace = io.of("/yjs");
  const update = Y.encodeStateAsUpdate(doc);

  namespace.to(docId).emit("module-tree-update", {
    docId,
    courseId,
    templateId,
    update: Buffer.from(update).toString("base64"),
  });

  logger.info(`[ModuleTreeYjs] Broadcasted folder ${action} to room ${docId}`);
}

/**
 * Schedule cleanup for a document after grace period
 */
function scheduleDocumentCleanup(docId: string, io: SocketIOServer): void {
  if (cleanupTimeouts.has(docId)) {
    clearTimeout(cleanupTimeouts.get(docId)!);
  }

  const timeout = setTimeout(() => {
    const namespace = io.of("/yjs");
    const room = namespace.adapter.rooms.get(docId);
    const roomSize = room?.size || 0;

    if (roomSize === 0) {
      logger.info(`[ModuleTreeYjs] Cleaning up unused document: ${docId}`);
      moduleTreeDocs.delete(docId);
    } else {
      logger.info(`[ModuleTreeYjs] Document ${docId} has ${roomSize} connections, skipping cleanup`);
    }

    cleanupTimeouts.delete(docId);
  }, CLEANUP_GRACE_PERIOD);

  cleanupTimeouts.set(docId, timeout);
}

/**
 * Cancel scheduled cleanup
 */
function cancelDocumentCleanup(docId: string): void {
  if (cleanupTimeouts.has(docId)) {
    clearTimeout(cleanupTimeouts.get(docId)!);
    cleanupTimeouts.delete(docId);
    logger.info(`[ModuleTreeYjs] Cancelled cleanup for ${docId}`);
  }
}

/**
 * Setup module tree WebSocket handlers
 */
export function setupModuleTreeWebSocket(io: SocketIOServer): void {
  const namespace = io.of("/yjs");

  logger.info("[ModuleTreeYjs] Setting up module tree WebSocket handlers");

  // Add handler to existing namespace
  namespace.use(async (socket: any, next) => {
    // Authentication is already handled by the main YJS namespace middleware
    next();
  });

  // We'll add to the existing connection handler by listening for module tree events
  namespace.on("connection", async (socket: any) => {
    // Handle module tree subscription
    socket.on("subscribe-module-tree", async (data: { courseId?: string; templateId?: string }) => {
      const { courseId, templateId } = data;

      if (!courseId && !templateId) {
        socket.emit("error", { message: "Either courseId or templateId is required" });
        return;
      }

      try {
        const docId = getModuleTreeDocId(courseId, templateId);

        logger.info(`[ModuleTreeYjs] Client subscribing to module tree: ${docId}`, {
          socketId: socket.id,
          userId: socket.userId,
          courseId,
          templateId,
        });

        // Verify access
        if (courseId) {
          // Check if user has access to this course
          const { data: enrollment, error: enrollmentError } = await supabase
            .from("enrollments")
            .select("id, role")
            .eq("course_id", courseId)
            .eq("user_id", socket.userId)
            .single();

          if (enrollmentError || !enrollment) {
            logger.warn(`[ModuleTreeYjs] Access denied to course ${courseId} for user ${socket.userId}`);
            socket.emit("error", { message: "Access denied to this course" });
            return;
          }
        } else if (templateId) {
          // Check if user has access to this template (must be instructor)
          const { data: template, error: templateError } = await supabase
            .from("course_templates")
            .select("id, created_by")
            .eq("id", templateId)
            .single();

          if (templateError || !template) {
            logger.warn(`[ModuleTreeYjs] Template ${templateId} not found`);
            socket.emit("error", { message: "Template not found" });
            return;
          }

          // Only template creator has access
          if (template.created_by !== socket.userId) {
            logger.warn(`[ModuleTreeYjs] Access denied to template ${templateId} for user ${socket.userId}`);
            socket.emit("error", { message: "Access denied to this template" });
            return;
          }
        }

        // Get or create document and load initial data if needed
        let doc = moduleTreeDocs.get(docId);
        if (!doc) {
          doc = getOrCreateModuleTreeDoc(courseId, templateId);
          await loadModuleTreeData(courseId, templateId);
        }

        // Join room
        socket.join(docId);
        cancelDocumentCleanup(docId);

        // Send initial state
        const state = Y.encodeStateAsUpdate(doc);
        socket.emit("module-tree-state", {
          docId,
          courseId,
          templateId,
          state: Buffer.from(state).toString("base64"),
        });

        logger.info(`[ModuleTreeYjs] Client subscribed to module tree: ${docId}`, {
          socketId: socket.id,
          userId: socket.userId,
          roomSize: namespace.adapter.rooms.get(docId)?.size || 0,
        });
      } catch (error: any) {
        logger.error("[ModuleTreeYjs] Failed to subscribe to module tree:", error);
        socket.emit("error", { message: error.message || "Failed to subscribe" });
      }
    });

    // Handle unsubscribe
    socket.on("unsubscribe-module-tree", (data: { courseId?: string; templateId?: string }) => {
      const { courseId, templateId } = data;

      if (!courseId && !templateId) return;

      try {
        const docId = getModuleTreeDocId(courseId, templateId);
        socket.leave(docId);

        logger.info(`[ModuleTreeYjs] Client unsubscribed from module tree: ${docId}`, {
          socketId: socket.id,
        });

        // Schedule cleanup if no more clients
        const room = namespace.adapter.rooms.get(docId);
        if (!room || room.size === 0) {
          scheduleDocumentCleanup(docId, io);
        }
      } catch (error: any) {
        logger.error("[ModuleTreeYjs] Error unsubscribing from module tree:", error);
      }
    });

    // Handle disconnect - check for orphaned module tree rooms
    const originalDisconnect = socket.listeners("disconnect")[0];
    socket.on("disconnect", (reason) => {
      // Check module tree rooms for cleanup
      for (const docId of moduleTreeDocs.keys()) {
        const room = namespace.adapter.rooms.get(docId);
        if (!room || room.size === 0) {
          scheduleDocumentCleanup(docId, io);
        }
      }
    });
  });

  // Periodic cleanup
  setInterval(() => {
    logger.info(`[ModuleTreeYjs] Status: ${moduleTreeDocs.size} documents, ${cleanupTimeouts.size} pending cleanups`);

    for (const docId of moduleTreeDocs.keys()) {
      const room = namespace.adapter.rooms.get(docId);
      const roomSize = room?.size || 0;

      if (roomSize === 0 && !cleanupTimeouts.has(docId)) {
        logger.info(`[ModuleTreeYjs] Found orphaned document ${docId}, scheduling cleanup`);
        scheduleDocumentCleanup(docId, io);
      }
    }
  }, 300000); // 5 minutes
}
