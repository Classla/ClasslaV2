import { supabase } from "../middleware/auth";
import { logger } from "../utils/logger";

class AutoEnrollmentService {
  /**
   * Auto-enroll a single user in the configured auto-enroll course.
   * Fire-and-forget: logs errors but does not throw.
   */
  async autoEnrollUser(userId: string): Promise<void> {
    try {
      // Check if auto-enroll is configured
      const { data: setting, error: settingError } = await supabase
        .from("system_settings")
        .select("value")
        .eq("key", "auto_enroll_course_id")
        .single();

      if (settingError || !setting) {
        return; // No auto-enroll configured
      }

      const courseId = setting.value;
      if (!courseId) return;

      // Check if user is managed (managed accounts are excluded)
      const { data: user, error: userError } = await supabase
        .from("users")
        .select("is_managed")
        .eq("id", userId)
        .single();

      if (userError || !user) return;
      if (user.is_managed) return;

      // Check if already enrolled
      const { data: existing } = await supabase
        .from("course_enrollments")
        .select("id")
        .eq("user_id", userId)
        .eq("course_id", courseId)
        .single();

      if (existing) return; // Already enrolled

      // Enroll as student
      const { error: enrollError } = await supabase
        .from("course_enrollments")
        .insert({
          user_id: userId,
          course_id: courseId,
          role: "student",
        });

      if (enrollError) {
        logger.warn("Auto-enrollment insert failed", {
          userId,
          courseId,
          error: enrollError.message,
        });
      } else {
        logger.info("Auto-enrolled user in course", { userId, courseId });
      }
    } catch (err) {
      logger.warn("Auto-enrollment failed", {
        userId,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  /**
   * Retroactively enroll all eligible (non-managed) users who are not already enrolled.
   * Returns the count of newly enrolled users.
   */
  async retroactiveEnrollAll(courseId: string): Promise<number> {
    const { data, error } = await supabase.rpc("retroactive_enroll_all", {
      target_course_id: courseId,
    });

    // If the RPC doesn't exist, fall back to a manual approach
    if (error) {
      logger.warn("RPC retroactive_enroll_all not available, using fallback", {
        error: error.message,
      });
      return this.retroactiveEnrollFallback(courseId);
    }

    return data ?? 0;
  }

  private async retroactiveEnrollFallback(courseId: string): Promise<number> {
    // Get all non-managed users not already enrolled
    const { data: users, error: usersError } = await supabase
      .from("users")
      .select("id")
      .or("is_managed.eq.false,is_managed.is.null");

    if (usersError || !users) {
      throw new Error("Failed to fetch users for retroactive enrollment");
    }

    // Get already-enrolled users
    const { data: enrolled, error: enrolledError } = await supabase
      .from("course_enrollments")
      .select("user_id")
      .eq("course_id", courseId);

    if (enrolledError) {
      throw new Error("Failed to fetch existing enrollments");
    }

    const enrolledSet = new Set((enrolled ?? []).map((e) => e.user_id));
    const toEnroll = users.filter((u) => !enrolledSet.has(u.id));

    if (toEnroll.length === 0) return 0;

    // Batch insert
    const { error: insertError } = await supabase
      .from("course_enrollments")
      .insert(
        toEnroll.map((u) => ({
          user_id: u.id,
          course_id: courseId,
          role: "student",
        }))
      );

    if (insertError) {
      throw new Error(`Failed to insert enrollments: ${insertError.message}`);
    }

    return toEnroll.length;
  }
}

export const autoEnrollmentService = new AutoEnrollmentService();
export default autoEnrollmentService;
