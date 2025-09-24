import { Router, Request, Response } from 'express';
import { supabase } from '../middleware/auth';
import { authenticateToken } from '../middleware/auth';
import { getCoursePermissions, getUserCourseRole } from '../middleware/authorization';
import { UserRole, SubmissionStatus } from '../types/enums';
import { Submission } from '../types/entities';
import { CreateSubmissionRequest, UpdateSubmissionRequest, GradeSubmissionRequest } from '../types/api';

const router = Router();

/**
 * Check if user can access a specific submission
 * Students can only access their own submissions
 * Instructors/TAs can access all submissions in their courses
 */
const canAccessSubmission = async (
  userId: string, 
  submission: Submission, 
  isAdmin: boolean = false
): Promise<{ canAccess: boolean; message?: string }> => {
  // Admins can access everything
  if (isAdmin) {
    return { canAccess: true };
  }

  // Students can only access their own submissions
  if (submission.student_id === userId) {
    return { canAccess: true };
  }

  // Check if user has grading permissions in the course
  const permissions = await getCoursePermissions(userId, submission.course_id, isAdmin);
  
  if (permissions.canGrade || permissions.canManage) {
    return { canAccess: true };
  }

  return { 
    canAccess: false, 
    message: 'Can only access own submissions or need grading permissions' 
  };
};

/**
 * GET /submission/:id
 * Get submission with student privacy checks
 * Requirements: 4.1, 4.2, 7.2
 */
router.get('/submission/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, isAdmin } = req.user!;

    // Get the submission
    const { data: submission, error: submissionError } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (submissionError || !submission) {
      res.status(404).json({
        error: {
          code: 'SUBMISSION_NOT_FOUND',
          message: 'Submission not found',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Check access permissions
    const accessCheck = await canAccessSubmission(userId, submission, isAdmin);
    
    if (!accessCheck.canAccess) {
      res.status(403).json({
        error: {
          code: 'ACCESS_DENIED',
          message: accessCheck.message || 'Not authorized to access this submission',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    res.json(submission);
  } catch (error) {
    console.error('Error retrieving submission:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve submission',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  }
});

/**
 * GET /submissions/by-assignment/:assignmentId
 * Get all submissions for an assignment (instructor/TA view)
 * Requirements: 4.1, 4.2, 7.2
 */
router.get('/submissions/by-assignment/:assignmentId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { assignmentId } = req.params;
    const { id: userId, isAdmin } = req.user!;

    // Get the assignment to check course permissions
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('course_id')
      .eq('id', assignmentId)
      .single();

    if (assignmentError || !assignment) {
      res.status(404).json({
        error: {
          code: 'ASSIGNMENT_NOT_FOUND',
          message: 'Assignment not found',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Check course permissions
    const permissions = await getCoursePermissions(userId, assignment.course_id, isAdmin);
    const userRole = await getUserCourseRole(userId, assignment.course_id);

    // Students can only see their own submissions
    if (userRole === UserRole.STUDENT || userRole === UserRole.AUDIT) {
      const { data: submissions, error: submissionsError } = await supabase
        .from('submissions')
        .select('*')
        .eq('assignment_id', assignmentId)
        .eq('student_id', userId);

      if (submissionsError) {
        throw submissionsError;
      }

      res.json(submissions || []);
      return;
    }

    // Instructors and TAs can see all submissions
    if (permissions.canGrade || permissions.canManage) {
      const { data: submissions, error: submissionsError } = await supabase
        .from('submissions')
        .select('*')
        .eq('assignment_id', assignmentId)
        .order('timestamp', { ascending: false });

      if (submissionsError) {
        throw submissionsError;
      }

      res.json(submissions || []);
      return;
    }

    res.status(403).json({
      error: {
        code: 'INSUFFICIENT_PERMISSIONS',
        message: 'Not authorized to access submissions for this assignment',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  } catch (error) {
    console.error('Error retrieving submissions:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve submissions',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  }
});

/**
 * POST /submission
 * Create or update submission for student
 * Requirements: 4.1, 4.2, 7.2
 */
router.post('/submission', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { assignment_id, values, course_id }: CreateSubmissionRequest = req.body;
    const { id: userId, isAdmin } = req.user!;

    // Validate required fields
    if (!assignment_id || !course_id) {
      res.status(400).json({
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'assignment_id and course_id are required',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Verify assignment exists and belongs to the course
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('*')
      .eq('id', assignment_id)
      .eq('course_id', course_id)
      .single();

    if (assignmentError || !assignment) {
      res.status(404).json({
        error: {
          code: 'ASSIGNMENT_NOT_FOUND',
          message: 'Assignment not found or does not belong to the specified course',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Check course permissions - students can only submit to courses they're enrolled in
    const permissions = await getCoursePermissions(userId, course_id, isAdmin);
    const userRole = await getUserCourseRole(userId, course_id);

    if (!permissions.canRead) {
      res.status(403).json({
        error: {
          code: 'NOT_ENROLLED',
          message: 'Not enrolled in this course',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Only students can create submissions through this endpoint
    // Instructors/TAs should use different endpoints for grading
    if (userRole !== UserRole.STUDENT && !isAdmin) {
      res.status(403).json({
        error: {
          code: 'STUDENT_ONLY_ENDPOINT',
          message: 'This endpoint is for student submissions only',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Check if submission already exists for this student and assignment
    const { data: existingSubmission, error: existingError } = await supabase
      .from('submissions')
      .select('*')
      .eq('assignment_id', assignment_id)
      .eq('student_id', userId)
      .single();

    let submission;

    if (existingSubmission && !existingError) {
      // Update existing submission
      const { data: updatedSubmission, error: updateError } = await supabase
        .from('submissions')
        .update({
          values: values || {},
          timestamp: new Date(),
          status: SubmissionStatus.SUBMITTED
        })
        .eq('id', existingSubmission.id)
        .select()
        .single();

      if (updateError) {
        throw updateError;
      }

      submission = updatedSubmission;
    } else {
      // Create new submission
      const { data: newSubmission, error: createError } = await supabase
        .from('submissions')
        .insert({
          assignment_id,
          course_id,
          student_id: userId,
          values: values || {},
          status: SubmissionStatus.SUBMITTED,
          timestamp: new Date()
        })
        .select()
        .single();

      if (createError) {
        throw createError;
      }

      submission = newSubmission;
    }

    res.status(existingSubmission ? 200 : 201).json(submission);
  } catch (error) {
    console.error('Error creating/updating submission:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create/update submission',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  }
});

/**
 * PUT /submission/:id
 * Update submission values (for students to update their work)
 * Requirements: 4.1, 4.2, 7.2
 */
router.put('/submission/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { values }: UpdateSubmissionRequest = req.body;
    const { id: userId, isAdmin } = req.user!;

    // Get the existing submission
    const { data: existingSubmission, error: existingError } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (existingError || !existingSubmission) {
      res.status(404).json({
        error: {
          code: 'SUBMISSION_NOT_FOUND',
          message: 'Submission not found',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Check access permissions
    const accessCheck = await canAccessSubmission(userId, existingSubmission, isAdmin);
    
    if (!accessCheck.canAccess) {
      res.status(403).json({
        error: {
          code: 'ACCESS_DENIED',
          message: accessCheck.message || 'Not authorized to update this submission',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Students can only update their own submissions and only if not graded
    if (existingSubmission.student_id === userId && existingSubmission.status === SubmissionStatus.GRADED) {
      res.status(403).json({
        error: {
          code: 'SUBMISSION_ALREADY_GRADED',
          message: 'Cannot update submission that has already been graded',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Prepare update data
    const updateData: Partial<Submission> = {
      timestamp: new Date()
    };

    if (values !== undefined) {
      updateData.values = values;
    }

    // If student is updating their own submission, set status to submitted
    if (existingSubmission.student_id === userId) {
      updateData.status = SubmissionStatus.SUBMITTED;
    }

    // Update the submission
    const { data: updatedSubmission, error: updateError } = await supabase
      .from('submissions')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    res.json(updatedSubmission);
  } catch (error) {
    console.error('Error updating submission:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update submission',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  }
});

/**
 * PUT /submission/:id/grade
 * Grade a submission (instructor/TA only)
 * Requirements: 4.3, 4.4, 7.3
 */
router.put('/submission/:id/grade', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { grade, grader_id }: GradeSubmissionRequest = req.body;
    const { id: userId, isAdmin } = req.user!;

    // Validate required fields
    if (grade === undefined || grade === null) {
      res.status(400).json({
        error: {
          code: 'MISSING_GRADE',
          message: 'Grade is required',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Validate grade is a number
    if (typeof grade !== 'number' || isNaN(grade)) {
      res.status(400).json({
        error: {
          code: 'INVALID_GRADE',
          message: 'Grade must be a valid number',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Get the existing submission
    const { data: existingSubmission, error: existingError } = await supabase
      .from('submissions')
      .select('*')
      .eq('id', id)
      .single();

    if (existingError || !existingSubmission) {
      res.status(404).json({
        error: {
          code: 'SUBMISSION_NOT_FOUND',
          message: 'Submission not found',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Check grading permissions
    const permissions = await getCoursePermissions(userId, existingSubmission.course_id, isAdmin);
    
    if (!permissions.canGrade && !permissions.canManage) {
      res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Not authorized to grade submissions in this course',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Use provided grader_id or default to current user
    const finalGraderId = grader_id || userId;

    // Verify grader has permissions if different from current user
    if (finalGraderId !== userId && !isAdmin) {
      const graderPermissions = await getCoursePermissions(finalGraderId, existingSubmission.course_id, false);
      if (!graderPermissions.canGrade && !graderPermissions.canManage) {
        res.status(400).json({
          error: {
            code: 'INVALID_GRADER',
            message: 'Specified grader does not have grading permissions for this course',
            timestamp: new Date().toISOString(),
            path: req.path
          }
        });
        return;
      }
    }

    // Update the submission with grade
    const { data: updatedSubmission, error: updateError } = await supabase
      .from('submissions')
      .update({
        grade,
        grader_id: finalGraderId,
        status: SubmissionStatus.GRADED
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    res.json(updatedSubmission);
  } catch (error) {
    console.error('Error grading submission:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to grade submission',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  }
});

export default router;