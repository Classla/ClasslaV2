import { Request, Response, NextFunction } from 'express';
// Import the actual functions after mocking
const { authenticateToken, optionalAuth } = require('../auth');
import { AuthenticationError } from '../errorHandler';
import { sessionManagementService } from '../../services/session';
import { describe, it, beforeEach, jest, expect } from '@jest/globals';

// Mock session management service
jest.mock('../../services/session', () => ({
  sessionManagementService: {
    validateSession: jest.fn(),
  },
}));

// Mock Supabase
const mockSupabaseClient = {
  from: jest.fn(() => ({
    select: jest.fn(() => ({
      eq: jest.fn(() => ({
        single: jest.fn()
      }))
    }))
  }))
};

jest.mock('../auth', () => ({
  authenticateToken: jest.fn(),
  optionalAuth: jest.fn(),
  supabase: mockSupabaseClient
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
  },
}));

const mockSessionService = sessionManagementService as jest.Mocked<typeof sessionManagementService>;
const mockSupabase = mockSupabaseClient;

describe('Authentication Middleware', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      path: '/test',
      sessionID: 'test-session-id'
    };
    mockResponse = {};
    mockNext = jest.fn();
    jest.clearAllMocks();
  });

  describe('authenticateToken', () => {
    const mockUserData = {
      id: 'supabase-user-123',
      email: 'test@example.com',
      roles: ['student'],
      is_admin: false,
      workos_user_id: 'workos-user-123',
      first_name: 'John',
      last_name: 'Doe',
      name: 'John Doe',
      settings: {}
    };

    const mockSessionData = {
      userId: 'workos-user-123',
      workosUserId: 'workos-user-123',
      email: 'test@example.com',
      isAuthenticated: true,
      loginTime: new Date(),
      lastActivity: new Date()
    };

    it('should authenticate user with valid session and user data', async () => {
      mockSessionService.validateSession.mockResolvedValue(mockSessionData);
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockUserData,
              error: null
            })
          })
        })
      });

      await authenticateToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockSessionService.validateSession).toHaveBeenCalledWith(mockRequest);
      expect(mockSupabase.from).toHaveBeenCalledWith('users');
      expect(mockRequest.user).toEqual({
        id: 'supabase-user-123',
        workosUserId: 'workos-user-123',
        email: 'test@example.com',
        roles: ['student'],
        isAdmin: false
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should throw AuthenticationError when session is invalid', async () => {
      mockSessionService.validateSession.mockResolvedValue(null);

      await expect(
        authenticateToken(mockRequest as Request, mockResponse as Response, mockNext)
      ).rejects.toThrow(AuthenticationError);
      
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should throw AuthenticationError when user not found in database', async () => {
      mockSessionService.validateSession.mockResolvedValue(mockSessionData);
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'User not found' }
            })
          })
        })
      });

      await expect(
        authenticateToken(mockRequest as Request, mockResponse as Response, mockNext)
      ).rejects.toThrow(AuthenticationError);
      
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      mockSessionService.validateSession.mockResolvedValue(mockSessionData);
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database connection failed' }
            })
          })
        })
      });

      await expect(
        authenticateToken(mockRequest as Request, mockResponse as Response, mockNext)
      ).rejects.toThrow(AuthenticationError);
    });

    it('should handle session validation errors', async () => {
      mockSessionService.validateSession.mockRejectedValue(new Error('Session validation failed'));

      await expect(
        authenticateToken(mockRequest as Request, mockResponse as Response, mockNext)
      ).rejects.toThrow('Session validation failed');
    });

    it('should set user context with default values for missing fields', async () => {
      const incompleteUserData = {
        id: 'supabase-user-123',
        email: 'test@example.com',
        workos_user_id: 'workos-user-123',
        // Missing roles and is_admin
      };

      mockSessionService.validateSession.mockResolvedValue(mockSessionData);
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: incompleteUserData,
              error: null
            })
          })
        })
      });

      await authenticateToken(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toEqual({
        id: 'supabase-user-123',
        workosUserId: 'workos-user-123',
        email: 'test@example.com',
        roles: [],
        isAdmin: false
      });
    });
  });

  describe('optionalAuth', () => {
    const mockUserData = {
      id: 'supabase-user-123',
      email: 'test@example.com',
      roles: ['student'],
      is_admin: false,
      workos_user_id: 'workos-user-123',
      first_name: 'John',
      last_name: 'Doe',
      name: 'John Doe',
      settings: {}
    };

    const mockSessionData = {
      userId: 'workos-user-123',
      workosUserId: 'workos-user-123',
      email: 'test@example.com',
      isAuthenticated: true,
      loginTime: new Date(),
      lastActivity: new Date()
    };

    it('should set user context when valid session exists', async () => {
      mockSessionService.validateSession.mockResolvedValue(mockSessionData);
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockUserData,
              error: null
            })
          })
        })
      });

      await optionalAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toEqual({
        id: 'supabase-user-123',
        workosUserId: 'workos-user-123',
        email: 'test@example.com',
        roles: ['student'],
        isAdmin: false
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without user context when no session exists', async () => {
      mockSessionService.validateSession.mockResolvedValue(null);

      await optionalAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without user context when user not found in database', async () => {
      mockSessionService.validateSession.mockResolvedValue(mockSessionData);
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: 'User not found' }
            })
          })
        })
      });

      await optionalAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without user context when session validation fails', async () => {
      mockSessionService.validateSession.mockRejectedValue(new Error('Session error'));

      await optionalAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });

    it('should continue without user context when database query fails', async () => {
      mockSessionService.validateSession.mockResolvedValue(mockSessionData);
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Database error');
      });

      await optionalAuth(mockRequest as Request, mockResponse as Response, mockNext);

      expect(mockRequest.user).toBeUndefined();
      expect(mockNext).toHaveBeenCalled();
    });
  });
});