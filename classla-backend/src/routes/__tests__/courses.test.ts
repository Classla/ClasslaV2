// Set up environment variables before any imports
const originalEnv = process.env;
process.env = {
  ...originalEnv,
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test_service_key'
};

// Mock services and middleware before importing
jest.mock('../../middleware/auth');
jest.mock('../../middleware/authorization');
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

import request from 'supertest';
import express from 'express';
import coursesRouter from '../courses';
import { authenticateToken } from '../../middleware/auth';
import { 
  requireRoles,
  requireCoursePermission,
  getCoursePermissions 
} from '../../middleware/authorization';
import { 
  createTestApp, 
  createMockAuthMiddleware, 
  mockSupabase,
  defaultMockUser,
  mockInstructorUser,
  mockAdminUser,
  clearAllMocks 
} from '../../__tests__/helpers/auth-test-helper';
import { UserRole } from '../../types/enums';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { beforeEach } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { beforeEach } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { beforeEach } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { it } from 'node:test';
import { describe } from 'node:test';
import { beforeEach } from 'node:test';
import { describe } from 'node:test';

const mockAuthenticateToken = authenticateToken as jest.MockedFunction<typeof authenticateToken>;
const mockRequireRoles = requireRoles as jest.MockedFunction<typeof requireRoles>;
const mockRequireCoursePermission = requireCoursePermission as jest.MockedFunction<typeof requireCoursePermission>;
const mockGetCoursePermissions = getCoursePermissions as jest.MockedFunction<typeof getCoursePermissions>;

describe('Courses Routes', () => {
  let app: express.Application;

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    app = createTestApp(coursesRouter);
    clearAllMocks();

    // Set up default middleware mocks
    mockAuthenticateToken.mockImplementation(createMockAuthMiddleware(defaultMockUser));
    mockRequireRoles.mockImplementation(() => (req: any, res: any, next: any) => next());
    mockRequireCoursePermission.mockImplementation(() => (req: any, res: any, next: any) => next());
    mockGetCoursePermissions.mockResolvedValue({
      canRead: true,
      canWrite: false,
      canManage: false,
      canGrade: false
    });
  });

  describe('GET /course/by-slug/:slug', () => {
    const mockCourseData = {
      id: 'course-123',
      name: 'Test Course',
      slug: 'test-course',
      description: 'A test course',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null
    };

    it('should return course data for authenticated user', async () => {
      const mockQueryBuilder = mockSupabase.from();
      mockQueryBuilder.single.mockResolvedValue({
        data: mockCourseData,
        error: null
      });

      const response = await request(app)
        .get('/course/by-slug/test-course')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.course).toEqual({
        id: mockCourseData.id,
        name: mockCourseData.name,
        slug: mockCourseData.slug,
        description: mockCourseData.description,
        createdAt: mockCourseData.created_at,
        updatedAt: mockCourseData.updated_at
      });

      expect(mockAuthenticateToken).toHaveBeenCalled();
    });

    it('should return 404 when course not found', async () => {
      const mockQueryBuilder = mockSupabase.from();
      mockQueryBuilder.single.mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' }
      });

      const response = await request(app)
        .get('/course/by-slug/nonexistent-course')
        .expect(404);

      expect(response.body).toEqual({
        error: {
          code: 'COURSE_NOT_FOUND',
          message: 'Course not found'
        }
      });
    });

    it('should handle database errors', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database connection error' }
              })
            })
          })
        })
      });

      const response = await request(app)
        .get('/course/by-slug/test-course')
        .expect(500);

      expect(response.body.error.code).toBe('INTERNAL_SERVER_ERROR');
    });
  });

  describe('GET /course/:id', () => {
    const mockCourseData = {
      id: 'course-123',
      name: 'Test Course',
      slug: 'test-course',
      description: 'A test course',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null
    };

    it('should return course data by ID', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: mockCourseData,
                error: null
              })
            })
          })
        })
      });

      const response = await request(app)
        .get('/course/course-123')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.course.id).toBe('course-123');
      expect(mockAuthenticateToken).toHaveBeenCalled();
    });
  });

  describe('GET /courses', () => {
    const mockCoursesData = [
      {
        id: 'course-1',
        name: 'Course 1',
        slug: 'course-1',
        description: 'First course',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null
      },
      {
        id: 'course-2',
        name: 'Course 2',
        slug: 'course-2',
        description: 'Second course',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null
      }
    ];

    it('should return courses by IDs', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            is: jest.fn().mockResolvedValue({
              data: mockCoursesData,
              error: null
            })
          })
        })
      });

      const response = await request(app)
        .get('/courses?ids=course-1,course-2')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.courses).toHaveLength(2);
      expect(mockAuthenticateToken).toHaveBeenCalled();
    });

    it('should return courses by slugs', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            is: jest.fn().mockResolvedValue({
              data: mockCoursesData,
              error: null
            })
          })
        })
      });

      const response = await request(app)
        .get('/courses?slugs=course-1,course-2')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.courses).toHaveLength(2);
    });

    it('should handle empty results', async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          in: jest.fn().mockReturnValue({
            is: jest.fn().mockResolvedValue({
              data: [],
              error: null
            })
          })
        })
      });

      const response = await request(app)
        .get('/courses?ids=nonexistent')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.courses).toHaveLength(0);
    });
  });

  describe('POST /course', () => {
    const courseRequest = {
      name: 'New Course',
      slug: 'new-course',
      description: 'A new test course'
    };

    beforeEach(() => {
      // Mock instructor authentication for course creation
      mockAuthenticateToken.mockImplementation(createMockAuthMiddleware(mockInstructorUser));
    });

    it('should create course successfully', async () => {
      const createdCourse = {
        id: 'new-course-123',
        ...courseRequest,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null
      };

      mockSupabase.from.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: createdCourse,
              error: null
            })
          })
        })
      });

      const response = await request(app)
        .post('/course')
        .send(courseRequest)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.course.name).toBe('New Course');
      expect(response.body.course.slug).toBe('new-course');
      expect(mockRequireRoles).toHaveBeenCalledWith([UserRole.INSTRUCTOR, UserRole.ADMIN]);
    });

    it('should handle duplicate slug error', async () => {
      mockSupabase.from.mockReturnValue({
        insert: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { code: '23505', message: 'duplicate key value violates unique constraint' }
            })
          })
        })
      });

      const response = await request(app)
        .post('/course')
        .send(courseRequest)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('DUPLICATE_SLUG');
    });

    it('should require instructor or admin role', async () => {
      // Mock student authentication (should be rejected)
      mockAuthenticateToken.mockImplementation(createMockAuthMiddleware(defaultMockUser));
      mockRequireRoles.mockImplementation(() => (req: any, res: any, next: any) => {
        res.status(403).json({
          success: false,
          error: 'Insufficient permissions',
          code: 'INSUFFICIENT_PERMISSIONS'
        });
      });

      const response = await request(app)
        .post('/course')
        .send(courseRequest)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('should validate required fields', async () => {
      const response = await request(app)
        .post('/course')
        .send({}) // Empty request
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('PUT /course/:id', () => {
    const updateRequest = {
      name: 'Updated Course Name',
      description: 'Updated description'
    };

    beforeEach(() => {
      // Mock instructor authentication for course updates
      mockAuthenticateToken.mockImplementation(createMockAuthMiddleware(mockInstructorUser));
    });

    it('should update course successfully', async () => {
      const updatedCourse = {
        id: 'course-123',
        name: 'Updated Course Name',
        slug: 'test-course',
        description: 'Updated description',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null
      };

      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: updatedCourse,
                error: null
              })
            })
          })
        })
      });

      const response = await request(app)
        .put('/course/course-123')
        .send(updateRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.course.name).toBe('Updated Course Name');
      expect(mockRequireCoursePermission).toHaveBeenCalledWith('canManage', 'id');
    });

    it('should return 404 when course not found', async () => {
      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: { code: 'PGRST116' }
              })
            })
          })
        })
      });

      const response = await request(app)
        .put('/course/nonexistent-course')
        .send(updateRequest)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('COURSE_NOT_FOUND');
    });
  });

  describe('DELETE /course/:id', () => {
    beforeEach(() => {
      // Mock instructor authentication for course deletion
      mockAuthenticateToken.mockImplementation(createMockAuthMiddleware(mockInstructorUser));
    });

    it('should soft delete course successfully', async () => {
      const deletedCourse = {
        id: 'course-123',
        name: 'Test Course',
        slug: 'test-course',
        description: 'A test course',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: new Date().toISOString()
      };

      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: deletedCourse,
                error: null
              })
            })
          })
        })
      });

      const response = await request(app)
        .delete('/course/course-123')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Course deleted successfully');
      expect(mockRequireCoursePermission).toHaveBeenCalledWith('canManage', 'id');
    });

    it('should return 404 when course not found', async () => {
      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: { code: 'PGRST116' }
              })
            })
          })
        })
      });

      const response = await request(app)
        .delete('/course/nonexistent-course')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('COURSE_NOT_FOUND');
    });
  });

  describe('Authentication and Authorization Integration', () => {
    it('should properly enforce course permissions', async () => {
      // Test that course permission middleware is called
      mockRequireCoursePermission.mockImplementation(() => (req: any, res: any, next: any) => {
        // Simulate permission check failure
        res.status(403).json({
          success: false,
          error: 'Insufficient course permissions',
          code: 'INSUFFICIENT_COURSE_PERMISSIONS'
        });
      });

      const response = await request(app)
        .put('/course/course-123')
        .send({ name: 'Updated Name' })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INSUFFICIENT_COURSE_PERMISSIONS');
      expect(mockRequireCoursePermission).toHaveBeenCalledWith('canManage', 'id');
    });

    it('should require authentication for all endpoints', async () => {
      // Mock authentication failure
      mockAuthenticateToken.mockImplementation((req: any, res: any, next: any) => {
        res.status(401).json({
          success: false,
          error: 'Authentication required',
          code: 'AUTHENTICATION_REQUIRED'
        });
      });

      const response = await request(app)
        .get('/course/by-slug/test-course')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });
});