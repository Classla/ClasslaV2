import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import {
  requireOwnershipOrElevated,
  getUserCourseRole,
  getCoursePermissions,
  requireRoles,
} from "../middleware/authorization";
import {
  UserResponse,
  UpdateUserRequest,
  ApiResponse,
  UserRoleInCourseResponse,
  EnrollUserRequest,
} from "../types/api";
import { UserRole } from "../types/enums";

const router = Router();

/**
 * GET /user/:id - Get user by ID with proper authorization
 * Requirements: 7.2, 7.3
 */
router.get(
  "/user/:id",
  authenticateToken,
  requireOwnershipOrElevated("id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;

      const { data: user, error } = await supabase
        .from("users")
        .select(
          "id, workos_user_id, first_name, last_name, email, roles, is_admin, settings, created_at, updated_at"
        )
        .eq("id", id)
        .single();

      if (error || !user) {
        res.status(404).json({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const response: ApiResponse<UserResponse> = {
        data: user,
        success: true,
      };

      res.json(response);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch user",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /users/:userId/courses - Get enrolled courses for a user
 * Requirements: 7.2, 7.3
 */
router.get(
  "/users/:userId/courses",
  authenticateToken,
  requireOwnershipOrElevated("userId"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { userId } = req.params;

      // Get user's course enrollments with course details
      const { data: enrollments, error } = await supabase
        .from("course_enrollments")
        .select(
          `
          role,
          enrolled_at,
          courses (
            id,
            name,
            slug,
            thumbnail_url,
            summary_content,
            created_at
          )
        `
        )
        .eq("user_id", userId);

      if (error) {
        console.error("Error fetching user courses:", error);
        res.status(500).json({
          error: {
            code: "DATABASE_ERROR",
            message: "Failed to fetch user courses",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Transform the data to include role information with course details
      const coursesWithRoles =
        enrollments
          ?.filter((enrollment) => enrollment.courses) // Filter out null courses
          .map((enrollment) => ({
            ...enrollment.courses,
            user_role: enrollment.role,
            enrolled_at: enrollment.enrolled_at,
          })) || [];

      // Get student counts for each course
      const courseIds = coursesWithRoles.map((course: any) => course.id);
      const studentCounts: Record<string, number> = {};

      if (courseIds.length > 0) {
        // Count students (role = 'student') for each course
        const { data: studentEnrollments, error: countError } = await supabase
          .from("course_enrollments")
          .select("course_id")
          .in("course_id", courseIds)
          .eq("role", UserRole.STUDENT);

        if (!countError && studentEnrollments) {
          // Count students per course
          studentEnrollments.forEach((enrollment) => {
            const courseId = enrollment.course_id;
            studentCounts[courseId] = (studentCounts[courseId] || 0) + 1;
          });
        }
      }

      // Add student_count to each course
      const coursesWithStudentCounts = coursesWithRoles.map((course: any) => ({
        ...course,
        student_count: studentCounts[course.id] || 0,
      }));

      const response: ApiResponse<any[]> = {
        data: coursesWithStudentCounts,
        success: true,
      };

      res.json(response);
    } catch (error) {
      console.error("Error fetching user courses:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch user courses",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /user/role/:courseId - Get user's role in specific course
 * Requirements: 7.2, 7.3
 */
router.get(
  "/user/role/:courseId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId } = req.params;
      const userId = req.user!.id;

      // Get user's role in the course
      const userRole = await getUserCourseRole(userId, courseId);

      if (!userRole) {
        res.status(404).json({
          error: {
            code: "NOT_ENROLLED",
            message: "User is not enrolled in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get permissions for this role
      const permissions = await getCoursePermissions(
        userId,
        courseId,
        req.user!.isAdmin
      );

      const response: ApiResponse<UserRoleInCourseResponse> = {
        data: {
          user_id: userId,
          course_id: courseId,
          role: userRole,
          permissions,
        },
        success: true,
      };

      res.json(response);
    } catch (error) {
      console.error("Error fetching user role:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to fetch user role",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /user/:id - Update user profile
 * Requirements: 7.2, 7.3
 */
router.put(
  "/user/:id",
  authenticateToken,
  requireOwnershipOrElevated("id"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const updateData: UpdateUserRequest = req.body;

      // Validate input
      if (!updateData || Object.keys(updateData).length === 0) {
        res.status(400).json({
          error: {
            code: "INVALID_INPUT",
            message: "No update data provided",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Only allow updating specific fields
      const filteredData: Partial<UpdateUserRequest> = {};

      if (updateData.first_name !== undefined) {
        filteredData.first_name = updateData.first_name;
      }

      if (updateData.last_name !== undefined) {
        filteredData.last_name = updateData.last_name;
      }

      if (updateData.settings !== undefined) {
        filteredData.settings = updateData.settings;
      }

      if (Object.keys(filteredData).length === 0) {
        res.status(400).json({
          error: {
            code: "NO_VALID_FIELDS",
            message: "No valid fields to update",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Add updated_at timestamp
      const updatePayload = {
        ...filteredData,
        updated_at: new Date().toISOString(),
      };

      const { data: updatedUser, error } = await supabase
        .from("users")
        .update(updatePayload)
        .eq("id", id)
        .select(
          "id, workos_user_id, first_name, last_name, email, roles, is_admin, settings, created_at, updated_at"
        )
        .single();

      if (error) {
        console.error("Error updating user:", error);
        res.status(500).json({
          error: {
            code: "DATABASE_ERROR",
            message: "Failed to update user",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      if (!updatedUser) {
        res.status(404).json({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const response: ApiResponse<UserResponse> = {
        data: updatedUser,
        success: true,
        message: "User updated successfully",
      };

      res.json(response);
    } catch (error) {
      console.error("Error updating user:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update user",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /user/enroll - Enroll user in course
 * Requirements: 2.1, 7.1
 */
router.post(
  "/user/enroll",
  authenticateToken,
  requireRoles([UserRole.INSTRUCTOR, UserRole.ADMIN]),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const enrollmentData: EnrollUserRequest = req.body;

      // Validate required fields
      if (
        !enrollmentData.user_id ||
        !enrollmentData.course_id ||
        !enrollmentData.role
      ) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "user_id, course_id, and role are required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate role
      if (!Object.values(UserRole).includes(enrollmentData.role)) {
        res.status(400).json({
          error: {
            code: "INVALID_ROLE",
            message: "Invalid user role provided",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user exists
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("id")
        .eq("id", enrollmentData.user_id)
        .single();

      if (userError || !user) {
        res.status(404).json({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if course exists
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("id")
        .eq("id", enrollmentData.course_id)
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

      // Check if user is already enrolled
      const { data: existingEnrollment } = await supabase
        .from("course_enrollments")
        .select("id, role")
        .eq("user_id", enrollmentData.user_id)
        .eq("course_id", enrollmentData.course_id)
        .single();

      if (existingEnrollment) {
        // Update existing enrollment role
        const { data: updatedEnrollment, error: updateError } = await supabase
          .from("course_enrollments")
          .update({
            role: enrollmentData.role,
            enrolled_at: new Date().toISOString(),
          })
          .eq("user_id", enrollmentData.user_id)
          .eq("course_id", enrollmentData.course_id)
          .select("*")
          .single();

        if (updateError) {
          console.error("Error updating enrollment:", updateError);
          res.status(500).json({
            error: {
              code: "DATABASE_ERROR",
              message: "Failed to update enrollment",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }

        const response: ApiResponse<any> = {
          data: updatedEnrollment,
          success: true,
          message: "User enrollment updated successfully",
        };

        res.json(response);
        return;
      }

      // Create new enrollment
      const { data: newEnrollment, error: enrollError } = await supabase
        .from("course_enrollments")
        .insert({
          user_id: enrollmentData.user_id,
          course_id: enrollmentData.course_id,
          role: enrollmentData.role,
          enrolled_at: new Date().toISOString(),
        })
        .select("*")
        .single();

      if (enrollError) {
        console.error("Error creating enrollment:", enrollError);
        res.status(500).json({
          error: {
            code: "DATABASE_ERROR",
            message: "Failed to create enrollment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const response: ApiResponse<any> = {
        data: newEnrollment,
        success: true,
        message: "User enrolled successfully",
      };

      res.json(response);
    } catch (error) {
      console.error("Error enrolling user:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to enroll user",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
