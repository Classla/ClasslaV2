// API route prefixes
export const API_ROUTES = {
  COURSES: '/api/courses',
  SECTIONS: '/api/sections',
  USERS: '/api/users',
  ASSIGNMENTS: '/api/assignments',
  SUBMISSIONS: '/api/submissions',
  GRADERS: '/api/graders',
  RUBRICS: '/api/rubrics',
  ORGANIZATIONS: '/api/organizations',
  COURSE_TEMPLATES: '/api/course-templates'
} as const;

// Default pagination settings
export const PAGINATION = {
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100
} as const;

// Error codes
export const ERROR_CODES = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE'
} as const;

// HTTP status codes
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500
} as const;