import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import {
  requireCoursePermission,
  getCoursePermissions,
  isOrganizationMember,
} from "../middleware/authorization";
import { Section } from "../types/entities";

/**
 * Generate a unique 4-character alphanumeric section code
 * @param courseId - The course ID to check uniqueness within
 * @returns Promise<string> - A unique section code
 */
async function generateUniqueSectionCode(courseId: string): Promise<string> {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    let sectionCode = "";
    for (let i = 0; i < 4; i++) {
      sectionCode += characters.charAt(
        Math.floor(Math.random() * characters.length)
      );
    }

    // Check if this section code already exists in this course
    const { data: existingSection } = await supabase
      .from("sections")
      .select("id")
      .eq("course_id", courseId)
      .eq("slug", sectionCode)
      .single();

    if (!existingSection) {
      return sectionCode;
    }

    attempts++;
  }

  throw new Error(
    "Unable to generate unique section code after maximum attempts"
  );
}

const router = Router();

/**
 * GET /sections/by-course/:courseId
 * Get all sections for a specific course
 */
router.get(
  "/sections/by-course/:courseId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Check if this is a template
      const { data: template, error: templateError } = await supabase
        .from("course_templates")
        .select("organization_id")
        .eq("id", courseId)
        .is("deleted_at", null)
        .single();

      const isTemplate = !templateError && template !== null;

      if (isTemplate) {
        // For templates, check organization membership
        const isMember = await isOrganizationMember(userId, template.organization_id);
        if (!isMember) {
          res.status(403).json({
            error: {
              code: "INSUFFICIENT_PERMISSIONS",
              message: "Not authorized to access sections for this template",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      } else {
        // For regular courses, check course permissions
        const permissions = await getCoursePermissions(userId, courseId, isAdmin);
        if (!permissions.canRead) {
          res.status(403).json({
            error: {
              code: "INSUFFICIENT_PERMISSIONS",
              message: "Not authorized to access sections for this course",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Get all sections for the course
      const { data: sections, error: sectionsError } = await supabase
        .from("sections")
        .select("*")
        .eq("course_id", courseId)
        .order("name", { ascending: true });

      if (sectionsError) {
        throw sectionsError;
      }

      res.json({ data: sections || [] });
    } catch (error) {
      console.error("Error retrieving sections by course:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve sections",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /section/by-slug/:slug
 * Get section by composite slug (course-slug-section-slug)
 */
router.get(
  "/section/by-slug/:slug",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { slug } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Parse composite slug to extract course slug and section slug
      const slugParts = slug.split("-");
      if (slugParts.length < 2) {
        res.status(400).json({
          error: {
            code: "INVALID_SLUG_FORMAT",
            message: "Section slug must be in format: course-slug-section-slug",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Find the course first to determine where to split the slug
      // We need to find a course whose slug is a prefix of the provided slug
      const { data: courses, error: coursesError } = await supabase
        .from("courses")
        .select("id, slug")
        .is("deleted_at", null);

      if (coursesError) {
        throw coursesError;
      }

      let courseSlug = "";
      let sectionSlug = "";
      let courseId = "";

      // Find matching course slug
      for (const course of courses || []) {
        if (slug.startsWith(course.slug + "-")) {
          courseSlug = course.slug;
          sectionSlug = slug.substring(course.slug.length + 1);
          courseId = course.id;
          break;
        }
      }

      if (!courseSlug || !sectionSlug) {
        res.status(404).json({
          error: {
            code: "SECTION_NOT_FOUND",
            message: "Section not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check course permissions
      const permissions = await getCoursePermissions(userId, courseId, isAdmin);
      if (!permissions.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to access this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the section
      const { data: section, error: sectionError } = await supabase
        .from("sections")
        .select("*")
        .eq("course_id", courseId)
        .eq("slug", sectionSlug)
        .single();

      if (sectionError || !section) {
        res.status(404).json({
          error: {
            code: "SECTION_NOT_FOUND",
            message: "Section not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json({ data: section });
    } catch (error) {
      console.error("Error retrieving section by slug:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve section",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /section/:id
 * Get section by ID
 */
router.get(
  "/section/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the section
      const { data: section, error: sectionError } = await supabase
        .from("sections")
        .select("*")
        .eq("id", id)
        .single();

      if (sectionError || !section) {
        res.status(404).json({
          error: {
            code: "SECTION_NOT_FOUND",
            message: "Section not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check course permissions
      const permissions = await getCoursePermissions(
        userId,
        section.course_id,
        isAdmin
      );
      if (!permissions.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to access this section",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json({ data: section });
    } catch (error) {
      console.error("Error retrieving section by ID:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve section",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /sections
 * Create new section (requires course management permissions)
 */
router.post(
  "/sections",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { course_id, name, description } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Validate required fields
      if (!course_id || !name) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "course_id and name are required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check course permissions
      const permissions = await getCoursePermissions(
        userId,
        course_id,
        isAdmin
      );
      if (!permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to manage sections in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Generate a unique section code
      const sectionCode = await generateUniqueSectionCode(course_id);

      // Verify course exists and is not deleted
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("id")
        .eq("id", course_id)
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

      // Create the section
      const { data: section, error: sectionError } = await supabase
        .from("sections")
        .insert({
          course_id,
          name,
          description: description || null,
          slug: sectionCode,
        })
        .select()
        .single();

      if (sectionError) {
        throw sectionError;
      }

      res.status(201).json({ data: section });
    } catch (error) {
      console.error("Error creating section:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create section",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /section/:id
 * Update section (requires course management permissions)
 */
router.put(
  "/section/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { name, description, slug } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Get existing section
      const { data: existingSection, error: existingError } = await supabase
        .from("sections")
        .select("*")
        .eq("id", id)
        .single();

      if (existingError || !existingSection) {
        res.status(404).json({
          error: {
            code: "SECTION_NOT_FOUND",
            message: "Section not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check course permissions
      const permissions = await getCoursePermissions(
        userId,
        existingSection.course_id,
        isAdmin
      );
      if (!permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to manage sections in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate slug format if being changed
      if (slug && slug !== existingSection.slug && slug.includes("-")) {
        res.status(400).json({
          error: {
            code: "INVALID_SLUG_FORMAT",
            message: "Section slug cannot contain hyphens",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if new slug already exists in this course
      if (slug && slug !== existingSection.slug) {
        const { data: slugExists } = await supabase
          .from("sections")
          .select("id")
          .eq("course_id", existingSection.course_id)
          .eq("slug", slug)
          .neq("id", id)
          .single();

        if (slugExists) {
          res.status(409).json({
            error: {
              code: "SLUG_ALREADY_EXISTS",
              message: "A section with this slug already exists in this course",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Prepare update data
      const updateData: Partial<Section> = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (slug !== undefined) updateData.slug = slug;

      // Update the section
      const { data: updatedSection, error: updateError } = await supabase
        .from("sections")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json({ data: updatedSection });
    } catch (error) {
      console.error("Error updating section:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update section",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * DELETE /section/:id
 * Delete section (requires course management permissions)
 */
router.delete(
  "/section/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get existing section
      const { data: existingSection, error: existingError } = await supabase
        .from("sections")
        .select("*")
        .eq("id", id)
        .single();

      if (existingError || !existingSection) {
        res.status(404).json({
          error: {
            code: "SECTION_NOT_FOUND",
            message: "Section not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check course permissions
      const permissions = await getCoursePermissions(
        userId,
        existingSection.course_id,
        isAdmin
      );
      if (!permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to manage sections in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Delete the section
      const { error: deleteError } = await supabase
        .from("sections")
        .delete()
        .eq("id", id);

      if (deleteError) {
        throw deleteError;
      }

      res.json({
        message: "Section deleted successfully",
        section: existingSection,
      });
    } catch (error) {
      console.error("Error deleting section:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete section",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /sections/course/:courseSlug
 * Get all sections for a specific course by course slug
 */
router.get(
  "/sections/course/:courseSlug",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseSlug } = req.params;
      const { id: userId } = req.user!;

      // First get the course by slug
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("id")
        .eq("slug", courseSlug)
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

      // Check if user has access to this course
      const { data: enrollment } = await supabase
        .from("course_enrollments")
        .select("role")
        .eq("course_id", course.id)
        .eq("user_id", userId)
        .single();

      if (!enrollment) {
        res.status(403).json({
          error: {
            code: "ACCESS_DENIED",
            message: "You do not have access to this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get all sections for the course
      const { data: sections, error: sectionsError } = await supabase
        .from("sections")
        .select("*")
        .eq("course_id", course.id)
        .order("created_at", { ascending: true });

      if (sectionsError) {
        throw sectionsError;
      }

      res.json({ data: sections || [] });
    } catch (error) {
      console.error("Error retrieving sections by course slug:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve sections",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
