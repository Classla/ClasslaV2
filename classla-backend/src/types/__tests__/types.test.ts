import {
  UserRole,
  SubmissionStatus,
  Course,
  User,
  Assignment,
  isUserRole,
  isSubmissionStatus,
  isValidUUID,
  isValidEmail,
  isValidSlug,
  validateRequiredFields,
  CreateCourseRequest,
  ApiResponse
} from '../index';

describe('Type System', () => {
  describe('Enums', () => {
    test('UserRole enum should have correct values', () => {
      expect(UserRole.INSTRUCTOR).toBe('instructor');
      expect(UserRole.ADMIN).toBe('admin');
      expect(UserRole.TEACHING_ASSISTANT).toBe('teaching_assistant');
      expect(UserRole.STUDENT).toBe('student');
      expect(UserRole.AUDIT).toBe('audit');
    });

    test('SubmissionStatus enum should have correct values', () => {
      expect(SubmissionStatus.SUBMITTED).toBe('submitted');
      expect(SubmissionStatus.GRADED).toBe('graded');
      expect(SubmissionStatus.RETURNED).toBe('returned');
      expect(SubmissionStatus.IN_PROGRESS).toBe('in-progress');
    });
  });

  describe('Type Guards', () => {
    test('isUserRole should validate user roles correctly', () => {
      expect(isUserRole('instructor')).toBe(true);
      expect(isUserRole('admin')).toBe(true);
      expect(isUserRole('invalid_role')).toBe(false);
      expect(isUserRole(null)).toBe(false);
    });

    test('isSubmissionStatus should validate submission status correctly', () => {
      expect(isSubmissionStatus('submitted')).toBe(true);
      expect(isSubmissionStatus('graded')).toBe(true);
      expect(isSubmissionStatus('invalid_status')).toBe(false);
    });

    test('isValidUUID should validate UUIDs correctly', () => {
      expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(isValidUUID('invalid-uuid')).toBe(false);
      expect(isValidUUID('')).toBe(false);
    });

    test('isValidEmail should validate emails correctly', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('invalid-email')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });

    test('isValidSlug should validate slugs correctly', () => {
      expect(isValidSlug('valid-slug')).toBe(true);
      expect(isValidSlug('validslug')).toBe(true);
      expect(isValidSlug('valid-slug-123')).toBe(true);
      expect(isValidSlug('Invalid_Slug')).toBe(false);
      expect(isValidSlug('invalid slug')).toBe(false);
    });
  });

  describe('Validation Helpers', () => {
    test('validateRequiredFields should identify missing fields', () => {
      const testObj = { name: 'Test', email: 'test@example.com', phone: undefined };
      
      const result1 = validateRequiredFields(testObj, ['name', 'email']);
      expect(result1.isValid).toBe(true);
      expect(result1.missingFields).toEqual([]);

      const result2 = validateRequiredFields(testObj, ['name', 'email', 'phone']);
      expect(result2.isValid).toBe(false);
      expect(result2.missingFields).toEqual(['phone']);
    });
  });

  describe('Interface Compatibility', () => {
    test('Course interface should be properly typed', () => {
      const course: Course = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        name: 'Test Course',
        settings: { theme: 'dark' },
        thumbnail_url: 'https://example.com/thumb.jpg',
        summary_content: 'Course summary',
        slug: 'test-course',
        created_by_id: '550e8400-e29b-41d4-a716-446655440001',
        created_at: new Date()
      };

      expect(course.name).toBe('Test Course');
      expect(course.slug).toBe('test-course');
    });

    test('API request types should be properly typed', () => {
      const createRequest: CreateCourseRequest = {
        name: 'New Course',
        slug: 'new-course',
        settings: { public: true }
      };

      expect(createRequest.name).toBe('New Course');
      expect(createRequest.slug).toBe('new-course');
    });

    test('API response wrapper should be properly typed', () => {
      const response: ApiResponse<Course> = {
        data: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Test Course',
          settings: {},
          thumbnail_url: '',
          summary_content: '',
          slug: 'test-course',
          created_by_id: '550e8400-e29b-41d4-a716-446655440001',
          created_at: new Date()
        },
        success: true,
        message: 'Course retrieved successfully'
      };

      expect(response.success).toBe(true);
      expect(response.data.name).toBe('Test Course');
    });
  });
});