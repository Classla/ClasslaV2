import { Request, Response, NextFunction } from "express";
import { supabase } from "./auth";
import { UserRole } from "../types/enums";
import { TAPermissions } from "../types/entities";
import {
  AuthenticationError,
  AuthorizationError,
  ValidationError,
  asyncHandler,
} from "./errorHandler";

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
export const hasAnyRole = (
  roles: string[],
  requiredRoles: UserRole[]
): boolean => {
  return requiredRoles.some((role) => roles.includes(role));
};

/**
 * Get user's role in a specific course
 */
export const getUserCourseRole = async (
  userId: string,
  courseId: string
): Promise<UserRole | null> => {
  try {
    const { data, error } = await supabase
      .from("course_enrollments")
      .select("role")
      .eq("user_id", userId)
      .eq("course_id", courseId)
      .single();

    if (error || !data) {
      return null;
    }

    return data.role as UserRole;
  } catch (error) {
    console.error("Error getting user course role:", error);
    return null;
  }
};

/**
 * Check if user is enrolled in a course
 */
export const isEnrolledInCourse = async (
  userId: string,
  courseId: string
): Promise<boolean> => {
  const role = await getUserCourseRole(userId, courseId);
  return role !== null;
};

/**
 * Get default TA permissions for a course
 */
export const getTAPermissionsDefault = async (
  courseId: string
): Promise<TAPermissions> => {
  try {
    const { data: course, error } = await supabase
      .from("courses")
      .select("settings")
      .eq("id", courseId)
      .single();

    if (error || !course?.settings) {
      console.log(`[getTAPermissionsDefault] No settings found for courseId=${courseId}`, { error, hasSettings: !!course?.settings });
      // Return all false if no settings or course not found
      return {
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canViewStudents: false,
        canViewGrades: false,
      };
    }

    const defaultPerms = course.settings.ta_permissions_default;
    console.log(`[getTAPermissionsDefault] courseId=${courseId}, defaultPerms:`, defaultPerms);
    if (!defaultPerms || typeof defaultPerms !== "object") {
      return {
        canCreate: false,
        canEdit: false,
        canDelete: false,
        canViewStudents: false,
        canViewGrades: false,
      };
    }

    return {
      canCreate: defaultPerms.canCreate === true,
      canEdit: defaultPerms.canEdit === true,
      canDelete: defaultPerms.canDelete === true,
      canViewStudents: defaultPerms.canViewStudents === true,
      canViewGrades: defaultPerms.canViewGrades === true,
    };
  } catch (error) {
    console.error("Error getting TA permissions default:", error);
    return {
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canViewStudents: false,
      canViewGrades: false,
    };
  }
};

/**
 * Get individual TA permissions override for a specific user
 */
export const getTAPermissionsOverride = async (
  userId: string,
  courseId: string
): Promise<TAPermissions | null> => {
  try {
    const { data: course, error } = await supabase
      .from("courses")
      .select("settings")
      .eq("id", courseId)
      .single();

    if (error || !course?.settings) {
      console.log(`[getTAPermissionsOverride] No settings found for courseId=${courseId}`, { error, hasSettings: !!course?.settings });
      return null;
    }

    const taPerms = course.settings.ta_permissions;
    console.log(`[getTAPermissionsOverride] courseId=${courseId}, userId=${userId}, taPerms:`, taPerms);
    if (!taPerms || typeof taPerms !== "object" || Array.isArray(taPerms)) {
      return null;
    }

    const userPerms = taPerms[userId];
    console.log(`[getTAPermissionsOverride] userPerms for userId=${userId}:`, userPerms);
    if (!userPerms || typeof userPerms !== "object") {
      return null;
    }

    return {
      canCreate: userPerms.canCreate === true,
      canEdit: userPerms.canEdit === true,
      canDelete: userPerms.canDelete === true,
      canViewStudents: userPerms.canViewStudents === true,
      canViewGrades: userPerms.canViewGrades === true,
    };
  } catch (error) {
    console.error("Error getting TA permissions override:", error);
    return null;
  }
};

/**
 * Get resolved TA permissions for a user (checks override first, then default)
 */
export const getTAPermissions = async (
  userId: string,
  courseId: string
): Promise<TAPermissions> => {
  // Check for individual override first
  const override = await getTAPermissionsOverride(userId, courseId);
  if (override) {
    console.log(`[getTAPermissions] Using override for userId=${userId}, courseId=${courseId}`, override);
    return override;
  }

  // Fall back to default
  const defaultPerms = await getTAPermissionsDefault(courseId);
  console.log(`[getTAPermissions] Using default for userId=${userId}, courseId=${courseId}`, defaultPerms);
  return defaultPerms;
};

/**
 * Validate TA permissions object structure
 */
export const validateTAPermissions = (permissions: any): boolean => {
  if (!permissions || typeof permissions !== "object") {
    return false;
  }

  const requiredKeys = [
    "canCreate",
    "canEdit",
    "canDelete",
    "canViewStudents",
    "canViewGrades",
  ];

  for (const key of requiredKeys) {
    if (!(key in permissions)) {
      return false;
    }
    if (typeof permissions[key] !== "boolean") {
      return false;
    }
  }

  return true;
};

/**
 * Check if a TA has a specific permission
 */
export const hasTAPermission = async (
  userId: string,
  courseId: string,
  permission: keyof TAPermissions
): Promise<boolean> => {
  const userRole = await getUserCourseRole(userId, courseId);
  
  // Only TAs have granular permissions
  if (userRole !== UserRole.TEACHING_ASSISTANT) {
    return false;
  }

  const taPerms = await getTAPermissions(userId, courseId);
  const hasPermission = taPerms[permission] === true;
  
  // Debug logging
  console.log(`[hasTAPermission] userId=${userId}, courseId=${courseId}, permission=${permission}, hasPermission=${hasPermission}`, {
    taPerms,
    userRole,
  });
  
  return hasPermission;
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
      canManage: true,
    };
  }

  const userRole = await getUserCourseRole(userId, courseId);

  if (!userRole) {
    // Not enrolled in course
    return {
      canRead: false,
      canWrite: false,
      canGrade: false,
      canManage: false,
    };
  }

  switch (userRole) {
    case UserRole.INSTRUCTOR:
      return {
        canRead: true,
        canWrite: true,
        canGrade: true,
        canManage: true,
      };

    case UserRole.TEACHING_ASSISTANT: {
      // Get TA-specific permissions from course settings
      const taPerms = await getTAPermissions(userId, courseId);

      return {
        canRead: true, // TAs can always read
        canWrite: taPerms.canEdit || taPerms.canCreate, // Can write if can edit or create
        canGrade: taPerms.canViewGrades, // Can grade if can view grades
        canManage: taPerms.canDelete, // Can manage if can delete
      };
    }

    case UserRole.STUDENT:
      return {
        canRead: true,
        canWrite: false,
        canGrade: false,
        canManage: false,
      };

    case UserRole.AUDIT:
      return {
        canRead: true,
        canWrite: false,
        canGrade: false,
        canManage: false,
      };

    default:
      return {
        canRead: false,
        canWrite: false,
        canGrade: false,
        canManage: false,
      };
  }
};

/**
 * Middleware to require specific roles
 */
export const requireRoles = (requiredRoles: UserRole[]) => {
  return asyncHandler(
    (req: Request, res: Response, next: NextFunction): void => {
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
        throw new AuthorizationError(
          `Required roles: ${requiredRoles.join(", ")}`
        );
      }

      next();
    }
  );
};

/**
 * Middleware to require admin privileges
 */
export const requireAdmin = asyncHandler(
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      throw new AuthenticationError();
    }

    if (!req.user.isAdmin) {
      throw new AuthorizationError("Admin privileges required");
    }

    next();
  }
);

/**
 * Middleware to require course enrollment
 */
export const requireCourseEnrollment = (courseIdParam: string = "courseId") => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication required",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const courseId =
      req.params[courseIdParam] ||
      req.body.courseId ||
      req.body.course_id ||
      req.query.courseId;

    if (!courseId) {
      res.status(400).json({
        error: {
          code: "MISSING_COURSE_ID",
          message: "Course ID is required",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
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
          code: "NOT_ENROLLED",
          message: "User is not enrolled in this course",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
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
  courseIdParam: string = "courseId"
) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication required",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const courseId =
      req.params[courseIdParam] ||
      req.body.courseId ||
      req.body.course_id ||
      req.query.courseId;

    if (!courseId) {
      res.status(400).json({
        error: {
          code: "MISSING_COURSE_ID",
          message: "Course ID is required",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const { id: userId, isAdmin } = req.user;
    const permissions = await getCoursePermissions(userId, courseId, isAdmin);

    if (!permissions[permission]) {
      res.status(403).json({
        error: {
          code: "INSUFFICIENT_COURSE_PERMISSIONS",
          message: `Required permission: ${permission}`,
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    next();
  };
};

/**
 * Middleware to check if user can access their own resources or has elevated permissions
 */
export const requireOwnershipOrElevated = (userIdParam: string = "userId") => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: {
          code: "AUTHENTICATION_REQUIRED",
          message: "Authentication required",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const targetUserId =
      req.params[userIdParam] || req.body.userId || req.query.userId;
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
        code: "ACCESS_DENIED",
        message: "Can only access own resources or need elevated permissions",
        timestamp: new Date().toISOString(),
        path: req.path,
      },
    });
  };
};
