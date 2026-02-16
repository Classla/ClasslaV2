import { Router, Request, Response } from "express";
import { supabase, authenticateToken } from "../middleware/auth";
import { getCoursePermissions } from "../middleware/authorization";
import { logger } from "../utils/logger";

const router = Router();

const DEFAULT_MAX_CHARS = 10000;
const MAX_ENTRY_CHARS = 500;

/**
 * Helper: get the memory character cap for a course
 */
function getMaxChars(courseSettings: any): number {
  return courseSettings?.ai_memory_max_chars ?? DEFAULT_MAX_CHARS;
}

/**
 * Helper: get total character usage for a course's memories
 */
async function getTotalUsage(courseId: string): Promise<number> {
  const { data, error } = await supabase
    .from("ai_chat_memories")
    .select("content")
    .eq("course_id", courseId);

  if (error || !data) return 0;
  return data.reduce((sum: number, m: any) => sum + (m.content?.length || 0), 0);
}

/**
 * GET /course/:courseId/ai-memories
 * List all memories for a course
 */
router.get(
  "/course/:courseId/ai-memories",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Check permissions — require canManage (instructor only)
      if (!isAdmin) {
        const permissions = await getCoursePermissions(userId, courseId, false);
        if (!permissions.canManage) {
          res.status(403).json({
            error: { code: "INSUFFICIENT_PERMISSIONS", message: "Instructor access required" },
          });
          return;
        }
      }

      const { data: memories, error } = await supabase
        .from("ai_chat_memories")
        .select("id, content, source, created_by, created_at, updated_at, users!inner(first_name, last_name, email)")
        .eq("course_id", courseId)
        .order("created_at", { ascending: true });

      if (error) {
        res.status(500).json({
          error: { code: "DB_ERROR", message: error.message },
        });
        return;
      }

      // Get course settings for max chars
      const { data: course } = await supabase
        .from("courses")
        .select("settings")
        .eq("id", courseId)
        .single();

      const maxChars = getMaxChars(course?.settings);
      const totalUsage = (memories || []).reduce(
        (sum: number, m: any) => sum + (m.content?.length || 0),
        0
      );

      res.json({
        memories: memories || [],
        usage: { used: totalUsage, max: maxChars },
      });
    } catch (error: any) {
      logger.error("Error listing AI memories", { error: error.message });
      res.status(500).json({
        error: { code: "SERVER_ERROR", message: "Failed to list memories" },
      });
    }
  }
);

/**
 * POST /course/:courseId/ai-memories
 * Create a new memory entry
 */
router.post(
  "/course/:courseId/ai-memories",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId } = req.params;
      const { id: userId, isAdmin } = req.user!;
      const { content } = req.body;

      if (!content || typeof content !== "string" || content.trim().length === 0) {
        res.status(400).json({
          error: { code: "INVALID_PARAMS", message: "content is required" },
        });
        return;
      }

      if (content.length > MAX_ENTRY_CHARS) {
        res.status(400).json({
          error: {
            code: "CONTENT_TOO_LONG",
            message: `Memory entry must be ${MAX_ENTRY_CHARS} characters or fewer`,
          },
        });
        return;
      }

      // Check permissions
      if (!isAdmin) {
        const permissions = await getCoursePermissions(userId, courseId, false);
        if (!permissions.canManage) {
          res.status(403).json({
            error: { code: "INSUFFICIENT_PERMISSIONS", message: "Instructor access required" },
          });
          return;
        }
      }

      // Check cap
      const { data: course } = await supabase
        .from("courses")
        .select("settings")
        .eq("id", courseId)
        .single();

      const maxChars = getMaxChars(course?.settings);
      const currentUsage = await getTotalUsage(courseId);

      if (currentUsage + content.trim().length > maxChars) {
        res.status(400).json({
          error: {
            code: "MEMORY_FULL",
            message: `Adding this memory would exceed the ${maxChars} character limit (${currentUsage}/${maxChars} used)`,
          },
        });
        return;
      }

      const { data: memory, error } = await supabase
        .from("ai_chat_memories")
        .insert({
          course_id: courseId,
          content: content.trim(),
          created_by: userId,
          source: "instructor",
        })
        .select("id, content, source, created_by, created_at, updated_at")
        .single();

      if (error) {
        res.status(500).json({
          error: { code: "DB_ERROR", message: error.message },
        });
        return;
      }

      res.status(201).json({ memory });
    } catch (error: any) {
      logger.error("Error creating AI memory", { error: error.message });
      res.status(500).json({
        error: { code: "SERVER_ERROR", message: "Failed to create memory" },
      });
    }
  }
);

/**
 * PUT /course/:courseId/ai-memories/:id
 * Update a memory entry
 */
router.put(
  "/course/:courseId/ai-memories/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId, id } = req.params;
      const { id: userId, isAdmin } = req.user!;
      const { content } = req.body;

      if (!content || typeof content !== "string" || content.trim().length === 0) {
        res.status(400).json({
          error: { code: "INVALID_PARAMS", message: "content is required" },
        });
        return;
      }

      if (content.length > MAX_ENTRY_CHARS) {
        res.status(400).json({
          error: {
            code: "CONTENT_TOO_LONG",
            message: `Memory entry must be ${MAX_ENTRY_CHARS} characters or fewer`,
          },
        });
        return;
      }

      // Check permissions
      if (!isAdmin) {
        const permissions = await getCoursePermissions(userId, courseId, false);
        if (!permissions.canManage) {
          res.status(403).json({
            error: { code: "INSUFFICIENT_PERMISSIONS", message: "Instructor access required" },
          });
          return;
        }
      }

      // Get the existing memory to calculate cap delta
      const { data: existing, error: fetchError } = await supabase
        .from("ai_chat_memories")
        .select("content, course_id")
        .eq("id", id)
        .eq("course_id", courseId)
        .single();

      if (fetchError || !existing) {
        res.status(404).json({
          error: { code: "NOT_FOUND", message: "Memory not found" },
        });
        return;
      }

      // Check cap (subtract old content length, add new)
      const { data: course } = await supabase
        .from("courses")
        .select("settings")
        .eq("id", courseId)
        .single();

      const maxChars = getMaxChars(course?.settings);
      const currentUsage = await getTotalUsage(courseId);
      const delta = content.trim().length - (existing.content?.length || 0);

      if (currentUsage + delta > maxChars) {
        res.status(400).json({
          error: {
            code: "MEMORY_FULL",
            message: `Updating this memory would exceed the ${maxChars} character limit`,
          },
        });
        return;
      }

      const { data: memory, error } = await supabase
        .from("ai_chat_memories")
        .update({
          content: content.trim(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("course_id", courseId)
        .select("id, content, source, created_by, created_at, updated_at")
        .single();

      if (error) {
        res.status(500).json({
          error: { code: "DB_ERROR", message: error.message },
        });
        return;
      }

      res.json({ memory });
    } catch (error: any) {
      logger.error("Error updating AI memory", { error: error.message });
      res.status(500).json({
        error: { code: "SERVER_ERROR", message: "Failed to update memory" },
      });
    }
  }
);

/**
 * DELETE /course/:courseId/ai-memories/:id
 * Delete a memory entry
 */
router.delete(
  "/course/:courseId/ai-memories/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId, id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Check permissions
      if (!isAdmin) {
        const permissions = await getCoursePermissions(userId, courseId, false);
        if (!permissions.canManage) {
          res.status(403).json({
            error: { code: "INSUFFICIENT_PERMISSIONS", message: "Instructor access required" },
          });
          return;
        }
      }

      const { error } = await supabase
        .from("ai_chat_memories")
        .delete()
        .eq("id", id)
        .eq("course_id", courseId);

      if (error) {
        res.status(500).json({
          error: { code: "DB_ERROR", message: error.message },
        });
        return;
      }

      res.json({ message: "Memory deleted" });
    } catch (error: any) {
      logger.error("Error deleting AI memory", { error: error.message });
      res.status(500).json({
        error: { code: "SERVER_ERROR", message: "Failed to delete memory" },
      });
    }
  }
);

export default router;
