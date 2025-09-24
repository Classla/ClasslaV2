import express from 'express';
import session from 'express-session';
import request from 'supertest';

/**
 * Test helper for setting up session-based authentication in route tests
 */

export interface MockUser {
  id: string;
  workosUserId: string;
  email: string;
  roles: string[];
  isAdmin: boolean;
  firstName?: string;
  lastName?: string;
}

export const defaultMockUser: MockUser = {
  id: 'test-user-123',
  workosUserId: 'workos_test_123',
  email: 'test@example.com',
  roles: ['student'],
  isAdmin: false,
  firstName: 'Test',
  lastName: 'User'
};

export const mockInstructorUser: MockUser = {
  id: 'instructor-123',
  workosUserId: 'workos_instructor_123',
  email: 'instructor@example.com',
  roles: ['instructor'],
  isAdmin: false,
  firstName: 'Test',
  lastName: 'Instructor'
};

export const mockAdminUser: MockUser = {
  id: 'admin-123',
  workosUserId: 'workos_admin_123',
  email: 'admin@example.com',
  roles: ['admin'],
  isAdmin: true,
  firstName: 'Test',
  lastName: 'Admin'
};

/**
 * Creates a mock authenticateToken middleware that sets req.user
 */
export const createMockAuthMiddleware = (user: MockUser | null = defaultMockUser) => {
  return jest.fn((req: any, res: any, next: any) => {
    if (user) {
      req.user = user;
    }
    next();
  });
};

/**
 * Creates an Express app with session middleware for testing
 */
export const createTestApp = (router: express.Router): express.Application => {
  const app = express();
  app.use(express.json());
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
  }));
  app.use(router);
  return app;
};

/**
 * Creates a supertest agent with session support
 */
export const createTestAgent = (app: express.Application) => {
  return request.agent(app);
};

/**
 * Mock session service for testing
 */
export const mockSessionService = {
  createSession: jest.fn(),
  destroySession: jest.fn(),
  getCurrentUser: jest.fn(),
  validateSession: jest.fn(),
  clearSessionCookie: jest.fn(),
  getSessionStats: jest.fn(() => ({
    isAuthenticated: true,
    sessionAge: 3600000,
    lastActivity: new Date()
  }))
};

/**
 * Creates a complete mock Supabase query builder
 */
const createMockQueryBuilder = () => ({
  select: jest.fn().mockReturnThis(),
  insert: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  delete: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  neq: jest.fn().mockReturnThis(),
  in: jest.fn().mockReturnThis(),
  is: jest.fn().mockReturnThis(),
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  single: jest.fn().mockResolvedValue({ data: null, error: null })
});

/**
 * Mock Supabase client for testing
 */
export const mockSupabase = {
  from: jest.fn(() => createMockQueryBuilder())
};

/**
 * Sets up common mocks for route testing
 */
export const setupRouteMocks = () => {
  // Mock the auth middleware
  jest.mock('../../middleware/auth', () => ({
    supabase: mockSupabase,
    authenticateToken: createMockAuthMiddleware()
  }));

  // Mock authorization middleware
  jest.mock('../../middleware/authorization', () => ({
    requireRoles: jest.fn(() => (req: any, res: any, next: any) => next()),
    requireOwnershipOrElevated: jest.fn(() => (req: any, res: any, next: any) => next()),
    requireCoursePermission: jest.fn(() => (req: any, res: any, next: any) => next()),
    getCoursePermissions: jest.fn(),
    getUserCourseRole: jest.fn()
  }));

  // Mock session service
  jest.mock('../../services/session', () => ({
    sessionManagementService: mockSessionService,
    SessionManagementError: class SessionManagementError extends Error {
      statusCode: number;
      code: string;
      constructor(message: string, code: string, statusCode: number) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
      }
    }
  }));

  // Mock logger
  jest.mock('../../utils/logger', () => ({
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn()
    }
  }));
};

/**
 * Clears all mocks between tests
 */
export const clearAllMocks = () => {
  jest.clearAllMocks();
};