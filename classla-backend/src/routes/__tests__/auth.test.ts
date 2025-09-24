// Set up environment variables before any imports
const originalEnv = process.env;
process.env = {
  ...originalEnv,
  WORKOS_API_KEY: 'test_api_key',
  WORKOS_CLIENT_ID: 'test_client_id',
  WORKOS_REDIRECT_URI: 'http://localhost:3001/auth/callback',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test_service_key',
  FRONTEND_URL: 'http://localhost:5173'
};

// Mock services before importing anything
jest.mock('../../services/workos');
jest.mock('../../services/session');
jest.mock('../../services/userSync');
jest.mock('../../middleware/auth', () => ({
  authenticateToken: jest.fn((req: any, res: any, next: any) => next())
}));
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import authRouter from '../auth';
import { workosAuthService } from '../../services/workos';
import { sessionManagementService } from '../../services/session';
import { userSynchronizationService } from '../../services/userSync';
import { authenticateToken } from '../../middleware/auth';

const mockWorkosService = workosAuthService as jest.Mocked<typeof workosAuthService>;
const mockSessionService = sessionManagementService as jest.Mocked<typeof sessionManagementService>;
const mockUserSyncService = userSynchronizationService as jest.Mocked<typeof userSynchronizationService>;
const mockAuthenticateToken = authenticateToken as jest.MockedFunction<typeof authenticateToken>;

describe('Auth Routes', () => {
  let app: express.Application;

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(session({
      secret: 'test-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false }
    }));
    app.use(authRouter);
    jest.clearAllMocks();
  });

  describe('POST /auth/login', () => {
    it('should initiate login successfully', async () => {
      const mockAuthUrl = 'https://api.workos.com/sso/authorize?client_id=test';
      mockWorkosService.generateAuthorizationUrl.mockReturnValue(mockAuthUrl);

      const response = await request(app)
        .post('/auth/login')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        authorizationUrl: mockAuthUrl,
        message: 'Login initiated successfully'
      });

      expect(mockWorkosService.generateAuthorizationUrl).toHaveBeenCalledWith(
        expect.any(String)
      );
    });

    it('should handle WorkOS authentication errors', async () => {
      // Import the actual WorkOSAuthenticationError class
      const { WorkOSAuthenticationError } = require('../../services/workos');
      
      const mockError = new WorkOSAuthenticationError('WorkOS error', 'WORKOS_ERROR', 400);
      
      mockWorkosService.generateAuthorizationUrl.mockImplementation(() => {
        throw mockError;
      });

      const response = await request(app)
        .post('/auth/login')
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: 'WorkOS error',
        code: 'WORKOS_ERROR'
      });
    });

    it('should handle generic errors', async () => {
      mockWorkosService.generateAuthorizationUrl.mockImplementation(() => {
        throw new Error('Generic error');
      });

      const response = await request(app)
        .post('/auth/login')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to initiate login',
        code: 'LOGIN_INITIATION_ERROR'
      });
    });
  });

  describe('GET /auth/callback', () => {
    const mockWorkOSUser = {
      id: 'workos_user_123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      profilePictureUrl: 'https://example.com/avatar.jpg'
    };

    const mockSupabaseUser = {
      id: 'supabase_user_123',
      workos_user_id: 'workos_user_123',
      email: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe',
      roles: ['student'],
      is_admin: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    it('should handle callback successfully', async () => {
      // Mock the services to return success
      mockWorkosService.generateAuthorizationUrl.mockReturnValue('https://test-auth-url.com');
      mockWorkosService.handleCallback.mockResolvedValue({
        user: mockWorkOSUser,
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_123'
      });

      mockUserSyncService.syncUser.mockResolvedValue(mockSupabaseUser);
      mockSessionService.createSession.mockResolvedValue();

      // Create agent to maintain session
      const agent = request.agent(app);
      
      // First initiate login to set up session state
      const loginResponse = await agent.post('/auth/login');
      expect(loginResponse.status).toBe(200);

      // The callback should work with the state that was set during login
      // We need to extract the state from the login response or mock it
      const response = await agent
        .get('/auth/callback')
        .query({ code: 'auth_code_123', state: 'mocked-state' })
        .expect(302);

      expect(response.headers.location).toContain('/dashboard?auth=success');
    });

    it('should reject callback without authorization code', async () => {
      const response = await request(app)
        .get('/auth/callback')
        .query({ state: 'test-state' })
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: 'Authorization code is required',
        code: 'MISSING_AUTH_CODE'
      });
    });

    it('should reject callback with invalid state', async () => {
      const response = await request(app)
        .get('/auth/callback')
        .query({ code: 'auth_code_123', state: 'invalid-state' })
        .expect(400);

      expect(response.body).toEqual({
        success: false,
        error: 'Invalid state parameter',
        code: 'INVALID_STATE'
      });
    });

    it('should handle WorkOS authentication errors', async () => {
      class MockWorkOSError extends Error {
        statusCode = 400;
        code = 'INVALID_CODE';
        constructor(message: string) {
          super(message);
          this.name = 'WorkOSAuthenticationError';
        }
      }
      
      const mockError = new MockWorkOSError('Invalid authorization code');

      // Set up session state first
      const agent = request.agent(app);
      mockWorkosService.generateAuthorizationUrl.mockReturnValue('https://test-auth-url.com');
      await agent.post('/auth/login');

      mockWorkosService.handleCallback.mockRejectedValue(mockError);

      const response = await agent
        .get('/auth/callback')
        .query({ code: 'invalid_code', state: 'test-state' })
        .expect(302);

      expect(response.headers.location).toContain('/login?error=');
    });

    it('should handle user synchronization errors', async () => {
      // Set up session state first
      const agent = request.agent(app);
      mockWorkosService.generateAuthorizationUrl.mockReturnValue('https://test-auth-url.com');
      await agent.post('/auth/login');

      mockWorkosService.handleCallback.mockResolvedValue({
        user: mockWorkOSUser,
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_123'
      });

      class MockUserSyncError extends Error {
        statusCode = 500;
        code = 'SYNC_ERROR';
        constructor(message: string) {
          super(message);
          this.name = 'UserSynchronizationError';
        }
      }
      
      const syncError = new MockUserSyncError('User sync failed');
      mockUserSyncService.syncUser.mockRejectedValue(syncError);

      const response = await agent
        .get('/auth/callback')
        .query({ code: 'auth_code_123', state: 'test-state' })
        .expect(302);

      expect(response.headers.location).toContain('/login?error=');
    });

    it('should handle session creation errors', async () => {
      // Set up session state first
      const agent = request.agent(app);
      mockWorkosService.generateAuthorizationUrl.mockReturnValue('https://test-auth-url.com');
      await agent.post('/auth/login');

      mockWorkosService.handleCallback.mockResolvedValue({
        user: mockWorkOSUser,
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_123'
      });

      mockUserSyncService.syncUser.mockResolvedValue(mockSupabaseUser);

      class MockSessionError extends Error {
        statusCode = 500;
        code = 'SESSION_ERROR';
        constructor(message: string) {
          super(message);
          this.name = 'SessionManagementError';
        }
      }
      
      const sessionError = new MockSessionError('Session creation failed');
      mockSessionService.createSession.mockRejectedValue(sessionError);

      const response = await agent
        .get('/auth/callback')
        .query({ code: 'auth_code_123', state: 'test-state' })
        .expect(302);

      expect(response.headers.location).toContain('/login?error=');
    });
  });

  describe('POST /auth/logout', () => {
    it('should logout successfully with valid session', async () => {
      const mockUser = {
        userId: 'workos_user_123',
        workosUserId: 'workos_user_123',
        email: 'test@example.com',
        isAuthenticated: true,
        loginTime: new Date(),
        lastActivity: new Date()
      };

      mockSessionService.getCurrentUser.mockReturnValue(mockUser);
      mockSessionService.destroySession.mockResolvedValue();
      mockSessionService.clearSessionCookie.mockImplementation(() => {});

      const response = await request(app)
        .post('/auth/logout')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Logged out successfully'
      });

      expect(mockSessionService.destroySession).toHaveBeenCalled();
      expect(mockSessionService.clearSessionCookie).toHaveBeenCalled();
    });

    it('should logout successfully without active session', async () => {
      mockSessionService.getCurrentUser.mockReturnValue(null);
      mockSessionService.destroySession.mockResolvedValue();
      mockSessionService.clearSessionCookie.mockImplementation(() => {});

      const response = await request(app)
        .post('/auth/logout')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        message: 'Logged out successfully'
      });
    });

    it('should handle session destruction errors', async () => {
      const { SessionManagementError } = require('../../services/session');
      
      const sessionError = new SessionManagementError('Session destruction failed', 'DESTROY_ERROR', 500);

      mockSessionService.getCurrentUser.mockReturnValue(null);
      mockSessionService.destroySession.mockRejectedValue(sessionError);

      const response = await request(app)
        .post('/auth/logout')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Session destruction failed',
        code: 'DESTROY_ERROR'
      });
    });

    it('should handle generic logout errors', async () => {
      mockSessionService.getCurrentUser.mockReturnValue(null);
      mockSessionService.destroySession.mockRejectedValue(new Error('Generic error'));

      const response = await request(app)
        .post('/auth/logout')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to logout',
        code: 'LOGOUT_ERROR'
      });
    });
  });

  describe('GET /auth/profile', () => {
    const mockSupabaseUser = {
      id: 'supabase_user_123',
      workos_user_id: 'workos_user_123',
      email: 'test@example.com',
      first_name: 'John',
      last_name: 'Doe',
      roles: ['student'],
      is_admin: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const mockSessionStats = {
      isAuthenticated: true,
      sessionAge: 3600000,
      lastActivity: new Date()
    };

    beforeEach(() => {
      // Mock the authenticateToken middleware to set req.user
      mockAuthenticateToken.mockImplementation((req: any, res: any, next: any) => {
        req.user = {
          id: 'supabase_user_123',
          workosUserId: 'workos_user_123',
          email: 'test@example.com',
          roles: ['student'],
          isAdmin: false
        };
        next();
      });
    });

    it('should return user profile successfully', async () => {
      mockUserSyncService.getUserById.mockResolvedValue(mockSupabaseUser);
      mockSessionService.getSessionStats.mockReturnValue(mockSessionStats);

      const response = await request(app)
        .get('/auth/profile')
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        user: {
          id: 'supabase_user_123',
          workosUserId: 'workos_user_123',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          roles: ['student'],
          isAdmin: false,
          createdAt: mockSupabaseUser.created_at,
          updatedAt: mockSupabaseUser.updated_at
        },
        session: {
          ...mockSessionStats,
          lastActivity: mockSessionStats.lastActivity.toISOString()
        }
      });
    });

    it('should handle missing user context', async () => {
      mockAuthenticateToken.mockImplementation((req: any, res: any, next: any) => {
        // Don't set req.user
        next();
      });

      const response = await request(app)
        .get('/auth/profile')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'User context not available',
        code: 'USER_CONTEXT_ERROR'
      });
    });

    it('should handle user not found in database', async () => {
      mockUserSyncService.getUserById.mockResolvedValue(null);

      const response = await request(app)
        .get('/auth/profile')
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND'
      });
    });

    it('should handle user synchronization errors', async () => {
      const { UserSynchronizationError } = require('../../services/userSync');
      
      const syncError = new UserSynchronizationError('Database error', 'DB_ERROR', 500);

      mockUserSyncService.getUserById.mockRejectedValue(syncError);

      const response = await request(app)
        .get('/auth/profile')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Database error',
        code: 'DB_ERROR'
      });
    });

    it('should handle generic profile retrieval errors', async () => {
      mockUserSyncService.getUserById.mockRejectedValue(new Error('Generic error'));

      const response = await request(app)
        .get('/auth/profile')
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: 'Failed to retrieve user profile',
        code: 'PROFILE_RETRIEVAL_ERROR'
      });
    });
  });

  describe('Integration Tests', () => {
    it('should handle complete authentication flow', async () => {
      // Mock the services for successful flow
      mockWorkosService.generateAuthorizationUrl.mockReturnValue('https://test-auth-url.com');
      
      // 1. Initiate login
      const loginResponse = await request(app)
        .post('/auth/login')
        .expect(200);

      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.authorizationUrl).toBeDefined();

      // 2. Mock successful callback (would normally come from WorkOS)
      const mockWorkOSUser = {
        id: 'workos_user_123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe'
      };

      const mockSupabaseUser = {
        id: 'supabase_user_123',
        workos_user_id: 'workos_user_123',
        email: 'test@example.com',
        first_name: 'John',
        last_name: 'Doe',
        roles: ['student'],
        is_admin: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      mockWorkosService.handleCallback.mockResolvedValue({
        user: mockWorkOSUser,
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_123'
      });

      mockUserSyncService.syncUser.mockResolvedValue(mockSupabaseUser);
      mockSessionService.createSession.mockResolvedValue();

      // 3. Get profile (would be called after successful authentication)
      mockUserSyncService.getUserById.mockResolvedValue(mockSupabaseUser);
      mockSessionService.getSessionStats.mockReturnValue({
        isAuthenticated: true,
        sessionAge: 1000,
        lastActivity: new Date()
      });

      const profileResponse = await request(app)
        .get('/auth/profile')
        .expect(200);

      expect(profileResponse.body.success).toBe(true);
      expect(profileResponse.body.user.email).toBe('test@example.com');

      // 4. Logout
      mockSessionService.getCurrentUser.mockReturnValue({
        userId: 'workos_user_123',
        workosUserId: 'workos_user_123',
        email: 'test@example.com',
        isAuthenticated: true,
        loginTime: new Date(),
        lastActivity: new Date()
      });
      mockSessionService.destroySession.mockResolvedValue();
      mockSessionService.clearSessionCookie.mockImplementation(() => {});

      const logoutResponse = await request(app)
        .post('/auth/logout')
        .expect(200);

      expect(logoutResponse.body.success).toBe(true);
    });
  });
});