import { Router, Request, Response } from 'express';
import { supabase } from '../middleware/auth';
import { authenticateToken } from '../middleware/auth';
import { getCoursePermissions } from '../middleware/authorization';
import { Grader } from '../types/entities';
import { CreateGraderRequest, UpdateGraderRequest } from '../types/api';

const router = Router();

/**
 * Check if user can access grader feedback
 * Students can only access feedback for their own submissions
 * Instructors/TAs can access all feedback in their courses
 */
const canAccessGraderFeedback = async (
  userId: string, 
  grader: Grader, 
  isAdmin: boolean = false
): Promise<{ canAccess: boolean; message?: string }> => {
  // Admins can access everything
  if (isAdmin) {
    return { canAccess: true };
  }

  // Get the submission to check ownership and course
  const { data: submission, error: submissionError } = await supabase
    .from('submissions')
    .select('student_id, course_id')
    .eq('id', grader.submission_id)
    .single();

  if (submissionError || !submission) {
    return { 
      canAccess: false, 
      message: 'Associated submission not found' 
    };
  }

  // Students can only access feedback for their own submissions
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
    message: 'Can only access feedback for own submissions or need grading permissions' 
  };
};

/**
 * GET /grader/:id
 * Get grader feedback with privacy checks
 * Requirements: 4.3, 4.4, 7.3
 */
router.get('/grader/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { id: userId, isAdmin } = req.user!;

    // Get the grader entry
    const { data: grader, error: graderError } = await supabase
      .from('graders')
      .select('*')
      .eq('id', id)
      .single();

    if (graderError || !grader) {
      res.status(404).json({
        error: {
          code: 'GRADER_NOT_FOUND',
          message: 'Grader feedback not found',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Check access permissions
    const accessCheck = await canAccessGraderFeedback(userId, grader, isAdmin);
    
    if (!accessCheck.canAccess) {
      res.status(403).json({
        error: {
          code: 'ACCESS_DENIED',
          message: accessCheck.message || 'Not authorized to access this feedback',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    res.json(grader);
  } catch (error) {
    console.error('Error retrieving grader feedback:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve grader feedback',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  }
});

/**
 * GET /graders/by-submission/:submissionId
 * Get all grader feedback for a submission
 * Requirements: 4.3, 4.4, 7.3
 */
router.get('/graders/by-submission/:submissionId', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { submissionId } = req.params;
    const { id: userId, isAdmin } = req.user!;

    // Get the submission to check permissions
    const { data: submission, error: submissionError } = await supabase
      .from('submissions')
      .select('student_id, course_id')
      .eq('id', submissionId)
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

    // Check permissions
    const permissions = await getCoursePermissions(userId, submission.course_id, isAdmin);
    
    // Students can only access feedback for their own submissions
    if (submission.student_id !== userId && !permissions.canGrade && !permissions.canManage) {
      res.status(403).json({
        error: {
          code: 'ACCESS_DENIED',
          message: 'Can only access feedback for own submissions or need grading permissions',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Get all grader entries for this submission
    const { data: graders, error: gradersError } = await supabase
      .from('graders')
      .select('*')
      .eq('submission_id', submissionId)
      .order('created_at', { ascending: false });

    if (gradersError) {
      throw gradersError;
    }

    res.json(graders || []);
  } catch (error) {
    console.error('Error retrieving grader feedback for submission:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve grader feedback',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  }
});

/**
 * POST /grader
 * Create grader feedback entry (instructor/TA only)
 * Requirements: 4.3, 4.4, 7.3
 */
router.post('/grader', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { 
      feedback, 
      rubric_id, 
      raw_assignment_score, 
      raw_rubric_score, 
      score_modifier, 
      submission_id 
    }: CreateGraderRequest = req.body;
    const { id: userId, isAdmin } = req.user!;

    // Validate required fields
    if (!submission_id || raw_assignment_score === undefined || raw_rubric_score === undefined) {
      res.status(400).json({
        error: {
          code: 'MISSING_REQUIRED_FIELDS',
          message: 'submission_id, raw_assignment_score, and raw_rubric_score are required',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Validate scores are numbers
    if (typeof raw_assignment_score !== 'number' || typeof raw_rubric_score !== 'number') {
      res.status(400).json({
        error: {
          code: 'INVALID_SCORES',
          message: 'Scores must be valid numbers',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Get the submission to check permissions
    const { data: submission, error: submissionError } = await supabase
      .from('submissions')
      .select('student_id, course_id')
      .eq('id', submission_id)
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

    // Check grading permissions
    const permissions = await getCoursePermissions(userId, submission.course_id, isAdmin);
    
    if (!permissions.canGrade && !permissions.canManage) {
      res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Not authorized to create grader feedback for this course',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Validate rubric_id if provided
    if (rubric_id) {
      const { data: rubric, error: rubricError } = await supabase
        .from('rubrics')
        .select('submission_id')
        .eq('id', rubric_id)
        .single();

      if (rubricError || !rubric || rubric.submission_id !== submission_id) {
        res.status(400).json({
          error: {
            code: 'INVALID_RUBRIC',
            message: 'Rubric not found or does not belong to this submission',
            timestamp: new Date().toISOString(),
            path: req.path
          }
        });
        return;
      }
    }

    // Create the grader entry
    const { data: grader, error: graderError } = await supabase
      .from('graders')
      .insert({
        feedback: feedback || '',
        rubric_id,
        raw_assignment_score,
        raw_rubric_score,
        score_modifier: score_modifier || '',
        submission_id,
        reviewed_at: new Date()
      })
      .select()
      .single();

    if (graderError) {
      throw graderError;
    }

    res.status(201).json(grader);
  } catch (error) {
    console.error('Error creating grader feedback:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create grader feedback',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  }
});

/**
 * PUT /grader/:id
 * Update grader feedback (instructor/TA only)
 * Requirements: 4.3, 4.4, 7.3
 */
router.put('/grader/:id', authenticateToken, async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { 
      feedback, 
      rubric_id, 
      raw_assignment_score, 
      raw_rubric_score, 
      score_modifier 
    }: UpdateGraderRequest = req.body;
    const { id: userId, isAdmin } = req.user!;

    // Get the existing grader entry
    const { data: existingGrader, error: existingError } = await supabase
      .from('graders')
      .select('*')
      .eq('id', id)
      .single();

    if (existingError || !existingGrader) {
      res.status(404).json({
        error: {
          code: 'GRADER_NOT_FOUND',
          message: 'Grader feedback not found',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Get the submission to check permissions
    const { data: submission, error: submissionError } = await supabase
      .from('submissions')
      .select('student_id, course_id')
      .eq('id', existingGrader.submission_id)
      .single();

    if (submissionError || !submission) {
      res.status(404).json({
        error: {
          code: 'SUBMISSION_NOT_FOUND',
          message: 'Associated submission not found',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Check grading permissions
    const permissions = await getCoursePermissions(userId, submission.course_id, isAdmin);
    
    if (!permissions.canGrade && !permissions.canManage) {
      res.status(403).json({
        error: {
          code: 'INSUFFICIENT_PERMISSIONS',
          message: 'Not authorized to update grader feedback for this course',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Validate scores if provided
    if (raw_assignment_score !== undefined && (typeof raw_assignment_score !== 'number' || isNaN(raw_assignment_score))) {
      res.status(400).json({
        error: {
          code: 'INVALID_ASSIGNMENT_SCORE',
          message: 'Assignment score must be a valid number',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    if (raw_rubric_score !== undefined && (typeof raw_rubric_score !== 'number' || isNaN(raw_rubric_score))) {
      res.status(400).json({
        error: {
          code: 'INVALID_RUBRIC_SCORE',
          message: 'Rubric score must be a valid number',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    // Validate rubric_id if provided
    if (rubric_id) {
      const { data: rubric, error: rubricError } = await supabase
        .from('rubrics')
        .select('submission_id')
        .eq('id', rubric_id)
        .single();

      if (rubricError || !rubric || rubric.submission_id !== existingGrader.submission_id) {
        res.status(400).json({
          error: {
            code: 'INVALID_RUBRIC',
            message: 'Rubric not found or does not belong to this submission',
            timestamp: new Date().toISOString(),
            path: req.path
          }
        });
        return;
      }
    }

    // Prepare update data
    const updateData: Partial<Grader> = {};

    if (feedback !== undefined) updateData.feedback = feedback;
    if (rubric_id !== undefined) updateData.rubric_id = rubric_id;
    if (raw_assignment_score !== undefined) updateData.raw_assignment_score = raw_assignment_score;
    if (raw_rubric_score !== undefined) updateData.raw_rubric_score = raw_rubric_score;
    if (score_modifier !== undefined) updateData.score_modifier = score_modifier;

    // Always update reviewed_at when making changes
    updateData.reviewed_at = new Date();

    // Update the grader entry
    const { data: updatedGrader, error: updateError } = await supabase
      .from('graders')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    res.json(updatedGrader);
  } catch (error) {
    console.error('Error updating grader feedback:', error);
    res.status(500).json({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to update grader feedback',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  }
});

export default router;