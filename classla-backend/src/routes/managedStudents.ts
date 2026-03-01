import { Router, Request, Response } from "express";
import {
  managedStudentService,
  ManagedStudentServiceError,
} from "../services/managedStudentService";
import { authenticateToken } from "../middleware/auth";
import { logger } from "../utils/logger";

const router = Router();

/**
 * POST /managed-students
 * Create a new managed student
 */
router.post(
  "/managed-students",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { username, password, firstName, lastName, courseId, sectionId } = req.body;

      // Validate required parameters
      if (!username || !password) {
        return res.status(400).json({
          success: false,
          error: "Username and password are required",
          code: "MISSING_CREDENTIALS",
        });
      }

      const teacherId = req.user!.id;

      const student = await managedStudentService.createManagedStudent(
        teacherId,
        {
          username,
          password,
          firstName,
          lastName,
          courseId,
          sectionId,
        }
      );

      logger.info("Managed student created via API", {
        requestId: req.headers["x-request-id"],
        teacherId,
        studentId: student.id,
        username: student.username,
      });

      return res.status(201).json({
        success: true,
        student,
      });
    } catch (error) {
      logger.error("Failed to create managed student", {
        requestId: req.headers["x-request-id"],
        teacherId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to create student",
        code: "CREATION_ERROR",
      });
    }
  }
);

/**
 * GET /managed-students
 * List all managed students for the authenticated teacher
 */
router.get(
  "/managed-students",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.user!.id;

      const students = await managedStudentService.getManagedStudents(teacherId);

      return res.json({
        success: true,
        students,
      });
    } catch (error) {
      logger.error("Failed to list managed students", {
        requestId: req.headers["x-request-id"],
        teacherId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to retrieve students",
        code: "RETRIEVAL_ERROR",
      });
    }
  }
);

/**
 * POST /managed-students/check-username
 * Check if a username is available globally
 */
router.post(
  "/managed-students/check-username",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { username } = req.body;

      if (!username || typeof username !== "string") {
        return res.status(400).json({
          success: false,
          error: "Username is required",
          code: "MISSING_USERNAME",
        });
      }

      const result = await managedStudentService.checkUsernameAvailability(username);

      return res.json({
        success: true,
        available: result.available,
        suggestion: result.suggestion,
      });
    } catch (error) {
      logger.error("Failed to check username availability", {
        requestId: req.headers["x-request-id"],
        username: req.body.username,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to check username",
        code: "USERNAME_CHECK_ERROR",
      });
    }
  }
);

/**
 * POST /managed-students/validate-usernames
 * Validate multiple usernames for bulk import
 */
router.post(
  "/managed-students/validate-usernames",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const { usernames } = req.body;

      if (!Array.isArray(usernames) || usernames.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Usernames array is required",
          code: "MISSING_USERNAMES",
        });
      }

      if (usernames.length > 500) {
        return res.status(400).json({
          success: false,
          error: "Maximum 500 usernames can be validated at once",
          code: "TOO_MANY_USERNAMES",
        });
      }

      const result = await managedStudentService.validateUsernamesForBulkImport(usernames);

      return res.json({
        success: true,
        valid: result.valid,
        results: result.results,
      });
    } catch (error) {
      logger.error("Failed to validate usernames", {
        requestId: req.headers["x-request-id"],
        count: req.body.usernames?.length,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to validate usernames",
        code: "VALIDATION_ERROR",
      });
    }
  }
);

/**
 * GET /managed-students/courses
 * List all courses where the teacher is an instructor (for enrollment dropdowns)
 */
router.get(
  "/managed-students/courses",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.user!.id;

      const courses = await managedStudentService.getTeacherCourses(teacherId);

      return res.json({
        success: true,
        courses,
      });
    } catch (error) {
      logger.error("Failed to get teacher courses", {
        requestId: req.headers["x-request-id"],
        teacherId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      return res.status(500).json({
        success: false,
        error: "Failed to retrieve courses",
        code: "RETRIEVAL_ERROR",
      });
    }
  }
);

/**
 * GET /managed-students/:id
 * Get a single managed student by ID
 */
router.get(
  "/managed-students/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.user!.id;
      const studentId = req.params.id;

      const student = await managedStudentService.getManagedStudentById(
        teacherId,
        studentId
      );

      if (!student) {
        return res.status(404).json({
          success: false,
          error: "Student not found",
          code: "NOT_FOUND",
        });
      }

      return res.json({
        success: true,
        student,
      });
    } catch (error) {
      logger.error("Failed to get managed student", {
        requestId: req.headers["x-request-id"],
        teacherId: req.user?.id,
        studentId: req.params.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to retrieve student",
        code: "RETRIEVAL_ERROR",
      });
    }
  }
);

/**
 * PUT /managed-students/:id
 * Update a managed student's details
 */
router.put(
  "/managed-students/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.user!.id;
      const studentId = req.params.id;
      const { firstName, lastName } = req.body;

      const student = await managedStudentService.updateManagedStudent(
        teacherId,
        studentId,
        { firstName, lastName }
      );

      logger.info("Managed student updated via API", {
        requestId: req.headers["x-request-id"],
        teacherId,
        studentId,
      });

      return res.json({
        success: true,
        student,
      });
    } catch (error) {
      logger.error("Failed to update managed student", {
        requestId: req.headers["x-request-id"],
        teacherId: req.user?.id,
        studentId: req.params.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to update student",
        code: "UPDATE_ERROR",
      });
    }
  }
);

/**
 * DELETE /managed-students/:id
 * Delete a managed student and all their data
 */
router.delete(
  "/managed-students/:id",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.user!.id;
      const studentId = req.params.id;

      await managedStudentService.deleteManagedStudent(teacherId, studentId);

      logger.info("Managed student deleted via API", {
        requestId: req.headers["x-request-id"],
        teacherId,
        studentId,
      });

      return res.json({
        success: true,
        message: "Student deleted successfully",
      });
    } catch (error) {
      logger.error("Failed to delete managed student", {
        requestId: req.headers["x-request-id"],
        teacherId: req.user?.id,
        studentId: req.params.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to delete student",
        code: "DELETION_ERROR",
      });
    }
  }
);

/**
 * POST /managed-students/:id/reset-password
 * Reset a managed student's password
 */
router.post(
  "/managed-students/:id/reset-password",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.user!.id;
      const studentId = req.params.id;

      const result = await managedStudentService.resetPassword(
        teacherId,
        studentId
      );

      logger.info("Managed student password reset via API", {
        requestId: req.headers["x-request-id"],
        teacherId,
        studentId,
      });

      return res.json({
        success: true,
        temporaryPassword: result.temporaryPassword,
      });
    } catch (error) {
      logger.error("Failed to reset managed student password", {
        requestId: req.headers["x-request-id"],
        teacherId: req.user?.id,
        studentId: req.params.id,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to reset password",
        code: "PASSWORD_RESET_ERROR",
      });
    }
  }
);

/**
 * POST /managed-students/:id/enroll
 * Enroll a managed student in a course
 */
router.post(
  "/managed-students/:id/enroll",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.user!.id;
      const studentId = req.params.id;
      const { courseId, role } = req.body;

      if (!courseId) {
        return res.status(400).json({
          success: false,
          error: "Course ID is required",
          code: "MISSING_COURSE_ID",
        });
      }

      await managedStudentService.enrollInCourse(teacherId, studentId, courseId, undefined, role);

      logger.info("Managed student enrolled in course via API", {
        requestId: req.headers["x-request-id"],
        teacherId,
        studentId,
        courseId,
      });

      return res.json({
        success: true,
        message: "Student enrolled successfully",
      });
    } catch (error) {
      logger.error("Failed to enroll managed student", {
        requestId: req.headers["x-request-id"],
        teacherId: req.user?.id,
        studentId: req.params.id,
        courseId: req.body.courseId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to enroll student",
        code: "ENROLLMENT_ERROR",
      });
    }
  }
);

/**
 * DELETE /managed-students/:id/enroll/:courseId
 * Unenroll a managed student from a course
 */
router.delete(
  "/managed-students/:id/enroll/:courseId",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      const teacherId = req.user!.id;
      const studentId = req.params.id;
      const courseId = req.params.courseId;

      await managedStudentService.unenrollFromCourse(
        teacherId,
        studentId,
        courseId
      );

      logger.info("Managed student unenrolled from course via API", {
        requestId: req.headers["x-request-id"],
        teacherId,
        studentId,
        courseId,
      });

      return res.json({
        success: true,
        message: "Student unenrolled successfully",
      });
    } catch (error) {
      logger.error("Failed to unenroll managed student", {
        requestId: req.headers["x-request-id"],
        teacherId: req.user?.id,
        studentId: req.params.id,
        courseId: req.params.courseId,
        error: error instanceof Error ? error.message : "Unknown error",
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to unenroll student",
        code: "UNENROLLMENT_ERROR",
      });
    }
  }
);

export default router;
