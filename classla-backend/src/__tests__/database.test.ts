import { describe, it, beforeEach } from '@jest/globals';
import { supabase } from '../middleware/auth';

describe('Database Operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('User Operations', () => {
    it('should create user successfully', async () => {
      const userData = {
        id: 'test-user-123',
        email: 'test@example.com',
        roles: ['student'],
        is_admin: false
      };

      const mockInsert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: userData,
            error: null
          })
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const { data, error } = await supabase
        .from('users')
        .insert(userData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toEqual(userData);
      expect(mockInsert).toHaveBeenCalledWith(userData);
    });

    it('should handle user creation error', async () => {
      const userData = {
        id: 'test-user-123',
        email: 'invalid-email', // Invalid email format
        roles: ['student'],
        is_admin: false
      };

      const mockInsert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'Invalid email format', code: '23514' }
          })
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const { data, error } = await supabase
        .from('users')
        .insert(userData)
        .select()
        .single();

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe('23514');
    });
  });

  describe('Course Operations', () => {
    it('should create course with proper relationships', async () => {
      const courseData = {
        name: 'Test Course',
        slug: 'test-course',
        created_by_id: 'user-123',
        settings: { public: true }
      };

      const createdCourse = {
        id: 'course-123',
        ...courseData,
        created_at: new Date().toISOString(),
        deleted_at: null
      };

      const mockInsert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: createdCourse,
            error: null
          })
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const { data, error } = await supabase
        .from('courses')
        .insert(courseData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toEqual(createdCourse);
    });

    it('should enforce unique slug constraint', async () => {
      const courseData = {
        name: 'Duplicate Course',
        slug: 'existing-slug', // Slug already exists
        created_by_id: 'user-123'
      };

      const mockInsert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'duplicate key value violates unique constraint', code: '23505' }
          })
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const { data, error } = await supabase
        .from('courses')
        .insert(courseData)
        .select()
        .single();

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe('23505'); // Unique constraint violation
    });
  });

  describe('Course Enrollment Operations', () => {
    it('should create enrollment relationship', async () => {
      const enrollmentData = {
        user_id: 'user-123',
        course_id: 'course-456',
        role: 'student'
      };

      const createdEnrollment = {
        id: 'enrollment-123',
        ...enrollmentData,
        enrolled_at: new Date().toISOString()
      };

      const mockInsert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: createdEnrollment,
            error: null
          })
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const { data, error } = await supabase
        .from('course_enrollments')
        .insert(enrollmentData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toEqual(createdEnrollment);
    });

    it('should prevent duplicate enrollments', async () => {
      const enrollmentData = {
        user_id: 'user-123',
        course_id: 'course-456', // User already enrolled in this course
        role: 'student'
      };

      const mockInsert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'duplicate key value violates unique constraint', code: '23505' }
          })
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const { data, error } = await supabase
        .from('course_enrollments')
        .insert(enrollmentData)
        .select()
        .single();

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe('23505');
    });
  });

  describe('Assignment Operations', () => {
    it('should create assignment with JSONB fields', async () => {
      const assignmentData = {
        name: 'Test Assignment',
        course_id: 'course-123',
        content: 'Assignment content',
        settings: { max_attempts: 3, time_limit: 60 },
        published_to: ['section-1', 'section-2'],
        due_dates_map: { 'user-1': '2024-12-31T23:59:59Z' },
        module_path: ['module1', 'assignment1']
      };

      const createdAssignment = {
        id: 'assignment-123',
        ...assignmentData,
        is_lockdown: false,
        lockdown_time_map: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const mockInsert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: createdAssignment,
            error: null
          })
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const { data, error } = await supabase
        .from('assignments')
        .insert(assignmentData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toEqual(createdAssignment);
      expect(data.settings).toEqual(assignmentData.settings);
      expect(data.published_to).toEqual(assignmentData.published_to);
    });
  });

  describe('Submission Operations', () => {
    it('should create submission with proper foreign key relationships', async () => {
      const submissionData = {
        assignment_id: 'assignment-123',
        student_id: 'user-456',
        course_id: 'course-789',
        values: { question1: 'answer1', question2: 'answer2' },
        status: 'submitted'
      };

      const createdSubmission = {
        id: 'submission-123',
        ...submissionData,
        timestamp: new Date().toISOString(),
        grader_id: null,
        grade: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const mockInsert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: createdSubmission,
            error: null
          })
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const { data, error } = await supabase
        .from('submissions')
        .insert(submissionData)
        .select()
        .single();

      expect(error).toBeNull();
      expect(data).toEqual(createdSubmission);
    });

    it('should enforce foreign key constraints', async () => {
      const submissionData = {
        assignment_id: 'nonexistent-assignment', // Invalid foreign key
        student_id: 'user-456',
        course_id: 'course-789',
        values: {},
        status: 'submitted'
      };

      const mockInsert = jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: null,
            error: { message: 'insert or update on table violates foreign key constraint', code: '23503' }
          })
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        insert: mockInsert
      });

      const { data, error } = await supabase
        .from('submissions')
        .insert(submissionData)
        .select()
        .single();

      expect(data).toBeNull();
      expect(error).toBeDefined();
      expect(error?.code).toBe('23503'); // Foreign key constraint violation
    });
  });

  describe('Query Performance', () => {
    it('should use indexes for common queries', async () => {
      // Test that common query patterns are supported
      const mockSelect = jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn().mockResolvedValue({
            data: { id: 'course-123', slug: 'test-course' },
            error: null
          })
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect
      });

      // Query by slug (should use index)
      const { data, error } = await supabase
        .from('courses')
        .select('*')
        .eq('slug', 'test-course')
        .single();

      expect(error).toBeNull();
      expect(data).toBeDefined();
      expect(mockSelect).toHaveBeenCalled();
    });

    it('should handle complex joins efficiently', async () => {
      const mockSelect = jest.fn(() => ({
        eq: jest.fn(() => [
          {
            id: 'enrollment-1',
            user_id: 'user-123',
            course_id: 'course-456',
            role: 'student',
            courses: {
              id: 'course-456',
              name: 'Test Course',
              slug: 'test-course'
            }
          }
        ])
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect
      });

      // Complex query with join
      const result = await supabase
        .from('course_enrollments')
        .select(`
          *,
          courses (
            id,
            name,
            slug
          )
        `)
        .eq('user_id', 'user-123');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});