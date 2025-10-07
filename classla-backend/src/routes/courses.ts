import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import {
  requireCoursePermission,
  getCoursePermissions,
} from "../middleware/authorization";
import { UserRole } from "../types/enums";
import { Course } from "../types/entities";
import { GradebookData, StudentGradesData } from "../types/api";

/**
 * Generate a unique 6-character alphanumeric join code
 * @returns Promise<string> - A unique join code
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

const router = Router();

/**
 * GET /course/by-slug/:slug
 * Retrieve course by slug with role-based access control
 */
router.get(
  "/course/by-slug/:slug",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { slug } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // First get the course (case-insensitive)
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("*")
        .eq("slug", slug.toUpperCase())
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

      // Check permissions
      const permissions = await getCoursePermissions(
        userId,
        course.id,
        isAdmin
      );

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

      res.json(course);
    } catch (error) {
      console.error("Error retrieving course by slug:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve course",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /course/:id
 * Retrieve course by ID with role-based access control
 */
router.get(
  "/course/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the course
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("*")
        .eq("id", id)
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

      // Check permissions
      const permissions = await getCoursePermissions(
        userId,
        course.id,
        isAdmin
      );

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

      res.json(course);
    } catch (error) {
      console.error("Error retrieving course by ID:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve course",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /courses?ids=1,2,3
 * Batch retrieve courses by IDs
 */
router.get(
  "/courses",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { ids, slugs } = req.query;
      const { id: userId, isAdmin } = req.user!;

      let query = supabase.from("courses").select("*").is("deleted_at", null);

      // Handle batch retrieval by IDs
      if (ids && typeof ids === "string") {
        const courseIds = ids
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id);
        if (courseIds.length === 0) {
          res.status(400).json({
            error: {
              code: "INVALID_IDS",
              message: "Invalid course IDs provided",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
        query = query.in("id", courseIds);
      }
      // Handle batch retrieval by slugs
      else if (slugs && typeof slugs === "string") {
        const courseSlugs = slugs
          .split(",")
          .map((slug) => slug.trim())
          .filter((slug) => slug);
        if (courseSlugs.length === 0) {
          res.status(400).json({
            error: {
              code: "INVALID_SLUGS",
              message: "Invalid course slugs provided",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
        query = query.in("slug", courseSlugs);
      } else {
        res.status(400).json({
          error: {
            code: "MISSING_PARAMETERS",
            message: "Either ids or slugs parameter is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const { data: courses, error: coursesError } = await query;

      if (coursesError) {
        throw coursesError;
      }

      // Filter courses based on user permissions
      const accessibleCourses: Course[] = [];

      for (const course of courses || []) {
        const permissions = await getCoursePermissions(
          userId,
          course.id,
          isAdmin
        );
        if (permissions.canRead) {
          accessibleCourses.push(course);
        }
      }

      res.json(accessibleCourses);
    } catch (error) {
      console.error("Error retrieving courses:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve courses",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /course
 * Create new course (any authenticated user can create a course and becomes instructor)
 */
router.post(
  "/course",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { name, description, settings, thumbnail_url, summary_content } =
        req.body;
      const { id: userId } = req.user!;

      // Validate required fields
      if (!name) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "Course name is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Generate a unique join code
      const joinCode = await generateUniqueJoinCode();

      // Create the course
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .insert({
          name,
          description: description || null,
          settings: settings || {},
          thumbnail_url: thumbnail_url || null,
          summary_content: summary_content || "",
          slug: joinCode,
          created_by_id: userId,
        })
        .select()
        .single();

      if (courseError) {
        throw courseError;
      }

      // Enroll the creator as an instructor
      const { error: enrollmentError } = await supabase
        .from("course_enrollments")
        .insert({
          user_id: userId,
          course_id: course.id,
          role: UserRole.INSTRUCTOR,
        });

      if (enrollmentError) {
        console.error("Error enrolling course creator:", enrollmentError);
        // Don't fail the request, but log the error
      }

      res.status(201).json(course);
    } catch (error) {
      console.error("Error creating course:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create course",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /course/:id
 * Update course (instructor/admin only with proper permissions)
 */
router.put(
  "/course/:id",
  authenticateToken,
  requireCoursePermission("canManage", "id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { name, description, settings, thumbnail_url, summary_content } =
        req.body;

      // Check if course exists and is not deleted
      const { data: existingCourse, error: existingError } = await supabase
        .from("courses")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (existingError || !existingCourse) {
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

      // Prepare update data
      const updateData: Partial<Course> = {};

      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (settings !== undefined) updateData.settings = settings;
      if (thumbnail_url !== undefined) updateData.thumbnail_url = thumbnail_url;
      if (summary_content !== undefined)
        updateData.summary_content = summary_content;

      // Update the course
      const { data: updatedCourse, error: updateError } = await supabase
        .from("courses")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json(updatedCourse);
    } catch (error) {
      console.error("Error updating course:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update course",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * DELETE /course/:id
 * Soft delete course (instructor/admin only with proper permissions)
 */
router.delete(
  "/course/:id",
  authenticateToken,
  requireCoursePermission("canManage", "id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      // Check if course exists and is not already deleted
      const { data: existingCourse, error: existingError } = await supabase
        .from("courses")
        .select("*")
        .eq("id", id)
        .is("deleted_at", null)
        .single();

      if (existingError || !existingCourse) {
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

      // Delete all course enrollments first
      const { error: enrollmentDeleteError } = await supabase
        .from("course_enrollments")
        .delete()
        .eq("course_id", id);

      if (enrollmentDeleteError) {
        console.error(
          "Error deleting course enrollments:",
          enrollmentDeleteError
        );
        // Continue with course deletion even if enrollment deletion fails
        // This ensures the course is still deleted
      }

      // Soft delete the course
      const { data: deletedCourse, error: deleteError } = await supabase
        .from("courses")
        .update({
          deleted_at: new Date().toISOString(),
        })
        .eq("id", id)
        .select()
        .single();

      if (deleteError) {
        throw deleteError;
      }

      res.json({
        message: "Course deleted successfully",
        course: deletedCourse,
      });
    } catch (error) {
      console.error("Error deleting course:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete course",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /course/join
 * Join course by slug (student enrollment)
 */
router.post(
  "/course/join",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { slug } = req.body;
      const { id: userId } = req.user!;

      if (!slug) {
        res.status(400).json({
          error: {
            code: "MISSING_SLUG",
            message: "Course join code is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate join code format (6 alphanumeric characters)
      const joinCodeRegex = /^[A-Z0-9]{6}$/;
      if (!joinCodeRegex.test(slug.toUpperCase())) {
        res.status(400).json({
          error: {
            code: "INVALID_JOIN_CODE",
            message: "Join code must be 6 alphanumeric characters",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Find the course by slug (case-insensitive)
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("*")
        .eq("slug", slug.toUpperCase())
        .is("deleted_at", null)
        .single();

      if (courseError || !course) {
        res.status(404).json({
          error: {
            code: "COURSE_NOT_FOUND",
            message: "Course not found with that join code",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user is already enrolled
      const { data: existingEnrollment } = await supabase
        .from("course_enrollments")
        .select("id, role")
        .eq("user_id", userId)
        .eq("course_id", course.id)
        .single();

      if (existingEnrollment) {
        res.status(409).json({
          error: {
            code: "ALREADY_ENROLLED",
            message: "You are already enrolled in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Enroll user as student
      const { data: enrollment, error: enrollmentError } = await supabase
        .from("course_enrollments")
        .insert({
          user_id: userId,
          course_id: course.id,
          role: UserRole.STUDENT,
        })
        .select("*")
        .single();

      if (enrollmentError) {
        throw enrollmentError;
      }

      res.status(201).json({
        message: "Successfully joined course",
        course: course,
        enrollment: enrollment,
      });
    } catch (error) {
      console.error("Error joining course:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to join course",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /course/:id/students
 * Get all enrolled students in a course with their sections
 */
router.get(
  "/course/:id/students",
  authenticateToken,
  requireCoursePermission("canRead", "id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id: courseId } = req.params;

      // Get all enrollments - students see instructors, TAs, and other students
      const { data: enrollments, error: enrollmentsError } = await supabase
        .from("course_enrollments")
        .select("*")
        .eq("course_id", courseId)
        .in("role", [
          "instructor",
          "admin",
          "teaching_assistant",
          "student",
          "audit",
        ]);

      if (enrollmentsError) {
        throw enrollmentsError;
      }

      if (!enrollments || enrollments.length === 0) {
        res.json({ data: [] });
        return;
      }

      // Get user data for all enrolled users
      const userIds = enrollments.map((e) => e.user_id);
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, first_name, last_name, email, is_admin, settings")
        .in("id", userIds);

      if (usersError) {
        throw usersError;
      }

      // Get section data for enrollments that have section_id
      const sectionIds = enrollments
        .filter((e) => e.section_id)
        .map((e) => e.section_id);

      let sections: any[] = [];
      if (sectionIds.length > 0) {
        const { data: sectionsData, error: sectionsError } = await supabase
          .from("sections")
          .select("id, name, slug, description")
          .in("id", sectionIds);

        if (sectionsError) {
          throw sectionsError;
        }
        sections = sectionsData || [];
      }

      // Transform the data to match the expected format
      const students = enrollments.map((enrollment: any) => {
        const user = users?.find((u) => u.id === enrollment.user_id);
        const section = sections.find((s) => s.id === enrollment.section_id);

        return {
          ...user,
          enrollment: {
            id: enrollment.id,
            user_id: enrollment.user_id,
            course_id: enrollment.course_id,
            section_id: enrollment.section_id,
            role: enrollment.role,
            enrolled_at: enrollment.enrolled_at,
          },
          section: section || null,
        };
      });

      res.json({
        data: students,
      });
    } catch (error) {
      console.error("Error retrieving course students:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve course students",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /course/:id/enrollments
 * Get all enrollments in a course (for management purposes)
 */
router.get(
  "/course/:id/enrollments",
  authenticateToken,
  requireCoursePermission("canManage", "id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id: courseId } = req.params;

      // Get all enrollments (including instructors, TAs, etc.)
      const { data: enrollments, error: enrollmentsError } = await supabase
        .from("course_enrollments")
        .select("*")
        .eq("course_id", courseId);

      if (enrollmentsError) {
        throw enrollmentsError;
      }

      if (!enrollments || enrollments.length === 0) {
        res.json({ data: [] });
        return;
      }

      // Get user data for all enrolled users
      const userIds = enrollments.map((e) => e.user_id);
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, first_name, last_name, email, is_admin, settings")
        .in("id", userIds);

      if (usersError) {
        throw usersError;
      }

      // Get section data for enrollments that have section_id
      const sectionIds = enrollments
        .filter((e) => e.section_id)
        .map((e) => e.section_id);

      let sections: any[] = [];
      if (sectionIds.length > 0) {
        const { data: sectionsData, error: sectionsError } = await supabase
          .from("sections")
          .select("id, name, slug, description")
          .in("id", sectionIds);

        if (sectionsError) {
          throw sectionsError;
        }
        sections = sectionsData || [];
      }

      // Transform the data to match the expected format
      const enrolledUsers = enrollments.map((enrollment: any) => {
        const user = users?.find((u) => u.id === enrollment.user_id);
        const section = sections.find((s) => s.id === enrollment.section_id);

        return {
          ...user,
          enrollment: {
            id: enrollment.id,
            user_id: enrollment.user_id,
            course_id: enrollment.course_id,
            section_id: enrollment.section_id,
            role: enrollment.role,
            enrolled_at: enrollment.enrolled_at,
          },
          section: section || null,
        };
      });

      res.json({
        data: enrolledUsers,
      });
    } catch (error) {
      console.error("Error retrieving course enrollments:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve course enrollments",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /course/:id/my-enrollment
 * Get current user's enrollment in a course
 */
router.get(
  "/course/:id/my-enrollment",
  authenticateToken,
  requireCoursePermission("canRead", "id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id: courseId } = req.params;
      const { id: userId } = req.user!;

      // Get the current user's enrollment
      const { data: enrollment, error: enrollmentError } = await supabase
        .from("course_enrollments")
        .select(
          `
          *,
          sections:section_id (
            id,
            name,
            slug,
            description
          )
        `
        )
        .eq("course_id", courseId)
        .eq("user_id", userId)
        .single();

      if (enrollmentError || !enrollment) {
        res.status(404).json({
          error: {
            code: "ENROLLMENT_NOT_FOUND",
            message: "User is not enrolled in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      res.json({
        data: {
          ...enrollment,
          section: enrollment.sections,
        },
      });
    } catch (error) {
      console.error("Error retrieving user enrollment:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve user enrollment",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /course/:id/sections
 * Get all sections for a course
 */
router.get(
  "/course/:id/sections",
  authenticateToken,
  requireCoursePermission("canRead", "id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id: courseId } = req.params;

      const { data: sections, error: sectionsError } = await supabase
        .from("sections")
        .select("*")
        .eq("course_id", courseId)
        .order("name");

      if (sectionsError) {
        throw sectionsError;
      }

      res.json({
        data: sections || [],
      });
    } catch (error) {
      console.error("Error retrieving course sections:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve course sections",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /course/:id/gradebook
 * Get all gradebook data for a course (teacher/TA only)
 * Requirements: 3.1, 3.2, 3.3, 3.8, 2.2, 2.4, 2.6
 */
router.get(
  "/course/:id/gradebook",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id: courseId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Check course permissions - require canGrade or canManage
      const permissions = await getCoursePermissions(userId, courseId, isAdmin);

      if (!permissions.canGrade && !permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to access gradebook for this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Fetch all students enrolled in the course with section information
      const { data: enrollments, error: enrollmentsError } = await supabase
        .from("course_enrollments")
        .select(
          `
          user_id,
          section_id,
          users!course_enrollments_user_id_fkey(id, first_name, last_name, email),
          sections(id, name, slug)
        `
        )
        .eq("course_id", courseId)
        .eq("role", UserRole.STUDENT);

      if (enrollmentsError) {
        throw enrollmentsError;
      }

      // Fetch all assignments for the course
      const { data: assignments, error: assignmentsError } = await supabase
        .from("assignments")
        .select("*")
        .eq("course_id", courseId)
        .order("order_index");

      if (assignmentsError) {
        throw assignmentsError;
      }

      // Fetch all submissions for the course with grader data
      const { data: submissions, error: submissionsError } = await supabase
        .from("submissions")
        .select(
          `
          *,
          graders(*)
        `
        )
        .eq("course_id", courseId);

      if (submissionsError) {
        throw submissionsError;
      }

      // Format students data
      const students = (enrollments || []).map((enrollment: any) => ({
        userId: enrollment.users?.id,
        firstName: enrollment.users?.first_name,
        lastName: enrollment.users?.last_name,
        email: enrollment.users?.email,
        sectionId: enrollment.section_id,
        sectionName: enrollment.sections?.name || null,
        sectionSlug: enrollment.sections?.slug || null,
      }));

      // Format submissions data
      const formattedSubmissions = (submissions || []).map(
        (submission: any) => ({
          id: submission.id,
          assignment_id: submission.assignment_id,
          timestamp: submission.timestamp,
          values: submission.values,
          course_id: submission.course_id,
          student_id: submission.student_id,
          grader_id: submission.grader_id,
          grade: submission.grade,
          status: submission.status,
          created_at: submission.created_at,
          updated_at: submission.updated_at,
        })
      );

      // Format graders data
      const graders = (submissions || [])
        .filter(
          (submission: any) =>
            submission.graders && submission.graders.length > 0
        )
        .map((submission: any) => submission.graders[0]);

      res.json({
        students,
        assignments: assignments || [],
        submissions: formattedSubmissions,
        graders: graders || [],
      });
    } catch (error) {
      console.error("Error retrieving gradebook data:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve gradebook data",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /course/:id/grades/student
 * Get student's own grades for a course
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */
router.get(
  "/course/:id/grades/student",
  authenticateToken,
  requireCoursePermission("canRead", "id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id: courseId } = req.params;
      const { id: userId } = req.user!;

      // Fetch all assignments published to the student
      const { data: assignments, error: assignmentsError } = await supabase
        .from("assignments")
        .select("*")
        .eq("course_id", courseId)
        .order("order_index");

      if (assignmentsError) {
        throw assignmentsError;
      }

      // Get student's enrollment to check section
      const { data: enrollment, error: enrollmentError } = await supabase
        .from("course_enrollments")
        .select("section_id")
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .single();

      if (enrollmentError || !enrollment) {
        res.status(403).json({
          error: {
            code: "NOT_ENROLLED",
            message: "Not enrolled in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Filter assignments to only those published to the student
      const publishedAssignments = (assignments || []).filter(
        (assignment: any) => {
          const publishedTo = assignment.published_to || [];
          // Check if published to course or student's section
          return (
            publishedTo.includes(courseId) ||
            (enrollment.section_id &&
              publishedTo.includes(enrollment.section_id))
          );
        }
      );

      // Fetch student's submissions with grader data
      const { data: submissions, error: submissionsError } = await supabase
        .from("submissions")
        .select(
          `
          *,
          graders(*)
        `
        )
        .eq("course_id", courseId)
        .eq("student_id", userId)
        .order("timestamp", { ascending: false });

      if (submissionsError) {
        throw submissionsError;
      }

      // Format submissions data
      const formattedSubmissions = (submissions || []).map(
        (submission: any) => ({
          id: submission.id,
          assignment_id: submission.assignment_id,
          timestamp: submission.timestamp,
          values: submission.values,
          course_id: submission.course_id,
          student_id: submission.student_id,
          grader_id: submission.grader_id,
          grade: submission.grade,
          status: submission.status,
          created_at: submission.created_at,
          updated_at: submission.updated_at,
        })
      );

      // Format graders data
      const graders = (submissions || [])
        .filter(
          (submission: any) =>
            submission.graders && submission.graders.length > 0
        )
        .map((submission: any) => submission.graders[0]);

      res.json({
        assignments: publishedAssignments,
        submissions: formattedSubmissions,
        graders: graders || [],
      });
    } catch (error) {
      console.error("Error retrieving student grades:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve student grades",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
