import { createClient } from '@supabase/supabase-js';
import { passwordService } from './passwordService';
import { logger } from '../utils/logger';
import { UserRole } from '../types/enums';

// Initialize Supabase client with service role key for server-side operations
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export interface ManagedStudent {
  id: string;
  username: string;
  email: string;
  first_name?: string;
  last_name?: string;
  is_managed: boolean;
  managed_by_id: string;
  last_password_reset?: string;
  created_at: string;
  updated_at: string;
}

export interface ManagedStudentWithEnrollments extends ManagedStudent {
  enrollments: Array<{
    id: string;
    course_id: string;
    course_name: string;
    role: string;
    enrolled_at: string;
  }>;
}

export interface CreateManagedStudentInput {
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  courseId?: string; // Optional: immediately enroll in a course
  sectionId?: string; // Optional: assign to a section when enrolling
}

export interface UpdateManagedStudentInput {
  firstName?: string;
  lastName?: string;
}

export class ManagedStudentServiceError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'ManagedStudentServiceError';
  }
}

/**
 * Managed Student Service
 * Handles CRUD operations for teacher-managed student accounts
 */
export class ManagedStudentService {
  /**
   * Create a new managed student
   * @param teacherId - ID of the teacher creating this student
   * @param input - Student data including username and password
   * @returns Created managed student record
   */
  async createManagedStudent(
    teacherId: string,
    input: CreateManagedStudentInput
  ): Promise<ManagedStudent> {
    try {
      // Validate username format
      const usernameValidation = passwordService.validateUsername(input.username);
      if (!usernameValidation.valid) {
        throw new ManagedStudentServiceError(
          usernameValidation.message || 'Invalid username',
          'INVALID_USERNAME',
          400
        );
      }

      // Validate password strength
      const passwordValidation = passwordService.validatePasswordStrength(input.password);
      if (!passwordValidation.valid) {
        throw new ManagedStudentServiceError(
          passwordValidation.message || 'Invalid password',
          'INVALID_PASSWORD',
          400
        );
      }

      // Check if username is already taken
      const existingUser = await this.getManagedStudentByUsername(input.username);
      if (existingUser) {
        throw new ManagedStudentServiceError(
          'Username is already taken',
          'USERNAME_EXISTS',
          409
        );
      }

      // Hash the password
      const passwordHash = await passwordService.hash(input.password);

      // Generate a placeholder email (required by schema but not used for managed students)
      const placeholderEmail = `${input.username.toLowerCase()}@managed.classla.local`;

      // Create the user
      const userData = {
        username: input.username.toLowerCase(),
        password_hash: passwordHash,
        email: placeholderEmail,
        first_name: input.firstName || null,
        last_name: input.lastName || null,
        is_managed: true,
        managed_by_id: teacherId,
        is_admin: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data: newStudent, error } = await supabase
        .from('users')
        .insert(userData)
        .select('id, username, email, first_name, last_name, is_managed, managed_by_id, last_password_reset, created_at, updated_at')
        .single();

      if (error) {
        logger.error('Failed to create managed student', {
          teacherId,
          username: input.username,
          error: error.message
        });
        throw new ManagedStudentServiceError(
          'Failed to create student account',
          'CREATION_ERROR',
          500
        );
      }

      logger.info('Managed student created', {
        studentId: newStudent.id,
        teacherId,
        username: input.username
      });

      // If a courseId was provided, enroll the student
      if (input.courseId) {
        await this.enrollInCourse(teacherId, newStudent.id, input.courseId, input.sectionId);
      }

      return newStudent as ManagedStudent;
    } catch (error) {
      if (error instanceof ManagedStudentServiceError) {
        throw error;
      }
      logger.error('Unexpected error creating managed student', {
        teacherId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ManagedStudentServiceError(
        'Failed to create student account',
        'CREATION_ERROR',
        500
      );
    }
  }

  /**
   * Get all managed students for a teacher
   * @param teacherId - ID of the teacher
   * @returns Array of managed students with their enrollments
   */
  async getManagedStudents(teacherId: string): Promise<ManagedStudentWithEnrollments[]> {
    try {
      // Get all students managed by this teacher
      const { data: students, error: studentsError } = await supabase
        .from('users')
        .select('id, username, email, first_name, last_name, is_managed, managed_by_id, last_password_reset, created_at, updated_at')
        .eq('managed_by_id', teacherId)
        .eq('is_managed', true)
        .order('created_at', { ascending: false });

      if (studentsError) {
        throw studentsError;
      }

      if (!students || students.length === 0) {
        return [];
      }

      // Get enrollments for all students
      const studentIds = students.map(s => s.id);
      const { data: enrollments, error: enrollmentsError } = await supabase
        .from('course_enrollments')
        .select(`
          id,
          user_id,
          course_id,
          role,
          enrolled_at,
          section_id,
          courses:course_id (name),
          sections:section_id (name)
        `)
        .in('user_id', studentIds);

      if (enrollmentsError) {
        logger.warn('Failed to fetch enrollments for managed students', {
          error: enrollmentsError.message
        });
      }

      // Map enrollments to students
      const enrollmentsByStudent = new Map<string, any[]>();
      (enrollments || []).forEach(enrollment => {
        const existing = enrollmentsByStudent.get(enrollment.user_id) || [];
        existing.push({
          id: enrollment.id,
          course_id: enrollment.course_id,
          course_name: (enrollment.courses as any)?.name || 'Unknown Course',
          role: enrollment.role,
          enrolled_at: enrollment.enrolled_at,
          section_id: enrollment.section_id || null,
          section_name: (enrollment.sections as any)?.name || null
        });
        enrollmentsByStudent.set(enrollment.user_id, existing);
      });

      return students.map(student => ({
        ...student,
        enrollments: enrollmentsByStudent.get(student.id) || []
      })) as ManagedStudentWithEnrollments[];
    } catch (error) {
      logger.error('Failed to get managed students', {
        teacherId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ManagedStudentServiceError(
        'Failed to retrieve students',
        'RETRIEVAL_ERROR',
        500
      );
    }
  }

  /**
   * Get a single managed student by ID
   * @param teacherId - ID of the teacher (for ownership verification)
   * @param studentId - ID of the student
   * @returns Managed student record with enrollments
   */
  async getManagedStudentById(
    teacherId: string,
    studentId: string
  ): Promise<ManagedStudentWithEnrollments | null> {
    try {
      const { data: student, error } = await supabase
        .from('users')
        .select('id, username, email, first_name, last_name, is_managed, managed_by_id, last_password_reset, created_at, updated_at')
        .eq('id', studentId)
        .eq('is_managed', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      // Verify ownership
      if (student.managed_by_id !== teacherId) {
        throw new ManagedStudentServiceError(
          'You do not have permission to access this student',
          'ACCESS_DENIED',
          403
        );
      }

      // Get enrollments
      const { data: enrollments } = await supabase
        .from('course_enrollments')
        .select(`
          id,
          course_id,
          role,
          enrolled_at,
          courses:course_id (name)
        `)
        .eq('user_id', studentId);

      return {
        ...student,
        enrollments: (enrollments || []).map(e => ({
          id: e.id,
          course_id: e.course_id,
          course_name: (e.courses as any)?.name || 'Unknown Course',
          role: e.role,
          enrolled_at: e.enrolled_at
        }))
      } as ManagedStudentWithEnrollments;
    } catch (error) {
      if (error instanceof ManagedStudentServiceError) {
        throw error;
      }
      logger.error('Failed to get managed student', {
        teacherId,
        studentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ManagedStudentServiceError(
        'Failed to retrieve student',
        'RETRIEVAL_ERROR',
        500
      );
    }
  }

  /**
   * Get a managed student by username (for authentication)
   * @param username - The student's username
   * @returns Managed student with password hash or null
   */
  async getManagedStudentByUsername(username: string): Promise<(ManagedStudent & { password_hash: string }) | null> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, username, email, first_name, last_name, is_managed, managed_by_id, last_password_reset, password_hash, created_at, updated_at')
        .eq('username', username.toLowerCase())
        .eq('is_managed', true)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        throw error;
      }

      return data as (ManagedStudent & { password_hash: string });
    } catch (error) {
      logger.error('Failed to get managed student by username', {
        username,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Check if a username is available globally
   * @param username - The username to check
   * @returns Object with available flag and suggestion if not available
   */
  async checkUsernameAvailability(username: string): Promise<{
    available: boolean;
    suggestion?: string;
  }> {
    try {
      // Validate username format first
      const validation = passwordService.validateUsername(username);
      if (!validation.valid) {
        return { available: false };
      }

      const normalizedUsername = username.toLowerCase();

      // Check if username exists in the database (global uniqueness)
      const { data, error } = await supabase
        .from('users')
        .select('id')
        .eq('username', normalizedUsername)
        .maybeSingle();

      if (error) {
        logger.error('Error checking username availability', {
          username: normalizedUsername,
          error: error.message
        });
        throw error;
      }

      if (data) {
        // Username is taken, generate a suggestion
        let counter = 1;
        let suggestion = `${normalizedUsername}${counter}`;

        // Find an available suggestion
        while (counter < 100) {
          const { data: existingSuggestion } = await supabase
            .from('users')
            .select('id')
            .eq('username', suggestion)
            .maybeSingle();

          if (!existingSuggestion) {
            break;
          }
          counter++;
          suggestion = `${normalizedUsername}${counter}`;
        }

        return { available: false, suggestion };
      }

      return { available: true };
    } catch (error) {
      logger.error('Failed to check username availability', {
        username,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ManagedStudentServiceError(
        'Failed to check username availability',
        'USERNAME_CHECK_ERROR',
        500
      );
    }
  }

  /**
   * Validate multiple usernames for bulk import
   * @param usernames - Array of usernames to validate
   * @returns Validation results for each username
   */
  async validateUsernamesForBulkImport(usernames: string[]): Promise<{
    valid: boolean;
    results: Array<{
      username: string;
      valid: boolean;
      available: boolean;
      error?: string;
      suggestion?: string;
    }>;
  }> {
    const results: Array<{
      username: string;
      valid: boolean;
      available: boolean;
      error?: string;
      suggestion?: string;
    }> = [];

    // Check for duplicates within the batch
    const seen = new Set<string>();
    const duplicatesInBatch = new Set<string>();

    for (const username of usernames) {
      const normalized = username.toLowerCase();
      if (seen.has(normalized)) {
        duplicatesInBatch.add(normalized);
      }
      seen.add(normalized);
    }

    for (const username of usernames) {
      const normalized = username.toLowerCase();

      // Validate format
      const validation = passwordService.validateUsername(username);
      if (!validation.valid) {
        results.push({
          username,
          valid: false,
          available: false,
          error: validation.message || 'Invalid username format'
        });
        continue;
      }

      // Check for duplicates in the batch
      if (duplicatesInBatch.has(normalized)) {
        results.push({
          username,
          valid: false,
          available: false,
          error: 'Duplicate username in import list'
        });
        continue;
      }

      // Check global availability
      try {
        const availability = await this.checkUsernameAvailability(username);
        results.push({
          username,
          valid: true,
          available: availability.available,
          suggestion: availability.suggestion,
          error: availability.available ? undefined : 'Username already taken'
        });
      } catch (error) {
        results.push({
          username,
          valid: false,
          available: false,
          error: 'Failed to check availability'
        });
      }
    }

    const allValid = results.every(r => r.valid && r.available);
    return { valid: allValid, results };
  }

  /**
   * Update a managed student's details
   * @param teacherId - ID of the teacher (for ownership verification)
   * @param studentId - ID of the student
   * @param input - Fields to update
   * @returns Updated managed student record
   */
  async updateManagedStudent(
    teacherId: string,
    studentId: string,
    input: UpdateManagedStudentInput
  ): Promise<ManagedStudent> {
    try {
      // Verify ownership
      const existing = await this.getManagedStudentById(teacherId, studentId);
      if (!existing) {
        throw new ManagedStudentServiceError(
          'Student not found',
          'NOT_FOUND',
          404
        );
      }

      const updateData: any = {
        updated_at: new Date().toISOString()
      };

      if (input.firstName !== undefined) {
        updateData.first_name = input.firstName || null;
      }
      if (input.lastName !== undefined) {
        updateData.last_name = input.lastName || null;
      }

      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', studentId)
        .select('id, username, email, first_name, last_name, is_managed, managed_by_id, last_password_reset, created_at, updated_at')
        .single();

      if (error) {
        throw error;
      }

      logger.info('Managed student updated', {
        studentId,
        teacherId
      });

      return data as ManagedStudent;
    } catch (error) {
      if (error instanceof ManagedStudentServiceError) {
        throw error;
      }
      logger.error('Failed to update managed student', {
        teacherId,
        studentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ManagedStudentServiceError(
        'Failed to update student',
        'UPDATE_ERROR',
        500
      );
    }
  }

  /**
   * Reset a managed student's password
   * @param teacherId - ID of the teacher (for ownership verification)
   * @param studentId - ID of the student
   * @returns Object containing the new temporary password
   */
  async resetPassword(
    teacherId: string,
    studentId: string
  ): Promise<{ temporaryPassword: string }> {
    try {
      // Verify ownership
      const existing = await this.getManagedStudentById(teacherId, studentId);
      if (!existing) {
        throw new ManagedStudentServiceError(
          'Student not found',
          'NOT_FOUND',
          404
        );
      }

      // Generate a new temporary password
      const temporaryPassword = passwordService.generateTemporaryPassword();
      const passwordHash = await passwordService.hash(temporaryPassword);

      const { error } = await supabase
        .from('users')
        .update({
          password_hash: passwordHash,
          last_password_reset: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', studentId);

      if (error) {
        throw error;
      }

      logger.info('Managed student password reset', {
        studentId,
        teacherId
      });

      return { temporaryPassword };
    } catch (error) {
      if (error instanceof ManagedStudentServiceError) {
        throw error;
      }
      logger.error('Failed to reset managed student password', {
        teacherId,
        studentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ManagedStudentServiceError(
        'Failed to reset password',
        'PASSWORD_RESET_ERROR',
        500
      );
    }
  }

  /**
   * Allow a managed student to change their own password
   * @param studentId - ID of the student changing their password
   * @param currentPassword - The student's current password for verification
   * @param newPassword - The new password to set
   */
  async changeOwnPassword(
    studentId: string,
    currentPassword: string,
    newPassword: string
  ): Promise<void> {
    try {
      // Get the student record with password hash
      const { data: student, error: fetchError } = await supabase
        .from('users')
        .select('id, password_hash, is_managed')
        .eq('id', studentId)
        .eq('is_managed', true)
        .single();

      if (fetchError || !student) {
        throw new ManagedStudentServiceError(
          'Student not found',
          'NOT_FOUND',
          404
        );
      }

      // Verify current password
      const isValidPassword = await passwordService.verify(
        currentPassword,
        student.password_hash
      );

      if (!isValidPassword) {
        throw new ManagedStudentServiceError(
          'Current password is incorrect',
          'INVALID_PASSWORD',
          401
        );
      }

      // Validate new password strength
      const passwordValidation = passwordService.validatePasswordStrength(newPassword);
      if (!passwordValidation.valid) {
        throw new ManagedStudentServiceError(
          passwordValidation.message || 'New password does not meet requirements',
          'INVALID_NEW_PASSWORD',
          400
        );
      }

      // Hash and update the new password
      const newPasswordHash = await passwordService.hash(newPassword);

      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update({
          password_hash: newPasswordHash,
          updated_at: new Date().toISOString()
        })
        .eq('id', studentId)
        .eq('is_managed', true)
        .select('id')
        .single();

      if (updateError) {
        throw updateError;
      }

      if (!updatedUser) {
        throw new ManagedStudentServiceError(
          'Failed to update password',
          'PASSWORD_UPDATE_FAILED',
          500
        );
      }

      logger.info('Managed student changed their password', { studentId });
    } catch (error) {
      if (error instanceof ManagedStudentServiceError) {
        throw error;
      }
      logger.error('Failed to change managed student password', {
        studentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ManagedStudentServiceError(
        'Failed to change password',
        'PASSWORD_CHANGE_ERROR',
        500
      );
    }
  }

  /**
   * Delete a managed student and all their data (FERPA compliance)
   * @param teacherId - ID of the teacher (for ownership verification)
   * @param studentId - ID of the student to delete
   */
  async deleteManagedStudent(teacherId: string, studentId: string): Promise<void> {
    try {
      // Verify ownership
      const existing = await this.getManagedStudentById(teacherId, studentId);
      if (!existing) {
        throw new ManagedStudentServiceError(
          'Student not found',
          'NOT_FOUND',
          404
        );
      }

      // Get all submission IDs for this student
      const { data: submissions } = await supabase
        .from('submissions')
        .select('id')
        .eq('student_id', studentId);

      const submissionIds = (submissions || []).map(s => s.id);

      // Delete in order (respecting FK constraints)
      if (submissionIds.length > 0) {
        // Delete graders associated with submissions
        await supabase
          .from('graders')
          .delete()
          .in('submission_id', submissionIds);

        // Delete rubrics associated with submissions (if any)
        // Note: This may not exist in all setups, but we handle it just in case
        const { error: rubricsError } = await supabase
          .from('rubrics')
          .delete()
          .in('submission_id', submissionIds);

        // Ignore error if rubrics table doesn't have this relationship
        if (rubricsError && !rubricsError.message.includes('does not exist')) {
          logger.warn('Error deleting rubrics for student', { error: rubricsError.message });
        }
      }

      // Delete submissions
      await supabase
        .from('submissions')
        .delete()
        .eq('student_id', studentId);

      // Delete course enrollments
      await supabase
        .from('course_enrollments')
        .delete()
        .eq('user_id', studentId);

      // Delete the user record
      const { error: deleteError } = await supabase
        .from('users')
        .delete()
        .eq('id', studentId);

      if (deleteError) {
        throw deleteError;
      }

      logger.info('Managed student deleted', {
        studentId,
        teacherId,
        deletedSubmissions: submissionIds.length
      });
    } catch (error) {
      if (error instanceof ManagedStudentServiceError) {
        throw error;
      }
      logger.error('Failed to delete managed student', {
        teacherId,
        studentId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ManagedStudentServiceError(
        'Failed to delete student',
        'DELETION_ERROR',
        500
      );
    }
  }

  /**
   * Enroll a managed student in a course
   * @param teacherId - ID of the teacher (for verification)
   * @param studentId - ID of the student
   * @param courseId - ID of the course
   */
  async enrollInCourse(
    teacherId: string,
    studentId: string,
    courseId: string,
    sectionId?: string
  ): Promise<void> {
    try {
      // Verify student ownership
      const student = await this.getManagedStudentById(teacherId, studentId);
      if (!student) {
        throw new ManagedStudentServiceError(
          'Student not found',
          'NOT_FOUND',
          404
        );
      }

      // Verify teacher has instructor role in the course
      const { data: teacherEnrollment, error: enrollmentError } = await supabase
        .from('course_enrollments')
        .select('role')
        .eq('user_id', teacherId)
        .eq('course_id', courseId)
        .single();

      if (enrollmentError || !teacherEnrollment) {
        throw new ManagedStudentServiceError(
          'You must be enrolled in the course to add students',
          'NOT_ENROLLED',
          403
        );
      }

      if (teacherEnrollment.role !== UserRole.INSTRUCTOR && teacherEnrollment.role !== 'admin') {
        throw new ManagedStudentServiceError(
          'Only instructors can add students to a course',
          'INSUFFICIENT_PERMISSIONS',
          403
        );
      }

      // Check if already enrolled
      const { data: existingEnrollment } = await supabase
        .from('course_enrollments')
        .select('id')
        .eq('user_id', studentId)
        .eq('course_id', courseId)
        .single();

      if (existingEnrollment) {
        // Already enrolled, no action needed
        return;
      }

      // Validate section belongs to course if provided
      if (sectionId) {
        const { data: section } = await supabase
          .from('sections')
          .select('id')
          .eq('id', sectionId)
          .eq('course_id', courseId)
          .single();

        if (!section) {
          throw new ManagedStudentServiceError(
            'Section not found in this course',
            'INVALID_SECTION',
            400
          );
        }
      }

      // Create enrollment
      const { error: createError } = await supabase
        .from('course_enrollments')
        .insert({
          user_id: studentId,
          course_id: courseId,
          role: UserRole.STUDENT,
          enrolled_at: new Date().toISOString(),
          section_id: sectionId || null,
        });

      if (createError) {
        throw createError;
      }

      logger.info('Managed student enrolled in course', {
        studentId,
        courseId,
        teacherId
      });
    } catch (error) {
      if (error instanceof ManagedStudentServiceError) {
        throw error;
      }
      logger.error('Failed to enroll managed student', {
        teacherId,
        studentId,
        courseId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ManagedStudentServiceError(
        'Failed to enroll student in course',
        'ENROLLMENT_ERROR',
        500
      );
    }
  }

  /**
   * Unenroll a managed student from a course
   * @param teacherId - ID of the teacher (for verification)
   * @param studentId - ID of the student
   * @param courseId - ID of the course
   */
  async unenrollFromCourse(
    teacherId: string,
    studentId: string,
    courseId: string
  ): Promise<void> {
    try {
      // Verify student ownership
      const student = await this.getManagedStudentById(teacherId, studentId);
      if (!student) {
        throw new ManagedStudentServiceError(
          'Student not found',
          'NOT_FOUND',
          404
        );
      }

      // Verify teacher has instructor role in the course
      const { data: teacherEnrollment, error: enrollmentError } = await supabase
        .from('course_enrollments')
        .select('role')
        .eq('user_id', teacherId)
        .eq('course_id', courseId)
        .single();

      if (enrollmentError || !teacherEnrollment) {
        throw new ManagedStudentServiceError(
          'You must be enrolled in the course to remove students',
          'NOT_ENROLLED',
          403
        );
      }

      if (teacherEnrollment.role !== UserRole.INSTRUCTOR && teacherEnrollment.role !== 'admin') {
        throw new ManagedStudentServiceError(
          'Only instructors can remove students from a course',
          'INSUFFICIENT_PERMISSIONS',
          403
        );
      }

      // Remove enrollment
      const { error: deleteError } = await supabase
        .from('course_enrollments')
        .delete()
        .eq('user_id', studentId)
        .eq('course_id', courseId);

      if (deleteError) {
        throw deleteError;
      }

      logger.info('Managed student unenrolled from course', {
        studentId,
        courseId,
        teacherId
      });
    } catch (error) {
      if (error instanceof ManagedStudentServiceError) {
        throw error;
      }
      logger.error('Failed to unenroll managed student', {
        teacherId,
        studentId,
        courseId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new ManagedStudentServiceError(
        'Failed to unenroll student from course',
        'UNENROLLMENT_ERROR',
        500
      );
    }
  }

  /**
   * Authenticate a managed student with username and password
   * @param username - The student's username
   * @param password - The student's password
   * @returns The managed student record if authentication succeeds, null otherwise
   */
  async authenticateManagedStudent(
    username: string,
    password: string
  ): Promise<ManagedStudent | null> {
    try {
      const student = await this.getManagedStudentByUsername(username);
      if (!student) {
        return null;
      }

      const isValid = await passwordService.verify(password, student.password_hash);
      if (!isValid) {
        return null;
      }

      // Return student without password_hash
      const { password_hash, ...studentData } = student;
      return studentData as ManagedStudent;
    } catch (error) {
      logger.error('Failed to authenticate managed student', {
        username,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return null;
    }
  }

  /**
   * Get courses where the teacher is an instructor (for enrollment dropdowns)
   * @param teacherId - ID of the teacher
   * @returns Array of courses
   */
  async getTeacherCourses(teacherId: string): Promise<Array<{ id: string; name: string }>> {
    try {
      const { data, error } = await supabase
        .from('course_enrollments')
        .select(`
          course_id,
          courses:course_id (id, name, deleted_at)
        `)
        .eq('user_id', teacherId)
        .eq('role', UserRole.INSTRUCTOR);

      if (error) {
        throw error;
      }

      // Filter out deleted courses and map to simple format
      return (data || [])
        .filter(e => (e.courses as any)?.deleted_at === null)
        .map(e => ({
          id: (e.courses as any).id,
          name: (e.courses as any).name
        }));
    } catch (error) {
      logger.error('Failed to get teacher courses', {
        teacherId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return [];
    }
  }
}

// Singleton instance
export const managedStudentService = new ManagedStudentService();

export default managedStudentService;
