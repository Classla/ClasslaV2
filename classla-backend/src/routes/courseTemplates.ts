import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import {
  requireOrganizationMembership,
  requireOrganizationPermission,
  canDeleteTemplate,
  isOrganizationAdmin,
} from "../middleware/authorization";
import { CourseTemplate, Course, Section, Assignment, Folder } from "../types/entities";

const router = Router();

/**
 * Clone assignments and folders from source to destination
 * @param sourceId - ID of source (template or course)
 * @param destinationId - ID of destination (course or template)
 * @param isSourceTemplate - Whether source is a template
 * @param isDestinationTemplate - Whether destination is a template
 */
async function cloneAssignmentsAndFolders(
  sourceId: string,
  destinationId: string,
  isSourceTemplate: boolean,
  isDestinationTemplate: boolean
): Promise<void> {
  // Clone folders first (they may contain assignments)
  const folderSourceField = isSourceTemplate ? "template_id" : "course_id";
  const { data: sourceFolders, error: foldersError } = await supabase
    .from("folders")
    .select("*")
    .eq(folderSourceField, sourceId)
    .order("order_index", { ascending: true });

  if (foldersError) {
    throw new Error(`Failed to fetch folders: ${foldersError.message}`);
  }

  // Create folder mapping for path updates
  const folderMapping = new Map<string, string>();

  if (sourceFolders && sourceFolders.length > 0) {
    for (const folder of sourceFolders) {
      const { data: newFolder, error: createFolderError } = await supabase
        .from("folders")
        .insert({
          [isDestinationTemplate ? "template_id" : "course_id"]: destinationId,
          path: folder.path,
          name: folder.name,
          order_index: folder.order_index,
        })
        .select()
        .single();

      if (createFolderError || !newFolder) {
        throw new Error(`Failed to create folder: ${createFolderError?.message}`);
      }

      folderMapping.set(folder.id, newFolder.id);
    }
  }

  // Clone assignments
  const assignmentSourceField = isSourceTemplate ? "template_id" : "course_id";
  const { data: sourceAssignments, error: assignmentsError } = await supabase
    .from("assignments")
    .select("*")
    .eq(assignmentSourceField, sourceId)
    .order("order_index", { ascending: true });

  if (assignmentsError) {
    throw new Error(`Failed to fetch assignments: ${assignmentsError.message}`);
  }

  if (sourceAssignments && sourceAssignments.length > 0) {
    for (const assignment of sourceAssignments) {
      const { error: createAssignmentError } = await supabase
        .from("assignments")
        .insert({
          [isDestinationTemplate ? "template_id" : "course_id"]: destinationId,
          name: assignment.name,
          settings: assignment.settings || {},
          content: assignment.content || "",
          publish_times: {}, // Don't copy publish_times (no students in new course/template)
          due_dates_map: {}, // Don't copy due dates
          module_path: assignment.module_path || [],
          is_lockdown: assignment.is_lockdown || false,
          lockdown_time_map: {}, // Don't copy lockdown times
          order_index: assignment.order_index || 0,
        });

      if (createAssignmentError) {
        throw new Error(`Failed to create assignment: ${createAssignmentError.message}`);
      }
    }
  }
}

/**
 * Generate a unique 6-character alphanumeric join code for courses
 */
async function generateUniqueJoinCode(): Promise<string> {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    let joinCode = "";
    for (let i = 0; i < 6; i++) {
      joinCode += characters.charAt(
        Math.floor(Math.random() * characters.length)
      );
    }

    // Check if this join code already exists
    const { data: existingCourse } = await supabase
      .from("courses")
      .select("id")
      .eq("slug", joinCode)
      .is("deleted_at", null)
      .single();

    if (!existingCourse) {
      return joinCode;
    }

    attempts++;
  }

  throw new Error("Unable to generate unique join code after maximum attempts");
}

/**
 * POST /organization/:organizationId/templates
 * Create template (member or admin)
 */
router.post(
  "/organization/:organizationId/templates",
  authenticateToken,
  requireOrganizationPermission("canCreateTemplates", "organizationId"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { organizationId } = req.params;
      const { name, settings, thumbnail_url, summary_content, slug } = req.body;
      const { id: userId } = req.user!;

      if (!name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({
          error: {
            code: "INVALID_NAME",
            message: "Template name is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Create template
      const { data: template, error: templateError } = await supabase
        .from("course_templates")
        .insert({
          name: name.trim(),
          organization_id: organizationId,
          created_by_id: userId,
          settings: settings || {},
          thumbnail_url: thumbnail_url || null,
          summary_content: summary_content || null,
          slug: slug || null,
        })
        .select()
        .single();

      if (templateError || !template) {
        console.error("Error creating template:", templateError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create template",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.status(201).json(template);
    } catch (error) {
      console.error("Error creating template:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create template",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /organization/:organizationId/templates
 * List templates in organization (member or admin)
 */
router.get(
  "/organization/:organizationId/templates",
  authenticateToken,
  requireOrganizationMembership("organizationId"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { organizationId } = req.params;

      const { data: templates, error } = await supabase
        .from("course_templates")
        .select("*")
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching templates:", error);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to fetch templates",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json(templates || []);
    } catch (error) {
      console.error("Error fetching templates:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch templates",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /template/:id
 * Get template by ID (member or admin of org)
 */
router.get(
  "/template/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId } = req.user!;

      // Get template
      const { data: template, error: templateError } = await supabase
        .from("course_templates")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (templateError || !template) {
        res.status(404).json({
          error: {
            code: "TEMPLATE_NOT_FOUND",
            message: "Template not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user is a member of the organization
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("role")
        .eq("user_id", userId)
        .eq("organization_id", template.organization_id)
        .single();

      if (!membership) {
        res.status(403).json({
          error: {
            code: "NOT_ORGANIZATION_MEMBER",
            message: "Not authorized to access this template",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Return template formatted as a course-like object for frontend compatibility
      // The frontend expects course format, so we'll convert template to course format
      const templateAsCourse = {
        id: template.id,
        name: template.name,
        description: undefined,
        settings: template.settings || {},
        thumbnail_url: template.thumbnail_url || null,
        summary_content: template.summary_content || null,
        slug: template.slug || template.id, // Use slug if available, otherwise use id
        created_by_id: template.created_by_id,
        created_at: template.created_at,
        deleted_at: template.deleted_at,
        is_template: true,
        student_count: 0, // Templates have no students
      };

      res.json(templateAsCourse);
    } catch (error) {
      console.error("Error retrieving template:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve template",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /template/:id
 * Update template (creator if member, or admin)
 */
router.put(
  "/template/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { name, settings, thumbnail_url, summary_content, slug } = req.body;
      const { id: userId } = req.user!;

      // Get template
      const { data: existingTemplate, error: templateError } = await supabase
        .from("course_templates")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (templateError || !existingTemplate) {
        res.status(404).json({
          error: {
            code: "TEMPLATE_NOT_FOUND",
            message: "Template not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check permissions: creator (if member) or admin
      const isAdmin = await isOrganizationAdmin(
        userId,
        existingTemplate.organization_id
      );
      const isCreator = existingTemplate.created_by_id === userId;

      if (!isAdmin && !isCreator) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to update this template",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Prepare update data
      const updateData: Partial<CourseTemplate> = {};
      if (name !== undefined) {
        if (typeof name !== "string" || name.trim().length === 0) {
          res.status(400).json({
            error: {
              code: "INVALID_NAME",
              message: "Template name must be a non-empty string",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
        updateData.name = name.trim();
      }
      if (settings !== undefined) updateData.settings = settings;
      if (thumbnail_url !== undefined) updateData.thumbnail_url = thumbnail_url;
      if (summary_content !== undefined)
        updateData.summary_content = summary_content;
      if (slug !== undefined) updateData.slug = slug;

      if (Object.keys(updateData).length === 0) {
        res.status(400).json({
          error: {
            code: "NO_UPDATES",
            message: "No valid fields to update",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Update template
      const { data: updatedTemplate, error: updateError } = await supabase
        .from("course_templates")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (updateError || !updatedTemplate) {
        console.error("Error updating template:", updateError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to update template",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json(updatedTemplate);
    } catch (error) {
      console.error("Error updating template:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update template",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * DELETE /template/:id
 * Delete template (creator if member, or admin)
 */
router.delete(
  "/template/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId } = req.user!;

      // Check if user can delete this template
      const canDelete = await canDeleteTemplate(userId, id);
      if (!canDelete) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to delete this template",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Soft delete template
      const { error: deleteError } = await supabase
        .from("course_templates")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);

      if (deleteError) {
        console.error("Error deleting template:", deleteError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to delete template",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting template:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete template",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /template/:id/clone
 * Clone template into new course (member or admin)
 */
router.post(
  "/template/:id/clone",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId } = req.user!;

      // Get template
      const { data: template, error: templateError } = await supabase
        .from("course_templates")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (templateError || !template) {
        res.status(404).json({
          error: {
            code: "TEMPLATE_NOT_FOUND",
            message: "Template not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user is a member of the organization
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("role")
        .eq("user_id", userId)
        .eq("organization_id", template.organization_id)
        .single();

      if (!membership) {
        res.status(403).json({
          error: {
            code: "NOT_ORGANIZATION_MEMBER",
            message: "Not authorized to clone this template",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Generate unique join code for new course
      const slug = await generateUniqueJoinCode();

      // Create new course from template
      const { data: newCourse, error: courseError } = await supabase
        .from("courses")
        .insert({
          name: template.name,
          settings: template.settings || {},
          thumbnail_url: template.thumbnail_url || null,
          summary_content: template.summary_content || null,
          slug: slug,
          created_by_id: userId,
        })
        .select()
        .single();

      if (courseError || !newCourse) {
        console.error("Error creating course from template:", courseError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create course from template",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Clone assignments and folders from template to course
      try {
        await cloneAssignmentsAndFolders(
          template.id,
          newCourse.id,
          true, // source is template
          false // destination is course
        );
      } catch (cloneError: any) {
        console.error("Error cloning assignments and folders:", cloneError);
        // Try to clean up course
        await supabase.from("courses").delete().eq("id", newCourse.id);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to clone template content: ${cloneError.message}`,
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Enroll creator as instructor
      const { error: enrollmentError } = await supabase
        .from("course_enrollments")
        .insert({
          user_id: userId,
          course_id: newCourse.id,
          role: "instructor",
        });

      if (enrollmentError) {
        console.error("Error enrolling creator:", enrollmentError);
        // Try to clean up course
        await supabase.from("courses").delete().eq("id", newCourse.id);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to enroll creator in course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.status(201).json(newCourse);
    } catch (error) {
      console.error("Error cloning template:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to clone template",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /export-to-template/:courseId
 * Export course to template (instructor only)
 */
router.post(
  "/export-to-template/:courseId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId } = req.params;
      const { id: userId } = req.user!;
      const { organizationId, name } = req.body;

      if (!organizationId || !name || typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "organizationId and name are required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get course
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("*")
        .eq("id", courseId)
        .is("deleted_at", null)
        .single();

      if (courseError || !course) {
        res.status(404).json({
          error: {
            code: "COURSE_NOT_FOUND",
            message: "Course not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user is instructor of the course
      const { data: enrollment } = await supabase
        .from("course_enrollments")
        .select("role")
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .single();

      if (!enrollment || enrollment.role !== "instructor") {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Only instructors can export courses to templates",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user is a member of the organization
      const { data: membership } = await supabase
        .from("organization_memberships")
        .select("role")
        .eq("user_id", userId)
        .eq("organization_id", organizationId)
        .single();

      if (!membership) {
        res.status(403).json({
          error: {
            code: "NOT_ORGANIZATION_MEMBER",
            message: "You must be a member of the organization to export to it",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Create template from course
      const { data: template, error: templateError } = await supabase
        .from("course_templates")
        .insert({
          name: name.trim(),
          organization_id: organizationId,
          created_by_id: userId,
          settings: course.settings || {},
          thumbnail_url: course.thumbnail_url || null,
          summary_content: course.summary_content || null,
          slug: null, // Templates don't need slugs
        })
        .select()
        .single();

      if (templateError || !template) {
        console.error("Error creating template from course:", templateError);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to create template",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Clone assignments and folders from course to template
      try {
        await cloneAssignmentsAndFolders(
          course.id,
          template.id,
          false, // source is course
          true // destination is template
        );
      } catch (cloneError: any) {
        console.error("Error cloning assignments and folders:", cloneError);
        // Try to clean up template
        await supabase.from("course_templates").delete().eq("id", template.id);
        res.status(500).json({
          error: {
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to clone course content: ${cloneError.message}`,
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.status(201).json(template);
    } catch (error) {
      console.error("Error exporting course to template:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to export course to template",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
