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

const router = Router();

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

      // Prepare insert data - use template_id if it's a template, otherwise course_id
      const insertData: any = {
        path,
        name,
        order_index: order_index || 0,
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
      if (name !== undefined) {
        updateData.name = name;
        // Update the last element of the path to match the new name
        const newPath = [...existingFolder.path];
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

      res.json(updatedFolder);
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
 * DELETE /folder/:id
 * Delete folder
 */
router.delete(
  "/folder/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the existing folder
      const { data: existingFolder, error: existingError } = await supabase
        .from("folders")
        .select("*")
        .eq("id", id)
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

      // Check permissions for the course
      const permissions = await getCoursePermissions(
        userId,
        existingFolder.course_id,
        isAdmin
      );

      if (!permissions.canManage) {
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

      // Delete the folder
      const { error: deleteError } = await supabase
        .from("folders")
        .delete()
        .eq("id", id);

      if (deleteError) {
        throw deleteError;
      }

      res.json({
        message: "Folder deleted successfully",
        folder_id: id,
      });
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
      const oldPathPrefix = oldPath.join("/");
      const newPathPrefix = newPath.join("/");

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

      // Find and update all nested folders
      let nestedFoldersQuery = supabase
        .from("folders")
        .select("*");
      
      if (context.isTemplate) {
        nestedFoldersQuery = nestedFoldersQuery.eq("template_id", context.id);
      } else {
        nestedFoldersQuery = nestedFoldersQuery.eq("course_id", context.id);
      }
      
      const { data: nestedFolders, error: nestedFoldersError } = await nestedFoldersQuery;

      if (nestedFoldersError) {
        throw nestedFoldersError;
      }

      // Update nested folders that start with the old path
      const foldersToUpdate =
        nestedFolders?.filter(
          (f) =>
            f.id !== id &&
            f.path.length > oldPath.length &&
            f.path.slice(0, oldPath.length).join("/") === oldPathPrefix
        ) || [];

      for (const nestedFolder of foldersToUpdate) {
        const relativePath = nestedFolder.path.slice(oldPath.length);
        const newNestedPath = [...newPath, ...relativePath];

        await supabase
          .from("folders")
          .update({
            path: newNestedPath,
            name: newNestedPath[newNestedPath.length - 1] || nestedFolder.name,
          })
          .eq("id", nestedFolder.id);
      }

      // Find and update all nested assignments
      let nestedAssignmentsQuery = supabase
        .from("assignments")
        .select("*");
      
      if (context.isTemplate) {
        nestedAssignmentsQuery = nestedAssignmentsQuery.eq("template_id", context.id);
      } else {
        nestedAssignmentsQuery = nestedAssignmentsQuery.eq("course_id", context.id);
      }
      
      const { data: nestedAssignments, error: nestedAssignmentsError } = await nestedAssignmentsQuery;

      if (nestedAssignmentsError) {
        throw nestedAssignmentsError;
      }

      // Update assignments that are in the moved folder or its subfolders
      const assignmentsToUpdate =
        nestedAssignments?.filter(
          (a) =>
            a.module_path.length >= oldPath.length &&
            a.module_path.slice(0, oldPath.length).join("/") === oldPathPrefix
        ) || [];

      for (const assignment of assignmentsToUpdate) {
        const relativePath = assignment.module_path.slice(oldPath.length);
        const newAssignmentPath = [...newPath, ...relativePath];

        await supabase
          .from("assignments")
          .update({ module_path: newAssignmentPath })
          .eq("id", assignment.id);
      }

      res.json({
        message: "Folder moved successfully",
        folder_id: id,
        old_path: oldPath,
        new_path: newPath,
        updated_folders: foldersToUpdate.length,
        updated_assignments: assignmentsToUpdate.length,
      });
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
