import { Course, TAPermissions, UserRole } from "../types";

/**
 * Get default TA permissions from course settings
 */
export const getDefaultTAPermissions = (course: Course | null): TAPermissions => {
  if (!course?.settings?.ta_permissions_default) {
    return {
      canCreate: false,
      canEdit: false,
      canDelete: false,
      canViewStudents: false,
      canViewGrades: false,
    };
  }
  return course.settings.ta_permissions_default;
};

/**
 * Get individual TA permissions override for a specific user
 */
export const getTAPermissionsOverride = (
  course: Course | null,
  userId: string
): TAPermissions | null => {
  if (!course?.settings?.ta_permissions) {
    return null;
  }
  return course.settings.ta_permissions[userId] || null;
};

/**
 * Get resolved TA permissions for a user (checks override first, then default)
 */
export const getTAPermissions = (
  course: Course | null,
  userId: string | undefined,
  userRole: UserRole | null
): TAPermissions | null => {
  // Only TAs have granular permissions
  if (userRole !== UserRole.TEACHING_ASSISTANT || !userId || !course) {
    return null;
  }

  // Check for individual override first
  const override = getTAPermissionsOverride(course, userId);
  if (override) {
    return override;
  }

  // Fall back to default
  return getDefaultTAPermissions(course);
};

/**
 * Check if a TA has a specific permission
 */
export const hasTAPermission = (
  course: Course | null,
  userId: string | undefined,
  userRole: UserRole | null,
  permission: keyof TAPermissions
): boolean => {
  const perms = getTAPermissions(course, userId, userRole);
  if (!perms) {
    return false;
  }
  return perms[permission] === true;
};

