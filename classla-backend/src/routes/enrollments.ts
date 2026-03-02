import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import { getCoursePermissions } from "../middleware/authorization";
import { UserRole } from "../types/enums";

const router = Router();

/**
 * PUT /enrollments/:id
 * Update enrollment (section_id or role)
 */
router.put(
  "/enrollments/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id: enrollmentId } = req.params;
      const { section_id, role } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Get the enrollment to check course permissions
      const { data: enrollment, error: enrollmentError } = await supabase
        .from("course_enrollments")
        .select("*")
        .eq("id", enrollmentId)
        .single();

      if (enrollmentError || !enrollment) {
        res.status(404).json({
          error: {
            code: "ENROLLMENT_NOT_FOUND",
            message: "Enrollment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user has permission to manage this course
      const permissions = await getCoursePermissions(
        userId,
        enrollment.course_id,
        isAdmin
      );

      if (!permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to modify enrollments in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Prepare update data
      const updateData: any = {};

      if (section_id !== undefined) {
        updateData.section_id = section_id;

        // If section_id is provided, verify it exists and belongs to the course
        if (section_id) {
          const { data: section, error: sectionError } = await supabase
            .from("sections")
            .select("id")
            .eq("id", section_id)
            .eq("course_id", enrollment.course_id)
            .single();

          if (sectionError || !section) {
            res.status(400).json({
              error: {
                code: "INVALID_SECTION",
                message: "Section not found or does not belong to this course",
                timestamp: new Date().toISOString(),
                path: req.path,
              },
            });
            return;
          }
        }
      }

      if (role !== undefined) {
        // Validate role
        if (!Object.values(UserRole).includes(role)) {
          res.status(400).json({
            error: {
              code: "INVALID_ROLE",
              message: "Invalid role specified",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
        updateData.role = role;
      }

      // Update the enrollment
      const { data: updatedEnrollment, error: updateError } = await supabase
        .from("course_enrollments")
        .update(updateData)
        .eq("id", enrollmentId)
        .select("*")
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json({
        message: "Enrollment updated successfully",
        enrollment: updatedEnrollment,
      });
    } catch (error) {
      console.error("Error updating enrollment:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update enrollment",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * DELETE /enrollments/:id
 * Remove enrollment (unenroll student from course)
 */
router.delete(
  "/enrollments/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id: enrollmentId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the enrollment to check course permissions
      const { data: enrollment, error: enrollmentError } = await supabase
        .from("course_enrollments")
        .select("*")
        .eq("id", enrollmentId)
        .single();

      if (enrollmentError || !enrollment) {
        res.status(404).json({
          error: {
            code: "ENROLLMENT_NOT_FOUND",
            message: "Enrollment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if user has permission to manage this course
      const permissions = await getCoursePermissions(
        userId,
        enrollment.course_id,
        isAdmin
      );

      if (!permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to remove enrollments from this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Delete the enrollment
      const { error: deleteError } = await supabase
        .from("course_enrollments")
        .delete()
        .eq("id", enrollmentId);

      if (deleteError) {
        throw deleteError;
      }

      res.json({
        message: "Enrollment removed successfully",
      });
    } catch (error) {
      console.error("Error removing enrollment:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to remove enrollment",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * DELETE /enrollments/leave/:courseId
 * Leave a course (self-unenroll)
 */
router.delete(
  "/enrollments/leave/:courseId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId } = req.params;
      const userId = req.user!.id;

      // Find the enrollment
      const { data: enrollment, error: findError } = await supabase
        .from("course_enrollments")
        .select("id, role")
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .single();

      if (findError || !enrollment) {
        res.status(404).json({
          error: {
            code: "ENROLLMENT_NOT_FOUND",
            message: "You are not enrolled in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Instructors cannot leave their own course
      if (enrollment.role === UserRole.INSTRUCTOR) {
        res.status(403).json({
          error: {
            code: "CANNOT_LEAVE",
            message: "Instructors cannot leave their own course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const { error: deleteError } = await supabase
        .from("course_enrollments")
        .delete()
        .eq("id", enrollment.id);

      if (deleteError) throw deleteError;

      res.json({ message: "Successfully left the course" });
    } catch (error) {
      console.error("Error leaving course:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to leave course",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
