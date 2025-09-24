// Authentication middleware
export {
  supabase,
  authenticateToken,
  optionalAuth
} from './auth';

// Authorization middleware
export {
  hasRole,
  hasAnyRole,
  getUserCourseRole,
  isEnrolledInCourse,
  getCoursePermissions,
  requireRoles,
  requireAdmin,
  requireCourseEnrollment,
  requireCoursePermission,
  requireOwnershipOrElevated,
  type CoursePermissions
} from './authorization';