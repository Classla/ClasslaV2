import { Router, Request, Response } from "express";
import { supabase, authenticateToken } from "../middleware/auth";
import { asyncHandler } from "../middleware/errorHandler";
// Define JoinLink interface locally since we can't import from outside rootDir
interface JoinLink {
  id: string;
  course_slug: string;
  section_slug?: string;
  expiry_date: Date;
  created_by_id: string;
  created_at: Date;
}

const router = Router();

// Create a new join link
router.post(
  "/",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const { course_slug, section_slug, expiry_date } = req.body;
    const user_id = req.user?.id;

    if (!course_slug || !expiry_date) {
      return res
        .status(400)
        .json({ error: "course_slug and expiry_date are required" });
    }

    // Check if user has permission to create join links for this course
    const { data: courseEnrollment, error: permissionError } = await supabase
      .from("course_enrollments")
      .select("courses!inner(id, slug)")
      .eq("courses.slug", course_slug)
      .eq("user_id", user_id)
      .in("role", ["instructor", "teaching_assistant", "admin"])
      .single();

    if (permissionError || !courseEnrollment) {
      return res.status(403).json({
        error: "Insufficient permissions to create join links for this course",
      });
    }

    // If section_slug is provided, verify it exists for this course
    if (section_slug) {
      const { data: section, error: sectionError } = await supabase
        .from("sections")
        .select("id")
        .eq("course_id", (courseEnrollment as any).courses.id)
        .eq("slug", section_slug)
        .single();

      if (sectionError || !section) {
        return res
          .status(404)
          .json({ error: "Section not found for this course" });
      }
    }

    // Create the join link
    const { data: joinLink, error: insertError } = await supabase
      .from("join_links")
      .insert({
        course_slug,
        section_slug: section_slug || null,
        expiry_date,
        created_by_id: user_id,
      })
      .select()
      .single();

    if (insertError) {
      console.error("Error creating join link:", insertError);
      return res.status(500).json({ error: "Failed to create join link" });
    }

    const result: JoinLink = {
      id: joinLink.id,
      course_slug: joinLink.course_slug,
      section_slug: joinLink.section_slug,
      expiry_date: new Date(joinLink.expiry_date),
      created_by_id: joinLink.created_by_id,
      created_at: new Date(joinLink.created_at),
    };

    res.status(201).json(result);
  })
);

// Get join links for a course (instructor/TA/admin only)
router.get(
  "/course/:course_slug",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const { course_slug } = req.params;
    const user_id = req.user?.id;

    // Check permissions
    const { data: courseEnrollment, error: permissionError } = await supabase
      .from("course_enrollments")
      .select("courses!inner(id, slug)")
      .eq("courses.slug", course_slug)
      .eq("user_id", user_id)
      .in("role", ["instructor", "teaching_assistant", "admin"])
      .single();

    if (permissionError || !courseEnrollment) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }

    // Get active join links for the course
    const { data: joinLinks, error: fetchError } = await supabase
      .from("join_links")
      .select("*")
      .eq("course_slug", course_slug)
      .gt("expiry_date", new Date().toISOString())
      .order("created_at", { ascending: false });

    if (fetchError) {
      console.error("Error fetching join links:", fetchError);
      return res.status(500).json({ error: "Failed to fetch join links" });
    }

    const result: JoinLink[] = joinLinks.map((link) => ({
      id: link.id,
      course_slug: link.course_slug,
      section_slug: link.section_slug,
      expiry_date: new Date(link.expiry_date),
      created_by_id: link.created_by_id,
      created_at: new Date(link.created_at),
    }));

    res.json(result);
  })
);

// Use a join link to join a course/section
router.post(
  "/use/:link_id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const { link_id } = req.params;
    const user_id = req.user?.id;

    // Get the join link and check if it's valid
    const { data: joinLink, error: linkError } = await supabase
      .from("join_links")
      .select("*")
      .eq("id", link_id)
      .single();

    if (linkError || !joinLink) {
      return res.status(404).json({ error: "Join link not found" });
    }

    // Check if link has expired
    if (new Date(joinLink.expiry_date) < new Date()) {
      return res.status(410).json({ error: "Join link has expired" });
    }

    // Get course information
    const { data: course, error: courseError } = await supabase
      .from("courses")
      .select("id, name")
      .eq("slug", joinLink.course_slug)
      .single();

    if (courseError || !course) {
      return res.status(404).json({ error: "Course not found" });
    }

    // Check if user is already enrolled
    const { data: existingEnrollment } = await supabase
      .from("course_enrollments")
      .select("id")
      .eq("course_id", course.id)
      .eq("user_id", user_id)
      .single();

    if (existingEnrollment) {
      return res.status(409).json({
        error: {
          code: "ALREADY_ENROLLED",
          message: "User is already enrolled in this course",
          details: {
            course_name: course.name,
            course_slug: joinLink.course_slug,
            section_slug: joinLink.section_slug,
          },
        },
        timestamp: new Date().toISOString(),
        path: req.originalUrl,
      });
    }

    // Enroll user as student
    const { error: enrollError } = await supabase
      .from("course_enrollments")
      .insert({
        course_id: course.id,
        user_id: user_id,
        role: "student",
      });

    if (enrollError) {
      console.error("Error enrolling user:", enrollError);
      return res.status(500).json({ error: "Failed to enroll in course" });
    }

    // If section_slug is specified, also enroll in section
    if (joinLink.section_slug) {
      const { data: section, error: sectionError } = await supabase
        .from("sections")
        .select("id")
        .eq("course_id", course.id)
        .eq("slug", joinLink.section_slug)
        .single();

      if (!sectionError && section) {
        await supabase.from("section_enrollments").insert({
          section_id: section.id,
          user_id: user_id,
          role: "student",
        });
      }
    }

    res.json({
      message: "Successfully joined course",
      course_name: course.name,
      course_slug: joinLink.course_slug,
      section_slug: joinLink.section_slug,
    });
  })
);

// Delete a join link
router.delete(
  "/:link_id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const { link_id } = req.params;
    const user_id = req.user?.id;

    // Get the join link to check permissions
    const { data: joinLink, error: linkError } = await supabase
      .from("join_links")
      .select("*, courses!inner(id)")
      .eq("id", link_id)
      .single();

    if (linkError || !joinLink) {
      return res.status(404).json({ error: "Join link not found" });
    }

    // Check if user has permission to delete this link
    const { data: courseEnrollment } = await supabase
      .from("course_enrollments")
      .select("id")
      .eq("course_id", joinLink.courses.id)
      .eq("user_id", user_id)
      .in("role", ["instructor", "teaching_assistant", "admin"])
      .single();

    if (!courseEnrollment && joinLink.created_by_id !== user_id) {
      return res
        .status(403)
        .json({ error: "Insufficient permissions to delete this join link" });
    }

    // Delete the join link
    const { error: deleteError } = await supabase
      .from("join_links")
      .delete()
      .eq("id", link_id);

    if (deleteError) {
      console.error("Error deleting join link:", deleteError);
      return res.status(500).json({ error: "Failed to delete join link" });
    }

    res.json({ message: "Join link deleted successfully" });
  })
);

export default router;
