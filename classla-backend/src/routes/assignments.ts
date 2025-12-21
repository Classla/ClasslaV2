import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import {
  requireCoursePermission,
  getCoursePermissions,
  getUserCourseRole,
  hasTAPermission,
  isOrganizationMember,
  getAssignmentContext,
  checkCourseOrTemplateAccess,
} from "../middleware/authorization";
import { UserRole } from "../types/enums";
import { Assignment } from "../types/entities";

const router = Router();

/**
 * Filter assignment content for student view
 * Removes autograder data and other instructor-only content
 * Specifically removes correct answer information from MCQ blocks
 */
const filterAssignmentContentForStudent = (content: string): string => {
  try {
    // Parse the TipTap editor content
    const parsedContent = JSON.parse(content);

    // If it's not a valid JSON structure, return as-is
    if (!parsedContent || typeof parsedContent !== "object") {
      return content;
    }

    // Recursively filter content blocks
    const filterBlocks = (blocks: any[]): any[] => {
      if (!Array.isArray(blocks)) return blocks;

      return blocks
        .filter((block) => {
          // Remove AIblocks - these are editor-only blocks
          if (block.type === "aiBlock") {
            return false;
          }

          // Remove blocks marked as autograder-only
          if (block.attrs?.autograderOnly === true) {
            return false;
          }

          // Remove blocks with instructor-only content
          if (block.attrs?.instructorOnly === true) {
            return false;
          }

          return true;
        })
        .map((block) => {
          // Recursively filter nested content
          if (block.content && Array.isArray(block.content)) {
            block.content = filterBlocks(block.content);
          }

          // Remove autograder-specific attributes
          if (block.attrs) {
            const {
              autograderData,
              correctAnswer,
              graderNotes,
              ...filteredAttrs
            } = block.attrs;
            block.attrs = filteredAttrs;
          }

          // Filter MCQ blocks to remove correct answer information
          if (block.type === "mcqBlock" && block.attrs?.mcqData) {
            const mcqData = block.attrs.mcqData;

            // Remove isCorrect from all options
            if (mcqData.options && Array.isArray(mcqData.options)) {
              mcqData.options = mcqData.options.map((option: any) => {
                const { isCorrect, ...filteredOption } = option;
                return {
                  ...filteredOption,
                  isCorrect: false, // Always set to false for students
                };
              });
            }

            // Remove explanation (can contain answer hints)
            delete mcqData.explanation;

            block.attrs.mcqData = mcqData;
          }

          // Filter Fill-in-the-Blank blocks to remove correct answers
          if (block.type === "fillInTheBlankBlock" && block.attrs?.fillInTheBlankData) {
            const fillInTheBlankData = block.attrs.fillInTheBlankData;

            // Remove acceptedAnswers and feedback from each blank
            if (fillInTheBlankData.blanks && Array.isArray(fillInTheBlankData.blanks)) {
              fillInTheBlankData.blanks = fillInTheBlankData.blanks.map((blank: any) => {
                const { acceptedAnswers, feedback, ...filteredBlank } = blank;
                return filteredBlank;
              });
            }

            // Remove general feedback
            delete fillInTheBlankData.generalFeedback;

            block.attrs.fillInTheBlankData = fillInTheBlankData;
          }

          // Filter Short Answer blocks to remove autograder information
          if (block.type === "shortAnswerBlock" && block.attrs?.shortAnswerData) {
            const shortAnswerData = block.attrs.shortAnswerData;

            // Remove sample answer (hidden from students)
            delete shortAnswerData.sampleAnswer;

            // If autograding is enabled, remove keyword matches and regex pattern
            if (shortAnswerData.gradingType === "keyword" || shortAnswerData.gradingType === "regex") {
              delete shortAnswerData.keywordMatches;
              delete shortAnswerData.regexPattern;
              delete shortAnswerData.caseSensitive;
            }

            block.attrs.shortAnswerData = shortAnswerData;
          }

          // Filter Parsons Problem blocks to remove correct solution
          if (block.type === "parsonsProblemBlock" && block.attrs?.parsonsProblemData) {
            const parsonsProblemData = block.attrs.parsonsProblemData;

            // Remove correct solution (students should only see shuffled blocks)
            delete parsonsProblemData.correctSolution;

            // For students, we need to provide blocks but without revealing correct order/indentation
            // The blocks array contains the correct solution, so we'll create a shuffled version
            // that includes both correct blocks and distractors, but without revealing which is which
            if (parsonsProblemData.blocks && Array.isArray(parsonsProblemData.blocks)) {
              // Create a shuffled array of all blocks (correct + distractors) with reset indent levels
              const allBlocks = [
                ...parsonsProblemData.blocks.map((b: any) => ({
                  id: b.id,
                  code: b.code,
                  indentLevel: 0, // Reset indent level - don't reveal correct indentation
                })),
                ...(parsonsProblemData.distractorBlocks || []).map((d: any) => ({
                  id: d.id,
                  code: d.code,
                  indentLevel: 0,
                })),
              ];
              
              // Shuffle the blocks
              const shuffled = allBlocks.sort(() => Math.random() - 0.5);
              
              // Replace blocks with shuffled version (students can't tell which are correct)
              parsonsProblemData.blocks = shuffled;
            }

            block.attrs.parsonsProblemData = parsonsProblemData;
          }

          // Filter Code Selection blocks to remove correct line information
          if (block.type === "clickableAreaBlock" && block.attrs?.clickableAreaData) {
            const clickableAreaData = block.attrs.clickableAreaData;

            // Remove isCorrect from all lines
            if (clickableAreaData.lines && Array.isArray(clickableAreaData.lines)) {
              clickableAreaData.lines = clickableAreaData.lines.map((line: any) => {
                const { isCorrect, ...filteredLine } = line;
                return {
                  ...filteredLine,
                  isCorrect: false, // Always set to false for students
                };
              });
            }

            block.attrs.clickableAreaData = clickableAreaData;
          }

          // Filter Drag-and-Drop Matching blocks to remove correct matches
          if (block.type === "dragDropMatchingBlock" && block.attrs?.dragDropMatchingData) {
            const dragDropMatchingData = block.attrs.dragDropMatchingData;

            // Remove correctItemIds from all target zones
            if (dragDropMatchingData.targetZones && Array.isArray(dragDropMatchingData.targetZones)) {
              dragDropMatchingData.targetZones = dragDropMatchingData.targetZones.map((zone: any) => {
                const { correctItemIds, ...filteredZone } = zone;
                return {
                  ...filteredZone,
                  correctItemIds: [], // Empty array for students
                };
              });
            }

            block.attrs.dragDropMatchingData = dragDropMatchingData;
          }

          return block;
        });
    };

    // Filter the main content
    if (parsedContent.content && Array.isArray(parsedContent.content)) {
      parsedContent.content = filterBlocks(parsedContent.content);
    }

    return JSON.stringify(parsedContent);
  } catch (error) {
    // If parsing fails, return original content
    console.warn("Failed to parse assignment content for filtering:", error);
    return content;
  }
};


/**
 * Check if user can access assignment based on lockdown settings
 */
const checkLockdownAccess = (
  assignment: Assignment,
  userId: string
): { canAccess: boolean; message?: string } => {
  if (!assignment.is_lockdown) {
    return { canAccess: true };
  }

  const userLockdownTime = assignment.lockdown_time_map[userId];

  if (userLockdownTime === undefined) {
    return {
      canAccess: false,
      message: "No lockdown time configured for this user",
    };
  }

  const currentTime = Math.floor(Date.now() / 1000); // Current time in seconds
  const lockdownEndTime = userLockdownTime;

  if (currentTime > lockdownEndTime) {
    return {
      canAccess: false,
      message: "Lockdown period has expired",
    };
  }

  return { canAccess: true };
};

/**
 * GET /course/:courseId/assignments
 * Get all assignments for a course with role-based filtering
 */
router.get(
  "/course/:courseId/assignments",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { courseId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(courseId, userId, isAdmin ?? false);

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: access.isTemplate
              ? "Not authorized to access assignments for this template"
              : "Not authorized to access assignments for this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get user's role - for templates, treat as instructor
      let userRole: UserRole;
      if (access.isTemplate) {
        userRole = UserRole.INSTRUCTOR;
      } else {
        userRole = (await getUserCourseRole(userId, courseId)) || UserRole.STUDENT;
      }

      // Get all assignments for the course or template
      let query = supabase
        .from("assignments")
        .select("*");
      
      if (access.isTemplate) {
        query = query.eq("template_id", courseId);
      } else {
        query = query.eq("course_id", courseId);
      }
      
      const { data: assignments, error: assignmentsError } = await query
        .order("created_at", { ascending: true });

      if (assignmentsError) {
        throw assignmentsError;
      }

      if (!assignments) {
        res.json([]);
        return;
      }

      // Filter assignments based on user role
      let filteredAssignments = assignments;

      if (userRole === UserRole.STUDENT || userRole === UserRole.AUDIT) {
        // Filter to only published assignments
        filteredAssignments = assignments.filter((assignment) => {
          // If published_to is empty, the assignment is not published (draft state)
          if (
            !assignment.published_to ||
            assignment.published_to.length === 0
          ) {
            return false;
          }

          // Check if this user's ID is in the published_to list
          // published_to only contains user IDs, never course or section IDs
          return assignment.published_to.includes(userId);
        });

        // Filter content for students
        filteredAssignments = filteredAssignments.map((assignment) => ({
          ...assignment,
          content: filterAssignmentContentForStudent(assignment.content),
        }));
      }

      res.json(filteredAssignments);
    } catch (error) {
      console.error("Error retrieving course assignments:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve course assignments",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /assignment/:id/student
 * Get assignment with filtered content for student view
 * Requirements: 3.5, 7.2
 */
router.get(
  "/assignment/:id/student",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the assignment
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", id)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check course permissions
      const permissions = await getCoursePermissions(
        userId,
        assignment.course_id,
        isAdmin
      );

      if (!permissions.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to access this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get assignment context (course or template)
      const context = getAssignmentContext(assignment);
      
      // Get user's role - for templates, treat as instructor
      const userRole = context.isTemplate
        ? UserRole.INSTRUCTOR
        : (await getUserCourseRole(userId, context.id)) || UserRole.STUDENT;

      // For students and audit users, apply content filtering and lockdown checks
      if (userRole === UserRole.STUDENT || userRole === UserRole.AUDIT) {
        // Check lockdown restrictions
        const lockdownCheck = checkLockdownAccess(assignment, userId);
        if (!lockdownCheck.canAccess) {
          res.status(403).json({
            error: {
              code: "LOCKDOWN_RESTRICTION",
              message:
                lockdownCheck.message || "Assignment is in lockdown mode",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }

        // Filter content for student view
        const filteredAssignment = {
          ...assignment,
          content: filterAssignmentContentForStudent(assignment.content),
        };

        res.json(filteredAssignment);
      } else {
        // Instructors and TAs get full content
        res.json(assignment);
      }
    } catch (error) {
      console.error("Error retrieving assignment for student:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve assignment",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /assignment/:id
 * Get assignment with full content for instructor view
 * Requirements: 3.5, 7.2
 */
router.get(
  "/assignment/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the assignment
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", id)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get assignment context (course or template)
      const context = getAssignmentContext(assignment);
      
      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(
        context.id,
        userId,
        isAdmin ?? false
      );

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: access.isTemplate
              ? "Not authorized to access this assignment in template"
              : "Not authorized to access this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get user's role - for templates, treat as instructor
      const userRole = access.isTemplate
        ? UserRole.INSTRUCTOR
        : (await getUserCourseRole(userId, context.id)) || UserRole.STUDENT;

      // Only instructors, TAs, and admins get full content through this endpoint
      if (
        userRole === UserRole.INSTRUCTOR ||
        userRole === UserRole.TEACHING_ASSISTANT ||
        isAdmin
      ) {
        res.json(assignment);
      } else {
        // Students should use the /student endpoint
        res.status(403).json({
          error: {
            code: "USE_STUDENT_ENDPOINT",
            message: "Students should use /assignment/:id/student endpoint",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
      }
    } catch (error) {
      console.error("Error retrieving assignment:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve assignment",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /assignment
 * Create new assignment with rich content support
 * Requirements: 3.1, 3.2, 7.3
 */
router.post(
  "/assignment",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        name,
        course_id,
        settings,
        content,
        published_to,
        due_dates_map,
        module_path,
        is_lockdown,
        lockdown_time_map,
        order_index,
      } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(course_id, userId, isAdmin ?? false);
      
      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: access.isTemplate
              ? "Not authorized to create assignments in this template"
              : "Not authorized to create assignments in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get user's role - for templates, treat as instructor
      const userRole = access.isTemplate
        ? UserRole.INSTRUCTOR
        : (await getUserCourseRole(userId, course_id)) || UserRole.STUDENT;
      
      const permissions = access.permissions || { canRead: true, canWrite: true, canGrade: false, canManage: true };

      console.log(`[POST /assignment] Permission check:`, {
        userId,
        course_id,
        userRole,
        isAdmin,
        permissions,
        isTemplate: access.isTemplate,
      });

      if (userRole === UserRole.TEACHING_ASSISTANT && !access.isTemplate) {
        const canCreate = await hasTAPermission(userId, course_id, "canCreate");
        console.log(`[POST /assignment] TA canCreate check:`, { canCreate });
        if (!canCreate) {
          res.status(403).json({
            error: {
              code: "INSUFFICIENT_PERMISSIONS",
              message: "Not authorized to create assignments in this course",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      } else if (!permissions.canManage && !isAdmin) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to create assignments in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate required fields
      if (!name || !course_id) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "Name and course_id are required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate content is valid JSON if provided
      if (content) {
        try {
          JSON.parse(content);
        } catch (error) {
          res.status(400).json({
            error: {
              code: "INVALID_CONTENT_FORMAT",
              message: "Content must be valid JSON",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Validate published_to sections exist if provided
      // For templates, skip section validation (templates don't have sections)
      if (
        published_to &&
        Array.isArray(published_to) &&
        published_to.length > 0 &&
        !access.isTemplate
      ) {
        const { data: sections, error: sectionsError } = await supabase
          .from("sections")
          .select("id, course_id")
          .in("id", published_to);

        if (sectionsError) {
          throw sectionsError;
        }

        // Check if all sections belong to the same course
        const invalidSections = sections?.filter(
          (section) => section.course_id !== course_id
        );
        if (invalidSections && invalidSections.length > 0) {
          res.status(400).json({
            error: {
              code: "INVALID_SECTIONS",
              message: "All published sections must belong to the same course",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Create the assignment with default settings
      const defaultSettings = {
        showResponsesAfterSubmission: true, // Default to showing responses
        allowLateSubmissions: false,
        allowResubmissions: false,
        ...settings, // Allow override from request
      };

      // Prepare insert data - use template_id if it's a template, otherwise course_id
      const insertData: any = {
        name,
        settings: defaultSettings,
        content: content || "",
        published_to: published_to || [],
        due_dates_map: due_dates_map || {},
        module_path: module_path || [],
        is_lockdown: is_lockdown || false,
        lockdown_time_map: lockdown_time_map || {},
        order_index: order_index || 0,
      };

      if (access.isTemplate) {
        insertData.template_id = course_id; // course_id is actually template_id in this case
        insertData.course_id = null;
      } else {
        insertData.course_id = course_id;
        insertData.template_id = null;
      }

      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .insert(insertData)
        .select()
        .single();

      if (assignmentError) {
        throw assignmentError;
      }

      res.status(201).json(assignment);
    } catch (error) {
      console.error("Error creating assignment:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create assignment",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /assignment/:id
 * Update assignment with rich content support
 * Requirements: 3.1, 3.2, 7.3
 */
router.put(
  "/assignment/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const {
        name,
        settings,
        content,
        published_to,
        due_dates_map,
        module_path,
        is_lockdown,
        lockdown_time_map,
        order_index,
      } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Get the existing assignment
      const { data: existingAssignment, error: existingError } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", id)
        .single();

      if (existingError || !existingAssignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get assignment context (course or template)
      const context = getAssignmentContext(existingAssignment);
      
      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(
        context.id,
        userId,
        isAdmin ?? false
      );

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: access.isTemplate
              ? "Not authorized to edit this assignment in template"
              : "Not authorized to edit this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get user's role - for templates, treat as instructor
      const userRole = access.isTemplate
        ? UserRole.INSTRUCTOR
        : (await getUserCourseRole(userId, context.id)) || UserRole.STUDENT;

      // Check permissions - instructors/admins can always edit, TAs need canEdit permission
      if (userRole === UserRole.TEACHING_ASSISTANT && !access.isTemplate) {
        const canEdit = await hasTAPermission(userId, context.id, "canEdit");
        if (!canEdit) {
          res.status(403).json({
            error: {
              code: "INSUFFICIENT_PERMISSIONS",
              message: "Not authorized to edit assignments in this course",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      } else if (!access.permissions?.canManage && !isAdmin) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to update this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate content is valid JSON if provided
      if (content) {
        try {
          JSON.parse(content);
        } catch (error) {
          res.status(400).json({
            error: {
              code: "INVALID_CONTENT_FORMAT",
              message: "Content must be valid JSON",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Validate published_to sections exist if provided
      if (
        published_to &&
        Array.isArray(published_to) &&
        published_to.length > 0
      ) {
        const { data: sections, error: sectionsError } = await supabase
          .from("sections")
          .select("id, course_id")
          .in("id", published_to);

        if (sectionsError) {
          throw sectionsError;
        }

        // Check if all sections belong to the same course/template
        // For templates, skip section validation (templates don't have sections)
        const context = getAssignmentContext(existingAssignment);
        const invalidSections = context.isTemplate
          ? []
          : sections?.filter((section) => section.course_id !== context.id) || [];
        if (invalidSections && invalidSections.length > 0) {
          res.status(400).json({
            error: {
              code: "INVALID_SECTIONS",
              message: "All published sections must belong to the same course",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Prepare update data
      const updateData: Partial<Assignment> = {};

      if (name !== undefined) updateData.name = name;
      if (settings !== undefined) updateData.settings = settings;
      if (content !== undefined) updateData.content = content;
      if (published_to !== undefined) updateData.published_to = published_to;
      if (due_dates_map !== undefined) updateData.due_dates_map = due_dates_map;
      if (module_path !== undefined) updateData.module_path = module_path;
      if (is_lockdown !== undefined) updateData.is_lockdown = is_lockdown;
      if (lockdown_time_map !== undefined)
        updateData.lockdown_time_map = lockdown_time_map;
      if (order_index !== undefined) updateData.order_index = order_index;

      // Update the assignment
      const { data: updatedAssignment, error: updateError } = await supabase
        .from("assignments")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json(updatedAssignment);
    } catch (error) {
      console.error("Error updating assignment:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update assignment",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * DELETE /assignment/:id
 * Delete assignment with proper authorization
 * Requirements: 3.1, 3.2, 7.3
 */
router.delete(
  "/assignment/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the existing assignment
      const { data: existingAssignment, error: existingError } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", id)
        .single();

      if (existingError || !existingAssignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get assignment context (course or template)
      const context = getAssignmentContext(existingAssignment);
      
      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(
        context.id,
        userId,
        isAdmin ?? false
      );

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: access.isTemplate
              ? "Not authorized to delete this assignment in template"
              : "Not authorized to delete this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get user's role - for templates, treat as instructor
      const userRole = access.isTemplate
        ? UserRole.INSTRUCTOR
        : (await getUserCourseRole(userId, context.id)) || UserRole.STUDENT;

      // Check permissions - instructors/admins can always delete, TAs need canDelete permission
      if (userRole === UserRole.TEACHING_ASSISTANT && !access.isTemplate) {
        const canDelete = await hasTAPermission(userId, context.id, "canDelete");
        if (!canDelete) {
          res.status(403).json({
            error: {
              code: "INSUFFICIENT_PERMISSIONS",
              message: "Not authorized to delete assignments in this course",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      } else if (!access.permissions?.canManage && !isAdmin) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to delete this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Delete the assignment (hard delete since there's no deleted_at field in the schema)
      const { error: deleteError } = await supabase
        .from("assignments")
        .delete()
        .eq("id", id);

      if (deleteError) {
        throw deleteError;
      }

      res.json({
        message: "Assignment deleted successfully",
        assignment_id: id,
      });
    } catch (error) {
      console.error("Error deleting assignment:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete assignment",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /assignment/:id/due-date/:userId
 * Get due date for a specific user for an assignment
 * Requirements: 3.3, 3.4
 */
router.get(
  "/assignment/:id/due-date/:userId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, userId: targetUserId } = req.params;
      const { id: currentUserId, isAdmin } = req.user!;

      // Get the assignment
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", id)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check permissions
      const permissions = await getCoursePermissions(
        currentUserId,
        assignment.course_id,
        isAdmin
      );

      if (!permissions.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to access this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Students can only check their own due dates unless they have elevated permissions
      if (currentUserId !== targetUserId && !permissions.canGrade && !isAdmin) {
        res.status(403).json({
          error: {
            code: "ACCESS_DENIED",
            message: "Can only access own due date information",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the due date for the specific user
      const userDueDate = assignment.due_dates_map[targetUserId];

      res.json({
        assignment_id: id,
        user_id: targetUserId,
        due_date: userDueDate || null,
        has_custom_due_date: !!userDueDate,
      });
    } catch (error) {
      console.error("Error retrieving due date:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve due date",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /assignment/:id/due-date/:userId
 * Set due date for a specific user for an assignment
 * Requirements: 3.3, 3.4
 */
router.put(
  "/assignment/:id/due-date/:userId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, userId: targetUserId } = req.params;
      const { due_date } = req.body;
      const { id: currentUserId, isAdmin } = req.user!;

      // Validate due_date format
      if (due_date && isNaN(Date.parse(due_date))) {
        res.status(400).json({
          error: {
            code: "INVALID_DATE_FORMAT",
            message: "Due date must be a valid ISO date string",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the assignment
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", id)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get assignment context (course or template)
      const context = getAssignmentContext(assignment);
      
      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(
        context.id,
        currentUserId,
        isAdmin ?? false
      );

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: access.isTemplate
              ? "Not authorized to set due dates for this assignment in template"
              : "Not authorized to set due dates for this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const permissions = access.permissions || { canRead: true, canWrite: true, canGrade: false, canManage: true };

      if (!permissions.canManage && !permissions.canGrade) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to set due dates for this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Update the due dates map
      const updatedDueDatesMap = { ...assignment.due_dates_map };

      if (due_date === null || due_date === undefined) {
        // Remove the due date for this user
        delete updatedDueDatesMap[targetUserId];
      } else {
        // Set the due date for this user
        updatedDueDatesMap[targetUserId] = new Date(due_date).toISOString();
      }

      // Update the assignment
      const { data: updatedAssignment, error: updateError } = await supabase
        .from("assignments")
        .update({ due_dates_map: updatedDueDatesMap })
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json({
        assignment_id: id,
        user_id: targetUserId,
        due_date: updatedDueDatesMap[targetUserId] || null,
        message: due_date
          ? "Due date set successfully"
          : "Due date removed successfully",
      });
    } catch (error) {
      console.error("Error setting due date:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to set due date",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /assignment/:id/lockdown-status/:userId
 * Get lockdown status for a specific user for an assignment
 * Requirements: 3.3, 3.4
 */
router.get(
  "/assignment/:id/lockdown-status/:userId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, userId: targetUserId } = req.params;
      const { id: currentUserId, isAdmin } = req.user!;

      // Get the assignment
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", id)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check permissions
      const permissions = await getCoursePermissions(
        currentUserId,
        assignment.course_id,
        isAdmin
      );

      if (!permissions.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to access this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Students can only check their own lockdown status unless they have elevated permissions
      if (currentUserId !== targetUserId && !permissions.canGrade && !isAdmin) {
        res.status(403).json({
          error: {
            code: "ACCESS_DENIED",
            message: "Can only access own lockdown status",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      if (!assignment.is_lockdown) {
        res.json({
          assignment_id: id,
          user_id: targetUserId,
          is_lockdown: false,
          lockdown_time: null,
          time_remaining: null,
          can_access: true,
        });
        return;
      }

      const userLockdownTime = assignment.lockdown_time_map[targetUserId];
      const currentTime = Math.floor(Date.now() / 1000);

      let timeRemaining = null;
      let canAccess = false;

      if (userLockdownTime !== undefined) {
        timeRemaining = Math.max(0, userLockdownTime - currentTime);
        canAccess = timeRemaining > 0;
      }

      res.json({
        assignment_id: id,
        user_id: targetUserId,
        is_lockdown: true,
        lockdown_time: userLockdownTime || null,
        time_remaining: timeRemaining,
        can_access: canAccess,
      });
    } catch (error) {
      console.error("Error retrieving lockdown status:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve lockdown status",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /assignment/:id/lockdown-time/:userId
 * Set lockdown time for a specific user for an assignment
 * Requirements: 3.3, 3.4
 */
router.put(
  "/assignment/:id/lockdown-time/:userId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id, userId: targetUserId } = req.params;
      const { lockdown_time_seconds } = req.body;
      const { id: currentUserId, isAdmin } = req.user!;

      // Validate lockdown_time_seconds
      if (
        lockdown_time_seconds !== null &&
        lockdown_time_seconds !== undefined
      ) {
        if (
          typeof lockdown_time_seconds !== "number" ||
          lockdown_time_seconds < 0
        ) {
          res.status(400).json({
            error: {
              code: "INVALID_LOCKDOWN_TIME",
              message: "Lockdown time must be a non-negative number (seconds)",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Get the assignment
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("*")
        .eq("id", id)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get assignment context (course or template)
      const context = getAssignmentContext(assignment);
      
      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(
        context.id,
        currentUserId,
        isAdmin ?? false
      );

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: access.isTemplate
              ? "Not authorized to set lockdown times for this assignment in template"
              : "Not authorized to set lockdown times for this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const permissions = access.permissions || { canRead: true, canWrite: true, canGrade: false, canManage: true };

      if (!permissions.canManage && !permissions.canGrade) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to set lockdown times for this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Update the lockdown time map
      const updatedLockdownTimeMap = { ...assignment.lockdown_time_map };

      if (
        lockdown_time_seconds === null ||
        lockdown_time_seconds === undefined
      ) {
        // Remove the lockdown time for this user
        delete updatedLockdownTimeMap[targetUserId];
      } else {
        // Set the lockdown time for this user (convert to absolute timestamp)
        const currentTime = Math.floor(Date.now() / 1000);
        updatedLockdownTimeMap[targetUserId] =
          currentTime + lockdown_time_seconds;
      }

      // Update the assignment
      const { data: updatedAssignment, error: updateError } = await supabase
        .from("assignments")
        .update({ lockdown_time_map: updatedLockdownTimeMap })
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json({
        assignment_id: id,
        user_id: targetUserId,
        lockdown_time: updatedLockdownTimeMap[targetUserId] || null,
        lockdown_duration_seconds: lockdown_time_seconds,
        message: lockdown_time_seconds
          ? "Lockdown time set successfully"
          : "Lockdown time removed successfully",
      });
    } catch (error) {
      console.error("Error setting lockdown time:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to set lockdown time",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /assignment/:id/duplicate
 * Duplicate assignment within the same course/template
 */
router.post(
  "/assignment/:id/duplicate",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the existing assignment
      const { data: existingAssignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("course_id, template_id, name, settings, content, module_path, is_lockdown, order_index")
        .eq("id", id)
        .single();

      if (assignmentError || !existingAssignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get assignment context (course or template)
      const context = getAssignmentContext(existingAssignment);
      
      // Check access (handles both courses and templates)
      const access = await checkCourseOrTemplateAccess(
        context.id,
        userId,
        isAdmin ?? false
      );

      if (!access.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to duplicate this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      const permissions = access.permissions || { canRead: true, canWrite: true, canGrade: false, canManage: true };

      // Check if user can create assignments
      if (!permissions.canManage && !isAdmin) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to create assignments",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Create duplicate assignment
      const insertData: any = {
        name: `${existingAssignment.name} (Copy)`,
        settings: existingAssignment.settings || {},
        content: existingAssignment.content || "",
        published_to: [], // Don't copy published_to
        due_dates_map: {}, // Don't copy due dates
        module_path: existingAssignment.module_path || [],
        is_lockdown: existingAssignment.is_lockdown || false,
        lockdown_time_map: {}, // Don't copy lockdown times
        order_index: (existingAssignment.order_index || 0) + 1, // Place after original
      };

      if (context.isTemplate) {
        insertData.template_id = context.id;
        insertData.course_id = null;
      } else {
        insertData.course_id = context.id;
        insertData.template_id = null;
      }

      const { data: newAssignment, error: createError } = await supabase
        .from("assignments")
        .insert(insertData)
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      res.status(201).json(newAssignment);
    } catch (error) {
      console.error("Error duplicating assignment:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to duplicate assignment",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /assignment/:id/clone-to-course
 * Clone assignment to another course
 */
router.post(
  "/assignment/:id/clone-to-course",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { targetCourseId } = req.body;
      const { id: userId, isAdmin } = req.user!;

      if (!targetCourseId) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "targetCourseId is required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the existing assignment
      const { data: existingAssignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("course_id, template_id, name, settings, content, module_path, is_lockdown, order_index")
        .eq("id", id)
        .single();

      if (assignmentError || !existingAssignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Assignment not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get assignment context (course or template)
      const sourceContext = getAssignmentContext(existingAssignment);
      
      // Check access to source (handles both courses and templates)
      const sourceAccess = await checkCourseOrTemplateAccess(
        sourceContext.id,
        userId,
        isAdmin ?? false
      );

      if (!sourceAccess.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to access source assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Only instructors/admins can clone (not TAs)
      const sourcePermissions = sourceAccess.permissions || { canRead: true, canWrite: true, canGrade: false, canManage: true };
      if (!sourcePermissions.canManage && !isAdmin) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Only instructors and admins can clone assignments",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check access to target course
      const targetAccess = await checkCourseOrTemplateAccess(
        targetCourseId,
        userId,
        isAdmin ?? false
      );

      if (!targetAccess.canRead) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to access target course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // For target course, check if user has create permission
      // TAs can clone TO a course if they have canCreate permission
      if (!targetAccess.isTemplate) {
        const targetUserRole = await getUserCourseRole(userId, targetCourseId);
        
        if (targetUserRole === UserRole.TEACHING_ASSISTANT) {
          const canCreate = await hasTAPermission(userId, targetCourseId, "canCreate");
          if (!canCreate) {
            res.status(403).json({
              error: {
                code: "INSUFFICIENT_PERMISSIONS",
                message: "Not authorized to create assignments in target course",
                timestamp: new Date().toISOString(),
                path: req.path,
              },
            });
            return;
          }
        } else if (targetUserRole !== UserRole.INSTRUCTOR && !isAdmin) {
          // Only instructors/admins/TAs with canCreate can clone to a course
          res.status(403).json({
            error: {
              code: "INSUFFICIENT_PERMISSIONS",
              message: "Not authorized to create assignments in target course",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }
      // For templates, organization membership is already checked by checkCourseOrTemplateAccess

      // Create cloned assignment in target course
      const insertData: any = {
        name: existingAssignment.name,
        settings: existingAssignment.settings || {},
        content: existingAssignment.content || "",
        published_to: [], // Don't copy published_to
        due_dates_map: {}, // Don't copy due dates
        module_path: existingAssignment.module_path || [],
        is_lockdown: existingAssignment.is_lockdown || false,
        lockdown_time_map: {}, // Don't copy lockdown times
        order_index: existingAssignment.order_index || 0,
      };

      if (targetAccess.isTemplate) {
        insertData.template_id = targetCourseId;
        insertData.course_id = null;
      } else {
        insertData.course_id = targetCourseId;
        insertData.template_id = null;
      }

      const { data: newAssignment, error: createError } = await supabase
        .from("assignments")
        .insert(insertData)
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      res.status(201).json(newAssignment);
    } catch (error) {
      console.error("Error cloning assignment to course:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to clone assignment to course",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
