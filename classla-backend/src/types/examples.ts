/**
 * Example usage of the shared data models and types
 * This file demonstrates how to use the types in actual implementation
 */

import {
  UserRole,
  SubmissionStatus,
  Course,
  User,
  Assignment,
  CreateCourseRequest,
  ApiResponse,
  AuthContext,
  isUserRole,
  validateRequiredFields,
  ERROR_CODES,
  HTTP_STATUS
} from './index';

// Example: Creating a new course
export function createCourseExample(): CreateCourseRequest {
  return {
    name: 'Introduction to Computer Science',
    slug: 'intro-cs-101',
    settings: {
      public: true,
      enrollment_limit: 100
    },
    thumbnail_url: 'https://example.com/course-thumbnail.jpg',
    summary_content: 'Learn the fundamentals of computer science'
  };
}

// Example: User authentication context
export function createAuthContextExample(): AuthContext {
  return {
    userId: '550e8400-e29b-41d4-a716-446655440000',
    userRoles: [UserRole.INSTRUCTOR, UserRole.ADMIN],
    isAdmin: true
  };
}

// Example: API response wrapper
export function createSuccessResponse<T>(data: T, message?: string): ApiResponse<T> {
  return {
    data,
    success: true,
    message
  };
}

// Example: Validation function using type guards
export function validateUserRole(role: string): { isValid: boolean; error?: string } {
  if (!isUserRole(role)) {
    return {
      isValid: false,
      error: `Invalid user role: ${role}. Must be one of: ${Object.values(UserRole).join(', ')}`
    };
  }
  
  return { isValid: true };
}

// Example: Course creation with validation
export function validateCourseCreation(request: CreateCourseRequest): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  // Validate required fields
  const { isValid, missingFields } = validateRequiredFields(request, ['name', 'slug']);
  if (!isValid) {
    errors.push(`Missing required fields: ${missingFields.join(', ')}`);
  }
  
  // Validate slug format
  if (request.slug && !/^[a-z0-9-]+$/.test(request.slug)) {
    errors.push('Slug must contain only lowercase letters, numbers, and hyphens');
  }
  
  // Validate name length
  if (request.name && request.name.length < 3) {
    errors.push('Course name must be at least 3 characters long');
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
}

// Example: Error response creation
export function createErrorResponse(code: string, message: string, path: string) {
  return {
    error: {
      code,
      message,
      details: null
    },
    timestamp: new Date().toISOString(),
    path
  };
}

// Example: Permission checking
export function checkCoursePermissions(
  authContext: AuthContext,
  courseCreatorId: string
): {
  canRead: boolean;
  canWrite: boolean;
  canGrade: boolean;
  canManage: boolean;
} {
  const isOwner = authContext.userId === courseCreatorId;
  const isInstructor = authContext.userRoles.includes(UserRole.INSTRUCTOR);
  const isAdmin = authContext.isAdmin;
  
  return {
    canRead: true, // All authenticated users can read
    canWrite: isOwner || isInstructor || isAdmin,
    canGrade: isOwner || isInstructor || isAdmin,
    canManage: isOwner || isAdmin
  };
}