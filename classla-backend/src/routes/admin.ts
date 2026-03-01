import express, { Request, Response } from "express";
import { asyncHandler } from "../middleware/errorHandler";
import { authenticateToken, supabase } from "../middleware/auth";
import { requireAdmin } from "../middleware/authorization";
import { autoEnrollmentService } from "../services/autoEnrollmentService";
import { logger } from "../utils/logger";

const router = express.Router();

// Helper: generate a unique 6-char join code
async function generateUniqueJoinCode(): Promise<string> {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let attempts = 0;
  while (attempts < 10) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const { data } = await supabase
      .from("courses")
      .select("id")
      .eq("slug", code)
      .is("deleted_at", null)
      .single();
    if (!data) return code;
    attempts++;
  }
  throw new Error("Unable to generate unique join code");
}

// POST /api/admin/official-courses
// Create a new course and mark it as official
router.post(
  "/official-courses",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { name } = req.body;
    const userId = req.user!.id;

    if (!name || !name.trim()) {
      res.status(400).json({
        error: { code: "INVALID_INPUT", message: "Course name is required" },
      });
      return;
    }

    const slug = await generateUniqueJoinCode();

    const { data: course, error } = await supabase
      .from("courses")
      .insert({
        name: name.trim(),
        slug,
        created_by_id: userId,
        is_official: true,
        settings: {},
        summary_content: "",
      })
      .select("id, name, slug, is_official")
      .single();

    if (error) throw error;

    // Enroll the admin as instructor
    await supabase.from("course_enrollments").insert({
      user_id: userId,
      course_id: course.id,
      role: "instructor",
    });

    logger.info("Official course created", {
      courseId: course.id,
      name: course.name,
      createdBy: userId,
    });

    res.json({ course });
  })
);

// GET /api/admin/official-courses
// List all official courses with student counts
router.get(
  "/official-courses",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { data: courses, error } = await supabase
      .from("courses")
      .select("id, name, slug, created_at, is_official")
      .eq("is_official", true)
      .is("deleted_at", null)
      .order("name");

    if (error) throw error;

    // Get student counts for each course
    const coursesWithCounts = await Promise.all(
      (courses ?? []).map(async (course) => {
        const { count } = await supabase
          .from("course_enrollments")
          .select("id", { count: "exact", head: true })
          .eq("course_id", course.id)
          .eq("role", "student");

        return { ...course, student_count: count ?? 0 };
      })
    );

    res.json({ courses: coursesWithCounts });
  })
);

// GET /api/admin/courses/search?q=
// Search all courses by name (for adding official courses)
router.get(
  "/courses/search",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const query = (req.query.q as string) || "";

    if (!query.trim()) {
      res.json({ courses: [] });
      return;
    }

    const { data: courses, error } = await supabase
      .from("courses")
      .select("id, name, slug, is_official")
      .is("deleted_at", null)
      .ilike("name", `%${query}%`)
      .order("name")
      .limit(20);

    if (error) throw error;

    res.json({ courses: courses ?? [] });
  })
);

// PUT /api/admin/courses/:id/official
// Toggle is_official on a course
router.put(
  "/courses/:id/official",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { is_official } = req.body;

    if (typeof is_official !== "boolean") {
      res.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "is_official must be a boolean",
        },
      });
      return;
    }

    const { data: course, error } = await supabase
      .from("courses")
      .update({ is_official })
      .eq("id", id)
      .select("id, name, slug, is_official")
      .single();

    if (error) throw error;

    if (!course) {
      res.status(404).json({
        error: { code: "NOT_FOUND", message: "Course not found" },
      });
      return;
    }

    logger.info("Course official status updated", {
      courseId: id,
      is_official,
      updatedBy: req.user!.id,
    });

    res.json({ course });
  })
);

// GET /api/admin/auto-enroll
// Get current auto-enroll course info
router.get(
  "/auto-enroll",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { data: setting, error } = await supabase
      .from("system_settings")
      .select("value, updated_at, updated_by_id")
      .eq("key", "auto_enroll_course_id")
      .single();

    if (error || !setting) {
      res.json({ enabled: false, course: null });
      return;
    }

    const courseId = setting.value;
    if (!courseId) {
      res.json({ enabled: false, course: null });
      return;
    }

    const { data: course } = await supabase
      .from("courses")
      .select("id, name, slug, is_official")
      .eq("id", courseId)
      .single();

    res.json({
      enabled: true,
      course: course ?? null,
      updated_at: setting.updated_at,
      updated_by_id: setting.updated_by_id,
    });
  })
);

// PUT /api/admin/auto-enroll
// Set or clear the auto-enroll course
router.put(
  "/auto-enroll",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const { course_id } = req.body; // null to disable

    if (course_id) {
      // Verify course exists and is official
      const { data: course, error: courseError } = await supabase
        .from("courses")
        .select("id, is_official")
        .eq("id", course_id)
        .single();

      if (courseError || !course) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Course not found" },
        });
        return;
      }

      if (!course.is_official) {
        res.status(400).json({
          error: {
            code: "NOT_OFFICIAL",
            message: "Only official courses can be set for auto-enrollment",
          },
        });
        return;
      }

      // Upsert the setting
      const { error } = await supabase.from("system_settings").upsert(
        {
          key: "auto_enroll_course_id",
          value: course_id,
          updated_at: new Date().toISOString(),
          updated_by_id: req.user!.id,
        },
        { onConflict: "key" }
      );

      if (error) throw error;

      logger.info("Auto-enroll course set", {
        courseId: course_id,
        updatedBy: req.user!.id,
      });

      res.json({ enabled: true, course_id });
    } else {
      // Disable auto-enroll by removing the setting
      const { error } = await supabase
        .from("system_settings")
        .delete()
        .eq("key", "auto_enroll_course_id");

      if (error) throw error;

      logger.info("Auto-enroll disabled", { updatedBy: req.user!.id });

      res.json({ enabled: false, course_id: null });
    }
  })
);

// POST /api/admin/auto-enroll/execute
// Retroactively enroll all eligible users in the auto-enroll course
router.post(
  "/auto-enroll/execute",
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    // Get current auto-enroll course
    const { data: setting, error: settingError } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", "auto_enroll_course_id")
      .single();

    if (settingError || !setting || !setting.value) {
      res.status(400).json({
        error: {
          code: "NOT_CONFIGURED",
          message: "Auto-enrollment is not configured",
        },
      });
      return;
    }

    const courseId = setting.value;
    const count = await autoEnrollmentService.retroactiveEnrollAll(courseId);

    logger.info("Retroactive enrollment executed", {
      courseId,
      enrolledCount: count,
      executedBy: req.user!.id,
    });

    res.json({ enrolled_count: count, course_id: courseId });
  })
);

export default router;
