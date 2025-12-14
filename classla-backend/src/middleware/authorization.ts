import { Request, Response, NextFunction } from "express";
import { supabase } from "./auth";
import { UserRole, OrganizationRole } from "../types/enums";
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
 * Interface for organization permissions
 */
export interface OrganizationPermissions {
  canRead: boolean;
  canCreateTemplates: boolean;
  canCloneTemplates: boolean;
  canDeleteOwnTemplates: boolean;
  canDeleteAnyTemplates: boolean;
  canManageMembers: boolean;
  canUpdateOrganization: boolean;
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

/**
 * Get user's role in a specific organization
 */
export const getUserOrganizationRole = async (
  userId: string,
  organizationId: string
): Promise<OrganizationRole | null> => {
  try {
    const { data, error } = await supabase
      .from("organization_memberships")
      .select("role")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .single();

    if (error || !data) {
      return null;
    }

    return data.role as OrganizationRole;
  } catch (error) {
    console.error("Error getting user organization role:", error);
    return null;
  }
};

/**
 * Check if user is an admin of an organization
 */
export const isOrganizationAdmin = async (
  userId: string,
  organizationId: string
): Promise<boolean> => {
  const role = await getUserOrganizationRole(userId, organizationId);
  return role === OrganizationRole.ADMIN;
};

/**
 * Check if user is a member (or admin) of an organization
 */
/**
 * Get the course or template ID from an assignment
 * Returns { id, isTemplate }
 */
export const getAssignmentContext = (assignment: any): { id: string; isTemplate: boolean } => {
  if (assignment.template_id) {
    return { id: assignment.template_id, isTemplate: true };
  }
  return { id: assignment.course_id, isTemplate: false };
};

/**
 * Get the course or template ID from a folder
 * Returns { id, isTemplate }
 */
export const getFolderContext = (folder: any): { id: string; isTemplate: boolean } => {
  if (folder.template_id) {
    return { id: folder.template_id, isTemplate: true };
  }
  return { id: folder.course_id, isTemplate: false };
};

/**
 * Check if user can access a course or template
 * Returns permissions object and whether it's a template
 */
export const checkCourseOrTemplateAccess = async (
  courseId: string,
  userId: string,
  isAdmin: boolean
): Promise<{ canRead: boolean; isTemplate: boolean; organizationId?: string; permissions?: any }> => {
  // Check if this is a template
  const { data: template, error: templateError } = await supabase
    .from("course_templates")
    .select("organization_id")
    .eq("id", courseId)
    .is("deleted_at", null)
    .single();

  const isTemplate = !templateError && template !== null;

  if (isTemplate) {
    // For templates, check organization membership
    const isMember = await isOrganizationMember(userId, template.organization_id);
    return {
      canRead: isMember,
      isTemplate: true,
      organizationId: template.organization_id,
      permissions: isMember ? { canRead: true, canWrite: true, canGrade: false, canManage: true } : undefined,
    };
  } else {
    // For regular courses, check course permissions
    const permissions = await getCoursePermissions(userId, courseId, isAdmin);
    return {
      canRead: permissions.canRead,
      isTemplate: false,
      permissions,
    };
  }
};

export const isOrganizationMember = async (
  userId: string,
  organizationId: string
): Promise<boolean> => {
  const role = await getUserOrganizationRole(userId, organizationId);
  return role !== null;
};

/**
 * Get organization permissions for a user
 */
export const getOrganizationPermissions = async (
  userId: string,
  organizationId: string
): Promise<OrganizationPermissions> => {
  const role = await getUserOrganizationRole(userId, organizationId);

  if (!role) {
    // Not a member
    return {
      canRead: false,
      canCreateTemplates: false,
      canCloneTemplates: false,
      canDeleteOwnTemplates: false,
      canDeleteAnyTemplates: false,
      canManageMembers: false,
      canUpdateOrganization: false,
    };
  }

  if (role === OrganizationRole.ADMIN) {
    // Admins have full access
    return {
      canRead: true,
      canCreateTemplates: true,
      canCloneTemplates: true,
      canDeleteOwnTemplates: true,
      canDeleteAnyTemplates: true,
      canManageMembers: true,
      canUpdateOrganization: true,
    };
  }

  // Members can create, clone, and delete own templates
  return {
    canRead: true,
    canCreateTemplates: true,
    canCloneTemplates: true,
    canDeleteOwnTemplates: true,
    canDeleteAnyTemplates: false,
    canManageMembers: false,
    canUpdateOrganization: false,
  };
};

/**
 * Check if user can delete a specific template
 * Members can delete their own templates, admins can delete any
 */
export const canDeleteTemplate = async (
  userId: string,
  templateId: string
): Promise<boolean> => {
  try {
    // Get the template
    const { data: template, error: templateError } = await supabase
      .from("course_templates")
      .select("organization_id, created_by_id")
      .eq("id", templateId)
      .is("deleted_at", null)
      .single();

    if (templateError || !template) {
      return false;
    }

    // Check if user is admin of the organization
    const isAdmin = await isOrganizationAdmin(userId, template.organization_id);
    if (isAdmin) {
      return true;
    }

    // Check if user is the creator (and is a member)
    const isMember = await isOrganizationMember(userId, template.organization_id);
    if (isMember && template.created_by_id === userId) {
      return true;
    }

    return false;
  } catch (error) {
    console.error("Error checking template delete permission:", error);
    return false;
  }
};

/**
 * Middleware to require organization membership
 */
export const requireOrganizationMembership = (
  organizationIdParam: string = "organizationId"
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

    const organizationId =
      req.params[organizationIdParam] ||
      req.body.organizationId ||
      req.body.organization_id ||
      req.query.organizationId;

    if (!organizationId) {
      res.status(400).json({
        error: {
          code: "MISSING_ORGANIZATION_ID",
          message: "Organization ID is required",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const { id: userId } = req.user;
    const isMember = await isOrganizationMember(userId, organizationId);

    if (!isMember) {
      res.status(403).json({
        error: {
          code: "NOT_ORGANIZATION_MEMBER",
          message: "User is not a member of this organization",
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
 * Middleware to require organization admin role
 */
export const requireOrganizationAdmin = (
  organizationIdParam: string = "organizationId"
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

    const organizationId =
      req.params[organizationIdParam] ||
      req.body.organizationId ||
      req.body.organization_id ||
      req.query.organizationId;

    if (!organizationId) {
      res.status(400).json({
        error: {
          code: "MISSING_ORGANIZATION_ID",
          message: "Organization ID is required",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const { id: userId } = req.user;
    const isAdmin = await isOrganizationAdmin(userId, organizationId);

    if (!isAdmin) {
      res.status(403).json({
        error: {
          code: "INSUFFICIENT_ORGANIZATION_PERMISSIONS",
          message: "Organization admin privileges required",
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
 * Middleware to require specific organization permission
 */
export const requireOrganizationPermission = (
  permission: keyof OrganizationPermissions,
  organizationIdParam: string = "organizationId"
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

    const organizationId =
      req.params[organizationIdParam] ||
      req.body.organizationId ||
      req.body.organization_id ||
      req.query.organizationId;

    if (!organizationId) {
      res.status(400).json({
        error: {
          code: "MISSING_ORGANIZATION_ID",
          message: "Organization ID is required",
          timestamp: new Date().toISOString(),
          path: req.path,
        },
      });
      return;
    }

    const { id: userId } = req.user;
    const permissions = await getOrganizationPermissions(userId, organizationId);

    if (!permissions[permission]) {
      res.status(403).json({
        error: {
          code: "INSUFFICIENT_ORGANIZATION_PERMISSIONS",
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
