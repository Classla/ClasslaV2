import { Router, Request, Response } from "express";
import { supabase } from "../middleware/auth";
import { authenticateToken } from "../middleware/auth";
import {
  getCoursePermissions,
  checkCourseOrTemplateAccess,
  getAssignmentContext,
} from "../middleware/authorization";
import { RubricSchema, Rubric, RubricItem } from "../types/entities";
import {
  CreateRubricSchemaRequest,
  CreateRubricRequest,
  UpdateRubricRequest,
} from "../types/api";

const router = Router();

/**
 * Calculate total rubric score from values and schema items
 * Requirements: 8.2, 8.3, 8.5
 */
const calculateRubricScore = (
  values: number[],
  items: RubricItem[]
): number => {
  if (values.length !== items.length) {
    throw new Error("Values array length must match items array length");
  }

  return values.reduce((total, value, index) => {
    const maxPoints = items[index].points;
    // Ensure value doesn't exceed max points for this item
    const clampedValue = Math.min(value, maxPoints);
    return total + clampedValue;
  }, 0);
};

/**
 * Update submission grade when rubric is used for grading
 * Requirements: 8.2, 8.3, 8.5
 */
const updateSubmissionGradeFromRubric = async (
  submissionId: string,
  rubricSchemaId: string,
  values: number[]
): Promise<void> => {
  // Get rubric schema to check if it's used for grading
  const { data: schema, error: schemaError } = await supabase
    .from("rubric_schemas")
    .select("use_for_grading, items")
    .eq("id", rubricSchemaId)
    .single();

  if (schemaError || !schema) {
    throw new Error("Rubric schema not found");
  }

  // Only update grade if rubric is used for grading
  if (schema.use_for_grading) {
    const totalScore = calculateRubricScore(values, schema.items);
    const maxPossibleScore = schema.items.reduce(
      (sum: number, item: RubricItem) => sum + item.points,
      0
    );

    // Calculate percentage grade (0-100)
    const gradePercentage =
      maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;

    // Update submission grade
    const { error: updateError } = await supabase
      .from("submissions")
      .update({
        grade: gradePercentage,
        status: "graded",
      })
      .eq("id", submissionId);

    if (updateError) {
      throw updateError;
    }
  }
};

/**
 * GET /rubric-schema/:assignmentId
 * Get rubric schema for assignment
 * Requirements: 8.1, 8.4
 */
router.get(
  "/rubric-schema/:assignmentId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { assignmentId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the assignment to check permissions
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("course_id, template_id")
        .eq("id", assignmentId)
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
            message:
              "Not authorized to access rubric schemas for this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get rubric schema for the assignment
      const { data: rubricSchema, error: schemaError } = await supabase
        .from("rubric_schemas")
        .select("*")
        .eq("assignment_id", assignmentId)
        .single();

      if (schemaError) {
        if (schemaError.code === "PGRST116") {
          // No rubric schema found - return null (not an error)
          res.json(null);
          return;
        }
        throw schemaError;
      }

      res.json(rubricSchema);
    } catch (error) {
      console.error("Error retrieving rubric schema:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve rubric schema",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /rubric-schema
 * Create rubric schema template (instructor only)
 * Requirements: 8.1, 8.4
 */
router.post(
  "/rubric-schema",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        assignment_id,
        title,
        type = "checkbox",
        use_for_grading = false,
        items,
      }: CreateRubricSchemaRequest = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Validate required fields
      if (
        !assignment_id ||
        !title ||
        !type ||
        !items ||
        !Array.isArray(items) ||
        items.length === 0
      ) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message: "assignment_id, title, type, and items array are required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate type
      if (type !== "checkbox" && type !== "numerical") {
        res.status(400).json({
          error: {
            code: "INVALID_RUBRIC_TYPE",
            message: 'Rubric type must be either "checkbox" or "numerical"',
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate rubric items
      for (const item of items) {
        if (!item.title || typeof item.points !== "number") {
          res.status(400).json({
            error: {
              code: "INVALID_RUBRIC_ITEMS",
              message: "Each rubric item must have a title and points value",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
        // For numerical rubrics, points must be non-negative
        // For checkbox rubrics, points can be negative (deductions)
        if (type === "numerical" && item.points < 0) {
          res.status(400).json({
            error: {
              code: "INVALID_RUBRIC_ITEMS",
              message: "Numerical rubric items must have non-negative points",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Get the assignment to check permissions
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("course_id, template_id")
        .eq("id", assignment_id)
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
            message:
              "Not authorized to create rubric schemas for this assignment",
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
            message:
              "Not authorized to create rubric schemas for this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if rubric schema already exists for this assignment
      const { data: existingSchema, error: existingError } = await supabase
        .from("rubric_schemas")
        .select("id")
        .eq("assignment_id", assignment_id)
        .single();

      if (existingSchema) {
        res.status(409).json({
          error: {
            code: "RUBRIC_SCHEMA_EXISTS",
            message: "A rubric schema already exists for this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Create the rubric schema
      const { data: rubricSchema, error: schemaError } = await supabase
        .from("rubric_schemas")
        .insert({
          assignment_id,
          title,
          type,
          use_for_grading,
          items,
        })
        .select()
        .single();

      if (schemaError) {
        throw schemaError;
      }

      res.status(201).json(rubricSchema);
    } catch (error) {
      console.error("Error creating rubric schema:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create rubric schema",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /rubric-schema/:id
 * Update rubric schema (instructor only)
 * Requirements: 8.1, 8.4
 */
router.put(
  "/rubric-schema/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { title, type, use_for_grading, items } = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Get the existing rubric schema
      const { data: existingSchema, error: existingError } = await supabase
        .from("rubric_schemas")
        .select("assignment_id, type")
        .eq("id", id)
        .single();

      if (existingError || !existingSchema) {
        res.status(404).json({
          error: {
            code: "RUBRIC_SCHEMA_NOT_FOUND",
            message: "Rubric schema not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the assignment to check permissions
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("course_id, template_id")
        .eq("id", existingSchema.assignment_id)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Associated assignment not found",
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
            message: "Not authorized to update rubric schemas for this assignment",
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
            message:
              "Not authorized to update rubric schemas for this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate type if provided
      if (type !== undefined && type !== "checkbox" && type !== "numerical") {
        res.status(400).json({
          error: {
            code: "INVALID_RUBRIC_TYPE",
            message: 'Rubric type must be either "checkbox" or "numerical"',
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate rubric items if provided
      if (items) {
        if (!Array.isArray(items) || items.length === 0) {
          res.status(400).json({
            error: {
              code: "INVALID_ITEMS",
              message: "Items must be a non-empty array",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }

        const rubricType = type || existingSchema.type;
        for (const item of items) {
          if (!item.title || typeof item.points !== "number") {
            res.status(400).json({
              error: {
                code: "INVALID_RUBRIC_ITEMS",
                message: "Each rubric item must have a title and points value",
                timestamp: new Date().toISOString(),
                path: req.path,
              },
            });
            return;
          }
          // For numerical rubrics, points must be non-negative
          if (rubricType === "numerical" && item.points < 0) {
            res.status(400).json({
              error: {
                code: "INVALID_RUBRIC_ITEMS",
                message: "Numerical rubric items must have non-negative points",
                timestamp: new Date().toISOString(),
                path: req.path,
              },
            });
            return;
          }
        }
      }

      // Prepare update data
      const updateData: Partial<RubricSchema> = {};
      if (title !== undefined) updateData.title = title;
      if (type !== undefined) updateData.type = type as any;
      if (use_for_grading !== undefined)
        updateData.use_for_grading = use_for_grading;
      if (items !== undefined) updateData.items = items;

      // Update the rubric schema
      const { data: updatedSchema, error: updateError } = await supabase
        .from("rubric_schemas")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      res.json(updatedSchema);
    } catch (error) {
      console.error("Error updating rubric schema:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update rubric schema",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * DELETE /rubric-schema/:id
 * Delete rubric schema (instructor only)
 * Requirements: 8.1, 8.4
 */
router.delete(
  "/rubric-schema/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the existing rubric schema
      const { data: existingSchema, error: existingError } = await supabase
        .from("rubric_schemas")
        .select("assignment_id")
        .eq("id", id)
        .single();

      if (existingError || !existingSchema) {
        res.status(404).json({
          error: {
            code: "RUBRIC_SCHEMA_NOT_FOUND",
            message: "Rubric schema not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the assignment to check permissions
      const { data: assignment, error: assignmentError } = await supabase
        .from("assignments")
        .select("course_id, template_id")
        .eq("id", existingSchema.assignment_id)
        .single();

      if (assignmentError || !assignment) {
        res.status(404).json({
          error: {
            code: "ASSIGNMENT_NOT_FOUND",
            message: "Associated assignment not found",
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
            message: "Not authorized to update rubric schemas for this assignment",
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
            message:
              "Not authorized to delete rubric schemas for this assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if there are any rubric instances using this schema
      const { data: rubricInstances, error: instancesError } = await supabase
        .from("rubrics")
        .select("id")
        .eq("rubric_schema_id", id)
        .limit(1);

      if (instancesError) {
        throw instancesError;
      }

      if (rubricInstances && rubricInstances.length > 0) {
        res.status(409).json({
          error: {
            code: "RUBRIC_SCHEMA_IN_USE",
            message:
              "Cannot delete rubric schema that is being used by rubric instances",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Delete the rubric schema
      const { error: deleteError } = await supabase
        .from("rubric_schemas")
        .delete()
        .eq("id", id);

      if (deleteError) {
        throw deleteError;
      }

      res.status(204).send();
    } catch (error) {
      console.error("Error deleting rubric schema:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete rubric schema",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /rubric/:submissionId
 * Get rubric scores for submission
 * Requirements: 8.2, 8.3, 8.5
 */
router.get(
  "/rubric/:submissionId",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { submissionId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the submission to check permissions
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("student_id, course_id")
        .eq("id", submissionId)
        .single();

      if (submissionError || !submission) {
        res.status(404).json({
          error: {
            code: "SUBMISSION_NOT_FOUND",
            message: "Submission not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check permissions
      const permissions = await getCoursePermissions(
        userId,
        submission.course_id,
        isAdmin
      );

      // Students can only access rubrics for their own submissions
      if (
        submission.student_id !== userId &&
        !permissions.canGrade &&
        !permissions.canManage
      ) {
        res.status(403).json({
          error: {
            code: "ACCESS_DENIED",
            message:
              "Can only access rubrics for own submissions or need grading permissions",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get rubric for the submission
      const { data: rubric, error: rubricError } = await supabase
        .from("rubrics")
        .select(
          `
        *,
        rubric_schemas!inner(
          id,
          title,
          use_for_grading,
          items
        )
      `
        )
        .eq("submission_id", submissionId)
        .single();

      if (rubricError) {
        if (rubricError.code === "PGRST116") {
          // No rubric found
          res.status(404).json({
            error: {
              code: "RUBRIC_NOT_FOUND",
              message: "No rubric found for this submission",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
        throw rubricError;
      }

      res.json(rubric);
    } catch (error) {
      console.error("Error retrieving rubric:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to retrieve rubric",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * POST /rubric
 * Apply rubric to submission (instructor/TA only)
 * Requirements: 8.2, 8.3, 8.5
 */
router.post(
  "/rubric",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { submission_id, rubric_schema_id, values }: CreateRubricRequest =
        req.body;
      const { id: userId, isAdmin } = req.user!;

      // Validate required fields
      if (
        !submission_id ||
        !rubric_schema_id ||
        !values ||
        !Array.isArray(values)
      ) {
        res.status(400).json({
          error: {
            code: "MISSING_REQUIRED_FIELDS",
            message:
              "submission_id, rubric_schema_id, and values array are required",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate values are numbers
      for (const value of values) {
        if (typeof value !== "number" || value < 0) {
          res.status(400).json({
            error: {
              code: "INVALID_VALUES",
              message: "All rubric values must be non-negative numbers",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Get the submission to check permissions
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("student_id, course_id, assignment_id")
        .eq("id", submission_id)
        .single();

      if (submissionError || !submission) {
        res.status(404).json({
          error: {
            code: "SUBMISSION_NOT_FOUND",
            message: "Submission not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check grading permissions
      const permissions = await getCoursePermissions(
        userId,
        submission.course_id,
        isAdmin
      );

      if (!permissions.canGrade && !permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message:
              "Not authorized to apply rubrics to submissions in this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate rubric schema exists and belongs to the assignment
      const { data: rubricSchema, error: schemaError } = await supabase
        .from("rubric_schemas")
        .select("assignment_id, items")
        .eq("id", rubric_schema_id)
        .single();

      if (schemaError || !rubricSchema) {
        res.status(404).json({
          error: {
            code: "RUBRIC_SCHEMA_NOT_FOUND",
            message: "Rubric schema not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      if (rubricSchema.assignment_id !== submission.assignment_id) {
        res.status(400).json({
          error: {
            code: "RUBRIC_ASSIGNMENT_MISMATCH",
            message:
              "Rubric schema does not belong to the submission's assignment",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate values array length matches rubric items
      if (values.length !== rubricSchema.items.length) {
        res.status(400).json({
          error: {
            code: "VALUES_LENGTH_MISMATCH",
            message: `Expected ${rubricSchema.items.length} values, got ${values.length}`,
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check if rubric already exists for this submission
      const { data: existingRubric, error: existingError } = await supabase
        .from("rubrics")
        .select("id")
        .eq("submission_id", submission_id)
        .single();

      if (existingRubric) {
        res.status(409).json({
          error: {
            code: "RUBRIC_EXISTS",
            message:
              "A rubric already exists for this submission. Use PUT to update it.",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Create the rubric
      const { data: rubric, error: rubricError } = await supabase
        .from("rubrics")
        .insert({
          submission_id,
          rubric_schema_id,
          values,
        })
        .select()
        .single();

      if (rubricError) {
        throw rubricError;
      }

      // Update submission grade if rubric is used for grading
      try {
        await updateSubmissionGradeFromRubric(
          submission_id,
          rubric_schema_id,
          values
        );
      } catch (gradeError) {
        console.error(
          "Error updating submission grade from rubric:",
          gradeError
        );
        // Don't fail the request if grade update fails, just log it
      }

      res.status(201).json(rubric);
    } catch (error) {
      console.error("Error creating rubric:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create rubric",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * PUT /rubric/:id
 * Update rubric scores (instructor/TA only)
 * Requirements: 8.2, 8.3, 8.5
 */
router.put(
  "/rubric/:id",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const { values }: UpdateRubricRequest = req.body;
      const { id: userId, isAdmin } = req.user!;

      // Get the existing rubric
      const { data: existingRubric, error: existingError } = await supabase
        .from("rubrics")
        .select(
          `
        *,
        rubric_schemas!inner(
          assignment_id,
          items
        )
      `
        )
        .eq("id", id)
        .single();

      if (existingError || !existingRubric) {
        res.status(404).json({
          error: {
            code: "RUBRIC_NOT_FOUND",
            message: "Rubric not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get the submission to check permissions
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("student_id, course_id")
        .eq("id", existingRubric.submission_id)
        .single();

      if (submissionError || !submission) {
        res.status(404).json({
          error: {
            code: "SUBMISSION_NOT_FOUND",
            message: "Associated submission not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check grading permissions
      const permissions = await getCoursePermissions(
        userId,
        submission.course_id,
        isAdmin
      );

      if (!permissions.canGrade && !permissions.canManage) {
        res.status(403).json({
          error: {
            code: "INSUFFICIENT_PERMISSIONS",
            message: "Not authorized to update rubrics for this course",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Validate values if provided
      if (values !== undefined) {
        if (!Array.isArray(values)) {
          res.status(400).json({
            error: {
              code: "INVALID_VALUES",
              message: "Values must be an array",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }

        // Validate values are numbers
        for (const value of values) {
          if (typeof value !== "number" || value < 0) {
            res.status(400).json({
              error: {
                code: "INVALID_VALUES",
                message: "All rubric values must be non-negative numbers",
                timestamp: new Date().toISOString(),
                path: req.path,
              },
            });
            return;
          }
        }

        // Validate values array length matches rubric items
        const rubricSchema = existingRubric.rubric_schemas as any;
        if (values.length !== rubricSchema.items.length) {
          res.status(400).json({
            error: {
              code: "VALUES_LENGTH_MISMATCH",
              message: `Expected ${rubricSchema.items.length} values, got ${values.length}`,
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
      }

      // Prepare update data
      const updateData: Partial<Rubric> = {};
      if (values !== undefined) updateData.values = values;

      // Update the rubric
      const { data: updatedRubric, error: updateError } = await supabase
        .from("rubrics")
        .update(updateData)
        .eq("id", id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      // Update submission grade if rubric is used for grading and values were updated
      if (values !== undefined) {
        try {
          await updateSubmissionGradeFromRubric(
            existingRubric.submission_id,
            existingRubric.rubric_schema_id,
            values
          );
        } catch (gradeError) {
          console.error(
            "Error updating submission grade from rubric:",
            gradeError
          );
          // Don't fail the request if grade update fails, just log it
        }
      }

      res.json(updatedRubric);
    } catch (error) {
      console.error("Error updating rubric:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update rubric",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

/**
 * GET /rubric/:submissionId/score
 * Get calculated rubric score for submission
 * Requirements: 8.2, 8.3, 8.5
 */
router.get(
  "/rubric/:submissionId/score",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { submissionId } = req.params;
      const { id: userId, isAdmin } = req.user!;

      // Get the submission to check permissions
      const { data: submission, error: submissionError } = await supabase
        .from("submissions")
        .select("student_id, course_id")
        .eq("id", submissionId)
        .single();

      if (submissionError || !submission) {
        res.status(404).json({
          error: {
            code: "SUBMISSION_NOT_FOUND",
            message: "Submission not found",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Check permissions
      const permissions = await getCoursePermissions(
        userId,
        submission.course_id,
        isAdmin
      );

      // Students can only access rubric scores for their own submissions
      if (
        submission.student_id !== userId &&
        !permissions.canGrade &&
        !permissions.canManage
      ) {
        res.status(403).json({
          error: {
            code: "ACCESS_DENIED",
            message:
              "Can only access rubric scores for own submissions or need grading permissions",
            timestamp: new Date().toISOString(),
            path: req.path,
          },
        });
        return;
      }

      // Get rubric with schema for the submission
      const { data: rubric, error: rubricError } = await supabase
        .from("rubrics")
        .select(
          `
        *,
        rubric_schemas!inner(
          id,
          title,
          use_for_grading,
          items
        )
      `
        )
        .eq("submission_id", submissionId)
        .single();

      if (rubricError) {
        if (rubricError.code === "PGRST116") {
          // No rubric found
          res.status(404).json({
            error: {
              code: "RUBRIC_NOT_FOUND",
              message: "No rubric found for this submission",
              timestamp: new Date().toISOString(),
              path: req.path,
            },
          });
          return;
        }
        throw rubricError;
      }

      const schema = rubric.rubric_schemas as any;

      // Calculate scores
      const totalScore = calculateRubricScore(rubric.values, schema.items);
      const maxPossibleScore = schema.items.reduce(
        (sum: number, item: RubricItem) => sum + item.points,
        0
      );
      const percentage =
        maxPossibleScore > 0 ? (totalScore / maxPossibleScore) * 100 : 0;

      // Build detailed score breakdown
      const itemScores = rubric.values.map((value: number, index: number) => ({
        title: schema.items[index].title,
        score: value,
        maxPoints: schema.items[index].points,
        percentage:
          schema.items[index].points > 0
            ? (value / schema.items[index].points) * 100
            : 0,
      }));

      res.json({
        rubric_id: rubric.id,
        submission_id: submissionId,
        schema_title: schema.title,
        use_for_grading: schema.use_for_grading,
        total_score: totalScore,
        max_possible_score: maxPossibleScore,
        percentage: Math.round(percentage * 100) / 100, // Round to 2 decimal places
        item_scores: itemScores,
        created_at: rubric.created_at,
        updated_at: rubric.updated_at,
      });
    } catch (error) {
      console.error("Error calculating rubric score:", error);
      res.status(500).json({
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to calculate rubric score",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
    }
  }
);

export default router;
