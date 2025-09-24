import { Request, Response, NextFunction } from 'express';
import { supabase } from './auth';
import { UserRole } from '../types/enums';
import { AuthenticationError, AuthorizationError, ValidationError, asyncHandler } from './errorHandler';

/**
 * Interface for course permissions
 */
export interface CoursePermissions {
  canRead: boolean;
  canWrite: boolean;
  canGrade: boolean;
  canManage: boolean;
}

/**
 * Check if user has a specific role
 */
export const hasRole = (roles: string[], requiredRole: UserRole): boolean => {
  return roles.includes(requiredRole);
};

/**
 * Check if user has any of the specified roles
 */
export const hasAnyRole = (roles: string[], requiredRoles: UserRole[]): boolean => {
  return requiredRoles.some(role => roles.includes(role));
};

/**
 * Get user's role in a specific course
 */
export const getUserCourseRole = async (userId: string, courseId: string): Promise<UserRole | null> => {
  try {
    const { data, error } = await supabase
      .from('course_enrollments')
      .select('role')
      .eq('user_id', userId)
      .eq('course_id', courseId)
      .single();

    if (error || !data) {
      return null;
    }

    return data.role as UserRole;
  } catch (error) {
    console.error('Error getting user course role:', error);
    return null;
  }
};

/**
 * Check if user is enrolled in a course
 */
export const isEnrolledInCourse = async (userId: string, courseId: string): Promise<boolean> => {
  const role = await getUserCourseRole(userId, courseId);
  return role !== null;
};

/**
 * Get course permissions for a user
 */
export const getCoursePermissions = async (
  userId: string, 
  courseId: string, 
  isAdmin: boolean = false
): Promise<CoursePermissions> => {
  // Admins have full permissions
  if (isAdmin) {
    return {
      canRead: true,
      canWrite: true,
      canGrade: true,
      canManage: true
    };
  }

  const userRole = await getUserCourseRole(userId, courseId);

  if (!userRole) {
    // Not enrolled in course
    return {
      canRead: false,
      canWrite: false,
      canGrade: false,
      canManage: false
    };
  }

  switch (userRole) {
    case UserRole.INSTRUCTOR:
      return {
        canRead: true,
        canWrite: true,
        canGrade: true,
        canManage: true
      };
    
    case UserRole.TEACHING_ASSISTANT:
      return {
        canRead: true,
        canWrite: false,
        canGrade: true,
        canManage: false
      };
    
    case UserRole.STUDENT:
      return {
        canRead: true,
        canWrite: false,
        canGrade: false,
        canManage: false
      };
    
    case UserRole.AUDIT:
      return {
        canRead: true,
        canWrite: false,
        canGrade: false,
        canManage: false
      };
    
    default:
      return {
        canRead: false,
        canWrite: false,
        canGrade: false,
        canManage: false
      };
  }
};

/**
 * Middleware to require specific roles
 */
export const requireRoles = (requiredRoles: UserRole[]) => {
  return asyncHandler((req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthenticationError();
    }

    const { roles = [], isAdmin } = req.user;

    // Admins bypass role checks
    if (isAdmin) {
      next();
      return;
    }

    // Check if user has any of the required roles
    if (!hasAnyRole(roles, requiredRoles)) {
      throw new AuthorizationError(`Required roles: ${requiredRoles.join(', ')}`);
    }

    next();
  });
};

/**
 * Middleware to require admin privileges
 */
export const requireAdmin = asyncHandler((req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    throw new AuthenticationError();
  }

  if (!req.user.isAdmin) {
    throw new AuthorizationError('Admin privileges required');
  }

  next();
});

/**
 * Middleware to require course enrollment
 */
export const requireCourseEnrollment = (courseIdParam: string = 'courseId') => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    const courseId = req.params[courseIdParam] || req.body.courseId || req.query.courseId;

    if (!courseId) {
      res.status(400).json({
        error: {
          code: 'MISSING_COURSE_ID',
          message: 'Course ID is required',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    const { id: userId, isAdmin } = req.user;

    // Admins bypass enrollment checks
    if (isAdmin) {
      next();
      return;
    }

    const isEnrolled = await isEnrolledInCourse(userId, courseId);

    if (!isEnrolled) {
      res.status(403).json({
        error: {
          code: 'NOT_ENROLLED',
          message: 'User is not enrolled in this course',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    next();
  };
};

/**
 * Middleware to require specific course permissions
 */
export const requireCoursePermission = (
  permission: keyof CoursePermissions,
  courseIdParam: string = 'courseId'
) => {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    const courseId = req.params[courseIdParam] || req.body.courseId || req.query.courseId;

    if (!courseId) {
      res.status(400).json({
        error: {
          code: 'MISSING_COURSE_ID',
          message: 'Course ID is required',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    const { id: userId, isAdmin } = req.user;
    const permissions = await getCoursePermissions(userId, courseId, isAdmin);

    if (!permissions[permission]) {
      res.status(403).json({
        error: {
          code: 'INSUFFICIENT_COURSE_PERMISSIONS',
          message: `Required permission: ${permission}`,
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    next();
  };
};

/**
 * Middleware to check if user can access their own resources or has elevated permissions
 */
export const requireOwnershipOrElevated = (userIdParam: string = 'userId') => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          timestamp: new Date().toISOString(),
          path: req.path
        }
      });
      return;
    }

    const targetUserId = req.params[userIdParam] || req.body.userId || req.query.userId;
    const { id: currentUserId, isAdmin, roles = [] } = req.user;

    // Allow if user is accessing their own resources
    if (currentUserId === targetUserId) {
      next();
      return;
    }

    // Allow if user is admin
    if (isAdmin) {
      next();
      return;
    }

    // Allow if user has instructor or teaching assistant role
    if (hasAnyRole(roles, [UserRole.INSTRUCTOR, UserRole.TEACHING_ASSISTANT])) {
      next();
      return;
    }

    res.status(403).json({
      error: {
        code: 'ACCESS_DENIED',
        message: 'Can only access own resources or need elevated permissions',
        timestamp: new Date().toISOString(),
        path: req.path
      }
    });
  };
};