import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import {
  requireCoursePermission,
  getCoursePermissions,
  getUserCourseRole,
  isOrganizationMember,
  checkCourseOrTemplateAccess,
  getFolderContext,
} from "../middleware/authorization";

import { UserRole } from "../types/enums";
import { getIO } from "../services/websocket";
import { emitTreeUpdate } from "../services/courseTreeSocket";

const router = Router();

/**
 * Cascade path changes to all child folders and assignments when a folder is renamed or moved.
 * Updates any folder whose path starts with oldPath, and any assignment whose module_path starts with oldPath.
 */
async function cascadeFolderPathChange(
  contextId: string,
  isTemplate: boolean,
  oldPath: string[],
  newPath: string[]
): Promise<void> {
  const oldPathPrefix = oldPath.join("/");

  // Fetch all folders in context
  let foldersQuery = supabase
    .from("folders")
    .select("*")
    .is("deleted_at", null);

  if (isTemplate) {
    foldersQuery = foldersQuery.eq("template_id", contextId);
  } else {
    foldersQuery = foldersQuery.eq("course_id", contextId);
  }

  const { data: allFolders } = await foldersQuery;

  // Update child folders whose path starts with oldPath (excluding self - already updated)
  const childFolders = (allFolders || []).filter(
    (f) =>
      f.path.length > oldPath.length &&
      f.path.slice(0, oldPath.length).join("/") === oldPathPrefix
  );

  for (const childFolder of childFolders) {
    const relativePath = childFolder.path.slice(oldPath.length);
    const newChildPath = [...newPath, ...relativePath];
    await supabase
      .from("folders")
      .update({
        path: newChildPath,
        name: newChildPath[newChildPath.length - 1] || childFolder.name,
      })
      .eq("id", childFolder.id);
  }

  // Fetch all assignments in context
  let assignmentsQuery = supabase
    .from("assignments")
    .select("id, module_path")
    .is("deleted_at", null);

  if (isTemplate) {
    assignmentsQuery = assignmentsQuery.eq("template_id", contextId);
  } else {
    assignmentsQuery = assignmentsQuery.eq("course_id", contextId);
  }

  const { data: allAssignments } = await assignmentsQuery;

  // Update assignments whose module_path starts with oldPath
  const childAssignments = (allAssignments || []).filter(
    (a) =>
      a.module_path.length >= oldPath.length &&
      a.module_path.slice(0, oldPath.length).join("/") === oldPathPrefix
  );

  for (const assignment of childAssignments) {
    const relativePath = assignment.module_path.slice(oldPath.length);
    const newAssignmentPath = [...newPath, ...relativePath];
    await supabase
      .from("assignments")
      .update({ module_path: newAssignmentPath })
      .eq("id", assignment.id);
  }
}

/**
 * GET /course/:courseId/folders
 * Get all folders for a course (instructor/TA only)
 */
router.get(
  "/course/:courseId/folders",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(
        courseId,
        userId,
        isAdmin ?? false
      );

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: access.isTemplate
              ? "Not authorized to access folders for this template"
              : "Not authorized to access folders for this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // For regular courses, check if user has instructor/TA role
      if (!access.isTemplate) {
        const userRole = await getUserCourseRole(userId, courseId);

        // Only instructors, TAs, and admins can see folders
        if (
          userRole !== UserRole.INSTRUCTOR &&
          userRole !== UserRole.TEACHING_ASSISTANT &&
          !isAdmin
        ) {
          res.status(403).json({
            error: {
              code: "INSUFFICIENT_PERMISSIONS",
              message: "Only instructors and TAs can access folder structure",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Get all folders for the course or template
      let query = supabase
        .from("folders")
        .select("*");
      
      if (access.isTemplate) {
        query = query.eq("template_id", courseId);
      } else {
        query = query.eq("course_id", courseId);
      }
      
      const { data: folders, error: foldersError } = await query
        .is("deleted_at", null)
        .order("order_index", { ascending: true });

      if (foldersError) {
        throw foldersError;
      }

      res.json(folders || []);
    } catch (error) {
      console.error("Error retrieving course folders:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve course folders",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /folder
 * Create new folder
 */
router.post(
  "/folder",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { course_id, path, name, order_index } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Validate required fields
      if (!course_id || !path || !name) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "course_id, path, and name are required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(
        course_id,
        userId,
        isAdmin ?? false
      );

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to create folders",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const permissions = access.permissions || { canRead: true, canWrite: true, canGrade: false, canManage: true };

      if (!permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_COURSE_PERMISSIONS",
            message: "Required permission: canManage",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate path is an array
      if (!Array.isArray(path)) {
        res.status(400).json({
          error: {
            code: "INVALID_PATH_FORMAT",
            message: "Path must be an array of strings",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate that name matches the last element of path
      if (path.length > 0 && path[path.length - 1] !== name) {
        res.status(400).json({
          error: {
            code: "NAME_PATH_MISMATCH",
            message: "Name must match the last element of the path",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Compute next order_index if not provided
      let computedOrderIndex = order_index;
      if (computedOrderIndex === undefined || computedOrderIndex === null) {
        let siblingsQuery = supabase
          .from("folders")
          .select("order_index")
          .is("deleted_at", null);

        if (access.isTemplate) {
          siblingsQuery = siblingsQuery.eq("template_id", course_id);
        } else {
          siblingsQuery = siblingsQuery.eq("course_id", course_id);
        }

        const { data: siblings } = await siblingsQuery;
        const maxIndex = (siblings || []).reduce(
          (max: number, s: any) => Math.max(max, s.order_index || 0),
          -1
        );
        computedOrderIndex = maxIndex + 1;
      }

      // Prepare insert data - use template_id if it's a template, otherwise course_id
      const insertData: any = {
        path,
        name,
        order_index: computedOrderIndex,
      };

      if (access.isTemplate) {
        insertData.template_id = course_id; // course_id is actually template_id in this case
        insertData.course_id = null;
      } else {
        insertData.course_id = course_id;
        insertData.template_id = null;
      }

      // Create the folder
      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .insert(insertData)
        .select()
        .single();

      if (folderError) {
        // Handle unique constraint violation
        if (folderError.code === "23505") {
          res.status(409).json({
            error: {
              code: "FOLDER_ALREADY_EXISTS",
              message: "A folder with this path already exists in the course",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
        throw folderError;
      }

      res.status(201).json(folder);

      // Emit real-time update
      try { emitTreeUpdate(getIO(), course_id, "folder-created", { folderId: folder.id }); } catch {}
    } catch (error) {
      console.error("Error creating folder:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create folder",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /folder/:id
 * Update folder
 */
router.put(
  "/folder/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { name, order_index } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Get the existing folder
      const { data: existingFolder, error: existingError } = await supabase
        .from("folders")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (existingError || !existingFolder) {
        res.status(404).json({
          error: {
            code: "FOLDER_NOT_FOUND",
            message: "Folder not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get folder context (course or template)
      const context = getFolderContext(existingFolder);

      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(
        context.id,
        userId,
        isAdmin ?? false
      );

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to update this folder",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const permissions = access.permissions || { canRead: true, canWrite: true, canGrade: false, canManage: true };

      if (!permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to update this folder",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Prepare update data
      const updateData: any = {};
      const oldPath = existingFolder.path;
      let newPath = oldPath;

      if (name !== undefined) {
        updateData.name = name;
        // Update the last element of the path to match the new name
        newPath = [...existingFolder.path];
        if (newPath.length > 0) {
          newPath[newPath.length - 1] = name;
        }
        updateData.path = newPath;
      }
      if (order_index !== undefined) updateData.order_index = order_index;

      // Update the folder
      const { data: updatedFolder, error: updateError } = await supabase
        .from("folders")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      // Cascade path change to children if name changed
      if (name !== undefined && JSON.stringify(oldPath) !== JSON.stringify(newPath)) {
        await cascadeFolderPathChange(context.id, context.isTemplate, oldPath, newPath);
      }

      res.json(updatedFolder);

      // Emit real-time update
      try { emitTreeUpdate(getIO(), context.id, "folder-updated", { folderId: id }); } catch {}
    } catch (error) {
      console.error("Error updating folder:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update folder",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /folder/:id/contents-count
 * Get count of child assignments and subfolders (for delete confirmation modal)
 */
router.get(
  "/folder/:id/contents-count",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (folderError || !folder) {
        res.status(404).json({
          error: {
            code: "FOLDER_NOT_FOUND",
            message: "Folder not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const context = getFolderContext(folder);
      const access = await checkCourseOrTemplateAccess(context.id, userId, isAdmin ?? false);

      if (!access.permissions?.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to access this folder",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const folderPathPrefix = folder.path.join("/");

      // Count child folders
      let childFoldersQuery = supabase
        .from("folders")
        .select("id, path")
        .is("deleted_at", null);

      if (context.isTemplate) {
        childFoldersQuery = childFoldersQuery.eq("template_id", context.id);
      } else {
        childFoldersQuery = childFoldersQuery.eq("course_id", context.id);
      }

      const { data: allFolders } = await childFoldersQuery;
      const childFolders = (allFolders || []).filter(
        (f) =>
          f.id !== id &&
          f.path.length > folder.path.length &&
          f.path.slice(0, folder.path.length).join("/") === folderPathPrefix
      );

      // Count child assignments
      let childAssignmentsQuery = supabase
        .from("assignments")
        .select("id, module_path")
        .is("deleted_at", null);

      if (context.isTemplate) {
        childAssignmentsQuery = childAssignmentsQuery.eq("template_id", context.id);
      } else {
        childAssignmentsQuery = childAssignmentsQuery.eq("course_id", context.id);
      }

      const { data: allAssignments } = await childAssignmentsQuery;
      const childAssignments = (allAssignments || []).filter(
        (a) =>
          a.module_path.length >= folder.path.length &&
          a.module_path.slice(0, folder.path.length).join("/") === folderPathPrefix
      );

      res.json({
        folder_id: id,
        child_folders_count: childFolders.length,
        child_assignments_count: childAssignments.length,
      });
    } catch (error) {
      console.error("Error getting folder contents count:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to get folder contents count",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * DELETE /folder/:id
 * Soft-delete folder with cascade options
 * Body options:
 *   - { transferTo: folderId | null } — move children to that folder (null = root) before soft-deleting
 *   - { deleteChildren: true } — soft-delete ALL child folders and assignments
 *   - (default, no body) — soft-delete only the folder itself
 */
router.delete(
  "/folder/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { transferTo, deleteChildren } = req.body || {};
      const { id: userId, isAdmin } = req.user!;

      // Get the existing folder
      const { data: existingFolder, error: existingError } = await supabase
        .from("folders")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (existingError || !existingFolder) {
        res.status(404).json({
          error: {
            code: "FOLDER_NOT_FOUND",
            message: "Folder not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Use getFolderContext for proper template support (Bug 7 fix)
      const context = getFolderContext(existingFolder);

      const access = await checkCourseOrTemplateAccess(
        context.id,
        userId,
        isAdmin ?? false
      );

      if (!access.permissions?.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to delete this folder",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const folderPathPrefix = existingFolder.path.join("/");
      const now = new Date().toISOString();
      let affectedAssignments = 0;
      let affectedFolders = 0;

      if (transferTo !== undefined) {
        // Transfer children to another folder (or root if transferTo is null)
        let targetPath: string[] = [];
        if (transferTo !== null) {
          const { data: targetFolder } = await supabase
            .from("folders")
            .select("path")
            .eq("id", transferTo)
            .is("deleted_at", null)
            .single();
          if (targetFolder) {
            targetPath = targetFolder.path;
          }
        }

        // Move child folders: replace old parent path prefix with new target path
        let childFoldersQuery = supabase
          .from("folders")
          .select("*")
          .is("deleted_at", null);

        if (context.isTemplate) {
          childFoldersQuery = childFoldersQuery.eq("template_id", context.id);
        } else {
          childFoldersQuery = childFoldersQuery.eq("course_id", context.id);
        }

        const { data: allFolders } = await childFoldersQuery;
        const childFolders = (allFolders || []).filter(
          (f) =>
            f.id !== id &&
            f.path.length > existingFolder.path.length &&
            f.path.slice(0, existingFolder.path.length).join("/") === folderPathPrefix
        );

        for (const childFolder of childFolders) {
          const relativePath = childFolder.path.slice(existingFolder.path.length);
          const newChildPath = [...targetPath, ...relativePath];
          await supabase
            .from("folders")
            .update({
              path: newChildPath,
              name: newChildPath[newChildPath.length - 1] || childFolder.name,
            })
            .eq("id", childFolder.id);
          affectedFolders++;
        }

        // Move child assignments
        let childAssignmentsQuery = supabase
          .from("assignments")
          .select("*")
          .is("deleted_at", null);

        if (context.isTemplate) {
          childAssignmentsQuery = childAssignmentsQuery.eq("template_id", context.id);
        } else {
          childAssignmentsQuery = childAssignmentsQuery.eq("course_id", context.id);
        }

        const { data: allAssignments } = await childAssignmentsQuery;
        const childAssignments = (allAssignments || []).filter(
          (a) =>
            a.module_path.length >= existingFolder.path.length &&
            a.module_path.slice(0, existingFolder.path.length).join("/") === folderPathPrefix
        );

        for (const assignment of childAssignments) {
          const relativePath = assignment.module_path.slice(existingFolder.path.length);
          const newAssignmentPath = [...targetPath, ...relativePath];
          await supabase
            .from("assignments")
            .update({ module_path: newAssignmentPath })
            .eq("id", assignment.id);
          affectedAssignments++;
        }
      } else if (deleteChildren) {
        // Soft-delete all children
        let childFoldersQuery = supabase
          .from("folders")
          .select("id, path")
          .is("deleted_at", null);

        if (context.isTemplate) {
          childFoldersQuery = childFoldersQuery.eq("template_id", context.id);
        } else {
          childFoldersQuery = childFoldersQuery.eq("course_id", context.id);
        }

        const { data: allFolders } = await childFoldersQuery;
        const childFolderIds = (allFolders || [])
          .filter(
            (f) =>
              f.id !== id &&
              f.path.length > existingFolder.path.length &&
              f.path.slice(0, existingFolder.path.length).join("/") === folderPathPrefix
          )
          .map((f) => f.id);

        if (childFolderIds.length > 0) {
          await supabase
            .from("folders")
            .update({ deleted_at: now })
            .in("id", childFolderIds);
          affectedFolders = childFolderIds.length;
        }

        // Soft-delete child assignments
        let childAssignmentsQuery = supabase
          .from("assignments")
          .select("id, module_path")
          .is("deleted_at", null);

        if (context.isTemplate) {
          childAssignmentsQuery = childAssignmentsQuery.eq("template_id", context.id);
        } else {
          childAssignmentsQuery = childAssignmentsQuery.eq("course_id", context.id);
        }

        const { data: allAssignments } = await childAssignmentsQuery;
        const childAssignmentIds = (allAssignments || [])
          .filter(
            (a) =>
              a.module_path.length >= existingFolder.path.length &&
              a.module_path.slice(0, existingFolder.path.length).join("/") === folderPathPrefix
          )
          .map((a) => a.id);

        if (childAssignmentIds.length > 0) {
          await supabase
            .from("assignments")
            .update({ deleted_at: now })
            .in("id", childAssignmentIds);
          affectedAssignments = childAssignmentIds.length;
        }
      }

      // Soft-delete the folder itself
      const { error: deleteError } = await supabase
        .from("folders")
        .update({ deleted_at: now })
        .eq("id", id);

      if (deleteError) {
        throw deleteError;
      }

      res.json({
        message: "Folder deleted successfully",
        folder_id: id,
        affected_folders: affectedFolders,
        affected_assignments: affectedAssignments,
      });

      // Emit real-time update
      try { emitTreeUpdate(getIO(), context.id, "folder-deleted", { folderId: id }); } catch {}
    } catch (error) {
      console.error("Error deleting folder:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete folder",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /folder/:id/move
 * Move folder to new path (updates folder and all nested items)
 */
router.put(
  "/folder/:id/move",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { newPath } = req.body; // Array of path segments
      const { id: userId, isAdmin } = req.user!;

      // Get the existing folder
      const { data: existingFolder, error: existingError } = await supabase
        .from("folders")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (existingError || !existingFolder) {
        res.status(404).json({
          error: {
            code: "FOLDER_NOT_FOUND",
            message: "Folder not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get folder context (course or template)
      const context = getFolderContext(existingFolder);

      // Check permissions
      const access = await checkCourseOrTemplateAccess(
        context.id,
        userId,
        isAdmin ?? false
      );

      if (!access.permissions?.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to move this folder",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate newPath
      if (!Array.isArray(newPath)) {
        res.status(400).json({
          error: {
            code: "INVALID_PATH_FORMAT",
            message: "New path must be an array of strings",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const oldPath = existingFolder.path;

      // Update the folder's path
      const { error: updateFolderError } = await supabase
        .from("folders")
        .update({
          path: newPath,
          name: newPath[newPath.length - 1] || existingFolder.name,
        })
        .eq("id", id);

      if (updateFolderError) {
        throw updateFolderError;
      }

      // Cascade path change to all nested folders and assignments
      await cascadeFolderPathChange(context.id, context.isTemplate, oldPath, newPath);

      res.json({
        message: "Folder moved successfully",
        folder_id: id,
        old_path: oldPath,
        new_path: newPath,
      });

      // Emit real-time update
      try { emitTreeUpdate(getIO(), context.id, "folder-moved", { folderId: id }); } catch {}
    } catch (error) {
      console.error("Error moving folder:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to move folder",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /course/:courseId/reorder
 * Bulk reorder folders and assignments
 */
router.put(
  "/course/:courseId/reorder",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId } = req.params;
      const { items } = req.body; // Array of { id, type: 'folder' | 'assignment', order_index }
      const { id: userId, isAdmin } = req.user!;

      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(
        courseId,
        userId,
        isAdmin ?? false
      );

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to reorder items",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const permissions = access.permissions || { canRead: true, canWrite: true, canGrade: false, canManage: true };

      if (!permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to reorder items in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate items array
      if (!Array.isArray(items)) {
        res.status(400).json({
          error: {
            code: "INVALID_ITEMS_FORMAT",
            message: "Items must be an array",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Update folders
      const folderUpdates = items
        .filter((item) => item.type === "folder")
        .map((item) => {
          let query = supabase
            .from("folders")
            .update({ order_index: item.order_index })
            .eq("id", item.id);
          
          if (access.isTemplate) {
            query = query.eq("template_id", courseId);
          } else {
            query = query.eq("course_id", courseId);
          }
          
          return query;
        });

      // Update assignments
      const assignmentUpdates = items
        .filter((item) => item.type === "assignment")
        .map((item) => {
          let query = supabase
            .from("assignments")
            .update({ order_index: item.order_index })
            .eq("id", item.id);
          
          if (access.isTemplate) {
            query = query.eq("template_id", courseId);
          } else {
            query = query.eq("course_id", courseId);
          }
          
          return query;
        });

      // Execute all updates
      await Promise.all([...folderUpdates, ...assignmentUpdates]);

      res.json({
        message: "Items reordered successfully",
        updated_count: items.length,
      });

      // Emit real-time update
      try { emitTreeUpdate(getIO(), courseId, "items-reordered"); } catch {}
    } catch (error) {
      console.error("Error reordering items:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to reorder items",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
