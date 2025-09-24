import { Request, Response } from 'express';
import { SessionManagementService, SessionManagementError, type UserSessionData } from '../session';
import { WorkOSUser } from '../workos';
import { describe, it, beforeEach } from '@jest/globals';

// Mock Express session
const mockSession = {
  user: undefined as UserSessionData | undefined,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: false,
    httpOnly: true,
    sameSite: 'lax' as const,
  },
  save: jest.fn(),
  destroy: jest.fn(),
};

const mockRequest = {
  session: mockSession,
} as unknown as Request;

const mockResponse = {
  clearCookie: jest.fn(),
} as unknown as Response;

const mockWorkOSUser: WorkOSUser = {
  id: 'workos_user_123',
  email: 'test@example.com',
  firstName: 'John',
  lastName: 'Doe',
  profilePictureUrl: 'https://example.com/avatar.jpg',
};

describe('SessionManagementService', () => {
  let sessionService: SessionManagementService;

  beforeEach(() => {
    sessionService = new SessionManagementService();
    jest.clearAllMocks();
    
    // Reset mock session
    mockSession.user = undefined;
    mockSession.save.mockImplementation((callback) => callback());
    mockSession.destroy.mockImplementation((callback) => callback());
  });

  describe('createSession', () => {
    it('should create session successfully', async () => {
      await sessionService.createSession(mockRequest, mockWorkOSUser);

      expect(mockSession.user).toBeDefined();
      expect(mockSession.user?.userId).toBe('workos_user_123');
      expect(mockSession.user?.email).toBe('test@example.com');
      expect(mockSession.user?.isAuthenticated).toBe(true);
      expect(mockSession.save).toHaveBeenCalled();
    });

    it('should create session with custom config', async () => {
      const customConfig = {
        maxAge: 60 * 60 * 1000, // 1 hour
        secure: true,
      };

      await sessionService.createSession(mockRequest, mockWorkOSUser, customConfig);

      expect(mockSession.cookie.maxAge).toBe(60 * 60 * 1000);
      expect(mockSession.cookie.secure).toBe(true);
      expect(mockSession.user?.isAuthenticated).toBe(true);
    });

    it('should throw error when session save fails', async () => {
      mockSession.save.mockImplementation((callback) => 
        callback(new Error('Save failed'))
      );

      await expect(
        sessionService.createSession(mockRequest, mockWorkOSUser)
      ).rejects.toThrow(SessionManagementError);
    });
  });

  describe('validateSession', () => {
    beforeEach(() => {
      // Set up a valid session
      mockSession.user = {
        userId: 'workos_user_123',
        workosUserId: 'workos_user_123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        isAuthenticated: true,
        loginTime: new Date(),
        lastActivity: new Date(),
      };
    });

    it('should validate and refresh valid session', async () => {
      const result = await sessionService.validateSession(mockRequest);

      expect(result).toBeDefined();
      expect(result?.userId).toBe('workos_user_123');
      expect(result?.isAuthenticated).toBe(true);
      expect(mockSession.save).toHaveBeenCalled();
    });

    it('should return null for missing session', async () => {
      mockSession.user = undefined;

      const result = await sessionService.validateSession(mockRequest);

      expect(result).toBeNull();
    });

    it('should return null for unauthenticated session', async () => {
      mockSession.user!.isAuthenticated = false;

      const result = await sessionService.validateSession(mockRequest);

      expect(result).toBeNull();
    });

    it('should destroy expired session', async () => {
      // Set login time to 25 hours ago (expired)
      const expiredTime = new Date();
      expiredTime.setHours(expiredTime.getHours() - 25);
      mockSession.user!.loginTime = expiredTime;

      const result = await sessionService.validateSession(mockRequest);

      expect(result).toBeNull();
      expect(mockSession.destroy).toHaveBeenCalled();
    });

    it('should throw error when session update fails', async () => {
      mockSession.save.mockImplementation((callback) => 
        callback(new Error('Update failed'))
      );

      await expect(
        sessionService.validateSession(mockRequest)
      ).rejects.toThrow(SessionManagementError);
    });
  });

  describe('destroySession', () => {
    it('should destroy session successfully', async () => {
      await sessionService.destroySession(mockRequest);

      expect(mockSession.destroy).toHaveBeenCalled();
    });

    it('should throw error when destroy fails', async () => {
      mockSession.destroy.mockImplementation((callback) => 
        callback(new Error('Destroy failed'))
      );

      await expect(
        sessionService.destroySession(mockRequest)
      ).rejects.toThrow(SessionManagementError);
    });
  });

  describe('clearSessionCookie', () => {
    it('should clear session cookie', () => {
      sessionService.clearSessionCookie(mockResponse);

      expect(mockResponse.clearCookie).toHaveBeenCalledWith('classla.sid', {
        path: '/',
        httpOnly: true,
        secure: false, // NODE_ENV is not production in tests
        sameSite: 'lax',
      });
    });
  });

  describe('isAuthenticated', () => {
    it('should return true for authenticated session', () => {
      mockSession.user = {
        userId: 'workos_user_123',
        workosUserId: 'workos_user_123',
        email: 'test@example.com',
        isAuthenticated: true,
        loginTime: new Date(),
        lastActivity: new Date(),
      };

      const result = sessionService.isAuthenticated(mockRequest);

      expect(result).toBe(true);
    });

    it('should return false for missing session', () => {
      mockSession.user = undefined;

      const result = sessionService.isAuthenticated(mockRequest);

      expect(result).toBe(false);
    });

    it('should return false for unauthenticated session', () => {
      mockSession.user = {
        userId: 'workos_user_123',
        workosUserId: 'workos_user_123',
        email: 'test@example.com',
        isAuthenticated: false,
        loginTime: new Date(),
        lastActivity: new Date(),
      };

      const result = sessionService.isAuthenticated(mockRequest);

      expect(result).toBe(false);
    });
  });

  describe('getCurrentUser', () => {
    it('should return current user for authenticated session', () => {
      const userData = {
        userId: 'workos_user_123',
        workosUserId: 'workos_user_123',
        email: 'test@example.com',
        firstName: 'John',
        isAuthenticated: true,
        loginTime: new Date(),
        lastActivity: new Date(),
      };
      mockSession.user = userData;

      const result = sessionService.getCurrentUser(mockRequest);

      expect(result).toEqual(userData);
    });

    it('should return null for unauthenticated session', () => {
      mockSession.user = undefined;

      const result = sessionService.getCurrentUser(mockRequest);

      expect(result).toBeNull();
    });
  });

  describe('updateUserInSession', () => {
    beforeEach(() => {
      mockSession.user = {
        userId: 'workos_user_123',
        workosUserId: 'workos_user_123',
        email: 'test@example.com',
        firstName: 'John',
        isAuthenticated: true,
        loginTime: new Date(),
        lastActivity: new Date(),
      };
    });

    it('should update user data in session', async () => {
      const updateData = {
        firstName: 'Jane',
        lastName: 'Smith',
      };

      await sessionService.updateUserInSession(mockRequest, updateData);

      expect(mockSession.user?.firstName).toBe('Jane');
      expect(mockSession.user?.lastName).toBe('Smith');
      expect(mockSession.save).toHaveBeenCalled();
    });

    it('should throw error for unauthenticated session', async () => {
      mockSession.user = undefined;

      await expect(
        sessionService.updateUserInSession(mockRequest, { firstName: 'Jane' })
      ).rejects.toThrow(SessionManagementError);
    });

    it('should throw error when session save fails', async () => {
      mockSession.save.mockImplementation((callback) => 
        callback(new Error('Save failed'))
      );

      await expect(
        sessionService.updateUserInSession(mockRequest, { firstName: 'Jane' })
      ).rejects.toThrow(SessionManagementError);
    });
  });

  describe('getSessionStats', () => {
    it('should return stats for authenticated session', () => {
      const loginTime = new Date();
      mockSession.user = {
        userId: 'workos_user_123',
        workosUserId: 'workos_user_123',
        email: 'test@example.com',
        isAuthenticated: true,
        loginTime,
        lastActivity: new Date(),
      };

      const stats = sessionService.getSessionStats(mockRequest);

      expect(stats.isAuthenticated).toBe(true);
      expect(stats.userId).toBe('workos_user_123');
      expect(stats.sessionAge).toBeGreaterThanOrEqual(0);
      expect(stats.lastActivity).toBeDefined();
    });

    it('should return minimal stats for unauthenticated session', () => {
      mockSession.user = undefined;

      const stats = sessionService.getSessionStats(mockRequest);

      expect(stats.isAuthenticated).toBe(false);
      expect(stats.userId).toBeUndefined();
      expect(stats.sessionAge).toBeUndefined();
    });
  });
});

describe('SessionManagementError', () => {
  it('should create error with message, code, and status code', () => {
    const error = new SessionManagementError(
      'Test error',
      'TEST_ERROR',
      400
    );

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('SessionManagementError');
  });

  it('should create error with just message', () => {
    const error = new SessionManagementError('Test error');

    expect(error.message).toBe('Test error');
    expect(error.code).toBeUndefined();
    expect(error.statusCode).toBeUndefined();
  });
});