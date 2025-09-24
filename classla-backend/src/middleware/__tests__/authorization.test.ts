import { Request, Response, NextFunction } from 'express';
import {
  hasRole,
  hasAnyRole,
  getUserCourseRole,
  isEnrolledInCourse,
  getCoursePermissions,
  requireRoles,
  requireAdmin,
  requireCourseEnrollment,
  requireCoursePermission,
  requireOwnershipOrElevated
} from '../authorization';
import { UserRole } from '../../types/enums';
import { AuthenticationError, AuthorizationError } from '../errorHandler';
import { supabase } from '../auth';
import { describe, it, beforeEach } from '@jest/globals';

// Mock Supabase
jest.mock('../auth', () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn()
        }))
      }))
    }))
  }
}));

describe('Authorization Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      params: {},
      body: {},
      query: {},
      path: '/test'
    };
    mockResponse = {};
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('hasRole', () => {
    it('should return true when user has the required role', () => {
      const roles = ['student', 'instructor'];
      expect(hasRole(roles, UserRole.INSTRUCTOR)).toBe(true);
    });

    it('should return false when user does not have the required role', () => {
      const roles = ['student'];
      expect(hasRole(roles, UserRole.INSTRUCTOR)).toBe(false);
    });
  });

  describe('hasAnyRole', () => {
    it('should return true when user has any of the required roles', () => {
      const roles = ['student', 'teaching_assistant'];
      const requiredRoles = [UserRole.INSTRUCTOR, UserRole.TEACHING_ASSISTANT];
      expect(hasAnyRole(roles, requiredRoles)).toBe(true);
    });

    it('should return false when user has none of the required roles', () => {
      const roles = ['student'];
      const requiredRoles = [UserRole.INSTRUCTOR, UserRole.TEACHING_ASSISTANT];
      expect(hasAnyRole(roles, requiredRoles)).toBe(false);
    });
  });

  describe('getUserCourseRole', () => {
    it('should return user role when enrolled in course', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: { role: UserRole.STUDENT },
        error: null
      });

      const mockEq2 = jest.fn(() => ({ single: mockSingle }));
      const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
      const mockSelect = jest.fn(() => ({ eq: mockEq1 }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect
      });

      const role = await getUserCourseRole('user-123', 'course-456');
      expect(role).toBe(UserRole.STUDENT);
    });

    it('should return null when user is not enrolled in course', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' }
      });

      const mockEq2 = jest.fn(() => ({ single: mockSingle }));
      const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
      const mockSelect = jest.fn(() => ({ eq: mockEq1 }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect
      });

      const role = await getUserCourseRole('user-123', 'course-456');
      expect(role).toBeNull();
    });
  });

  describe('isEnrolledInCourse', () => {
    it('should return true when user is enrolled', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: { role: UserRole.STUDENT },
        error: null
      });

      const mockEq2 = jest.fn(() => ({ single: mockSingle }));
      const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
      const mockSelect = jest.fn(() => ({ eq: mockEq1 }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect
      });

      const isEnrolled = await isEnrolledInCourse('user-123', 'course-456');
      expect(isEnrolled).toBe(true);
    });

    it('should return false when user is not enrolled', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' }
      });

      const mockEq2 = jest.fn(() => ({ single: mockSingle }));
      const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
      const mockSelect = jest.fn(() => ({ eq: mockEq1 }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect
      });

      const isEnrolled = await isEnrolledInCourse('user-123', 'course-456');
      expect(isEnrolled).toBe(false);
    });
  });

  describe('getCoursePermissions', () => {
    beforeEach(() => {
      const mockSelect = jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn()
        }))
      }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect
      });
    });

    it('should return full permissions for admin users', async () => {
      const permissions = await getCoursePermissions('user-123', 'course-456', true);
      
      expect(permissions).toEqual({
        canRead: true,
        canWrite: true,
        canGrade: true,
        canManage: true
      });
    });

    it('should return instructor permissions', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: { role: UserRole.INSTRUCTOR },
        error: null
      });

      const mockEq2 = jest.fn(() => ({ single: mockSingle }));
      const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
      const mockSelect = jest.fn(() => ({ eq: mockEq1 }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect
      });

      const permissions = await getCoursePermissions('user-123', 'course-456', false);
      
      expect(permissions).toEqual({
        canRead: true,
        canWrite: true,
        canGrade: true,
        canManage: true
      });
    });

    it('should return student permissions', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: { role: UserRole.STUDENT },
        error: null
      });

      const mockEq2 = jest.fn(() => ({ single: mockSingle }));
      const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
      const mockSelect = jest.fn(() => ({ eq: mockEq1 }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect
      });

      const permissions = await getCoursePermissions('user-123', 'course-456', false);
      
      expect(permissions).toEqual({
        canRead: true,
        canWrite: false,
        canGrade: false,
        canManage: false
      });
    });

    it('should return no permissions for unenrolled users', async () => {
      const mockSingle = jest.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116' }
      });

      const mockEq2 = jest.fn(() => ({ single: mockSingle }));
      const mockEq1 = jest.fn(() => ({ eq: mockEq2 }));
      const mockSelect = jest.fn(() => ({ eq: mockEq1 }));

      (supabase.from as jest.Mock).mockReturnValue({
        select: mockSelect
      });

      const permissions = await getCoursePermissions('user-123', 'course-456', false);
      
      expect(permissions).toEqual({
        canRead: false,
        canWrite: false,
        canGrade: false,
        canManage: false
      });
    });
  });

  describe('requireRoles middleware', () => {
    it('should throw AuthenticationError when no user is present', async () => {
      const middleware = requireRoles([UserRole.INSTRUCTOR]);
      
      await expect(async () => {
        await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      }).rejects.toThrow(AuthenticationError);
    });

    it('should call next() for admin users regardless of roles', async () => {
      mockRequest.user = {
        id: 'user-123',
        workosUserId: 'workos-123',
        roles: ['student'],
        isAdmin: true
      };

      const middleware = requireRoles([UserRole.INSTRUCTOR]);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next() when user has required role', async () => {
      mockRequest.user = {
        id: 'user-123',
        workosUserId: 'workos-123',
        roles: ['instructor'],
        isAdmin: false
      };

      const middleware = requireRoles([UserRole.INSTRUCTOR]);
      await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should throw AuthorizationError when user lacks required role', async () => {
      mockRequest.user = {
        id: 'user-123',
        workosUserId: 'workos-123',
        roles: ['student'],
        isAdmin: false
      };

      const middleware = requireRoles([UserRole.INSTRUCTOR]);
      
      await expect(async () => {
        await middleware(mockRequest as Request, mockResponse as Response, mockNext);
      }).rejects.toThrow(AuthorizationError);
    });
  });

  describe('requireAdmin middleware', () => {
    it('should throw AuthenticationError when no user is present', async () => {
      await expect(async () => {
        await requireAdmin(mockRequest as Request, mockResponse as Response, mockNext);
      }).rejects.toThrow(AuthenticationError);
    });

    it('should call next() for admin users', async () => {
      mockRequest.user = {
        id: 'user-123',
        workosUserId: 'workos-123',
        isAdmin: true
      };

      await requireAdmin(mockRequest as Request, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
    });

    it('should throw AuthorizationError for non-admin users', async () => {
      mockRequest.user = {
        id: 'user-123',
        workosUserId: 'workos-123',
        isAdmin: false
      };

      await expect(async () => {
        await requireAdmin(mockRequest as Request, mockResponse as Response, mockNext);
      }).rejects.toThrow(AuthorizationError);
    });
  });

  describe('requireOwnershipOrElevated middleware', () => {
    it('should call next() when user accesses their own resources', () => {
      mockRequest.user = {
        id: 'user-123',
        workosUserId: 'workos-123',
        roles: ['student'],
        isAdmin: false
      };
      mockRequest.params = { userId: 'user-123' };

      const middleware = requireOwnershipOrElevated();
      middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next() for admin users accessing other resources', () => {
      mockRequest.user = {
        id: 'user-123',
        workosUserId: 'workos-123',
        roles: ['student'],
        isAdmin: true
      };
      mockRequest.params = { userId: 'user-456' };

      const middleware = requireOwnershipOrElevated();
      middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });

    it('should call next() for instructors accessing other resources', () => {
      mockRequest.user = {
        id: 'user-123',
        workosUserId: 'workos-123',
        roles: ['instructor'],
        isAdmin: false
      };
      mockRequest.params = { userId: 'user-456' };

      const middleware = requireOwnershipOrElevated();
      middleware(mockRequest as Request, mockResponse as Response, mockNext);
      
      expect(mockNext).toHaveBeenCalled();
    });
  });
});