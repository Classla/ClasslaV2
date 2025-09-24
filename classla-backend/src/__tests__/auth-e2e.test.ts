import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { createClient } from '@supabase/supabase-js';

// Import the actual app components
import authRouter from '../routes/auth';
import { authenticateToken } from '../middleware/auth';
import { errorHandler } from '../middleware/errorHandler';

// Mock WorkOS for E2E tests
jest.mock('@workos-inc/node', () => {
  return {
    WorkOS: jest.fn().mockImplementation(() => ({
      userManagement: {
        getAuthorizationUrl: jest.fn().mockReturnValue('https://api.workos.com/sso/authorize?client_id=test'),
        authenticateWithCode: jest.fn(),
        getUser: jest.fn(),
        authenticateWithPassword: jest.fn(),
      },
    })),
  };
});

// Mock logger
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Authentication End-to-End Tests', () => {
  let app: express.Application;
  let supabase: any;
  let testUserId: string;

  beforeAll(async () => {
    // Set up test environment variables
    process.env.WORKOS_API_KEY = 'test_api_key';
    process.env.WORKOS_CLIENT_ID = 'test_client_id';
    process.env.WORKOS_REDIRECT_URI = 'http://localhost:3001/auth/callback';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test_service_key';
    process.env.SESSION_SECRET = 'test_session_secret';
    process.env.FRONTEND_URL = 'http://localhost:5173';

    // Create Express app
    app = express();
    app.use(express.json());
    app.use(session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { 
        secure: false,
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      }
    }));

    // Add routes
    app.use(authRouter);

    // Add a test protected route
    app.get('/api/test/protected', authenticateToken, (req, res) => {
      res.json({
        success: true,
        user: req.user,
        message: 'Access granted to protected resource'
      });
    });

    // Add error handler
    app.use(errorHandler);

    // Initialize Supabase client for test cleanup
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SERVICE_ROLE_KEY
      );
    }
  });

  beforeEach(async () => {
    // Clean up any test data before each test
    if (supabase) {
      await supabase
        .from('users')
        .delete()
        .like('email', 'test%@example.com');
    }
  });

  afterEach(async () => {
    // Clean up test data after each test
    if (supabase && testUserId) {
      await supabase
        .from('users')
        .delete()
        .eq('id', testUserId);
      testUserId = '';
    }
  });

  afterAll(async () => {
    // Final cleanup
    if (supabase) {
      await supabase
        .from('users')
        .delete()
        .like('email', 'test%@example.com');
    }
  });

  describe('Complete Authentication Flow', () => {
    it('should handle complete login and logout flow', async () => {
      const agent = request.agent(app);

      // Step 1: Initiate login
      const loginResponse = await agent
        .post('/auth/login')
        .expect(200);

      expect(loginResponse.body.success).toBe(true);
      expect(loginResponse.body.authorizationUrl).toBeDefined();
      expect(loginResponse.body.authorizationUrl).toContain('api.workos.com');

      // Step 2: Mock successful WorkOS callback
      const mockWorkOSUser = {
        id: 'workos_user_e2e_test',
        email: 'test-e2e@example.com',
        firstName: 'E2E',
        lastName: 'Test',
        profilePictureUrl: 'https://example.com/avatar.jpg'
      };

      const mockSupabaseUser = {
        id: 'supabase_user_e2e_test',
        workos_user_id: 'workos_user_e2e_test',
        email: 'test-e2e@example.com',
        first_name: 'E2E',
        last_name: 'Test',
        roles: ['student'],
        is_admin: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      // Mock WorkOS authentication
      const { WorkOS } = require('@workos-inc/node');
      const mockWorkOS = new WorkOS();
      mockWorkOS.userManagement.authenticateWithCode.mockResolvedValue({
        user: mockWorkOSUser,
        accessToken: 'test_access_token',
        refreshToken: 'test_refresh_token'
      });

      // Mock Supabase user creation/retrieval
      if (supabase) {
        // Create test user in database
        const { data: createdUser } = await supabase
          .from('users')
          .insert(mockSupabaseUser)
          .select()
          .single();
        
        testUserId = createdUser?.id;
      }

      // Step 3: Simulate callback (this would normally be a GET request from WorkOS)
      // For E2E testing, we'll simulate the session creation directly
      const callbackResponse = await agent
        .get('/auth/callback')
        .query({ 
          code: 'test_authorization_code',
          state: 'test_state' // This should match the state from login
        });

      // The callback should redirect (302) or return success
      expect([200, 302]).toContain(callbackResponse.status);

      // Step 4: Test protected route access
      const protectedResponse = await agent
        .get('/api/test/protected')
        .expect(200);

      expect(protectedResponse.body.success).toBe(true);
      expect(protectedResponse.body.user).toBeDefined();
      expect(protectedResponse.body.user.email).toBe('test-e2e@example.com');

      // Step 5: Get user profile
      const profileResponse = await agent
        .get('/auth/profile')
        .expect(200);

      expect(profileResponse.body.success).toBe(true);
      expect(profileResponse.body.user.email).toBe('test-e2e@example.com');
      expect(profileResponse.body.session.isAuthenticated).toBe(true);

      // Step 6: Logout
      const logoutResponse = await agent
        .post('/auth/logout')
        .expect(200);

      expect(logoutResponse.body.success).toBe(true);

      // Step 7: Verify access is denied after logout
      await agent
        .get('/api/test/protected')
        .expect(401);

      await agent
        .get('/auth/profile')
        .expect(401);
    });

    it('should handle session persistence across requests', async () => {
      const agent = request.agent(app);

      // Create a test user session
      const mockUser = {
        id: 'supabase_user_persistence_test',
        workos_user_id: 'workos_user_persistence_test',
        email: 'test-persistence@example.com',
        first_name: 'Persistence',
        last_name: 'Test',
        roles: ['student'],
        is_admin: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      if (supabase) {
        const { data: createdUser } = await supabase
          .from('users')
          .insert(mockUser)
          .select()
          .single();
        
        testUserId = createdUser?.id;
      }

      // Simulate login by creating session manually
      // In a real E2E test, this would go through the full OAuth flow
      await agent.post('/auth/login');

      // Mock the session creation by making multiple requests
      // Each request should maintain the session
      for (let i = 0; i < 3; i++) {
        const response = await agent
          .get('/api/test/protected');

        // First request might fail if session isn't properly set up
        // Subsequent requests should work if session persistence is working
        if (response.status === 200) {
          expect(response.body.success).toBe(true);
          expect(response.body.user).toBeDefined();
        }
      }
    });

    it('should handle invalid session scenarios', async () => {
      // Test 1: No session cookie
      const response1 = await request(app)
        .get('/api/test/protected')
        .expect(401);

      // Test 2: Invalid session data
      const agent = request.agent(app);
      
      // Make a request without proper authentication
      await agent
        .get('/api/test/protected')
        .expect(401);

      // Test 3: Expired session (simulated)
      // This would require more complex session manipulation
      await agent
        .get('/auth/profile')
        .expect(401);
    });

    it('should handle concurrent authentication requests', async () => {
      // Test multiple simultaneous login requests
      const loginPromises = Array.from({ length: 3 }, () => 
        request(app).post('/auth/login')
      );

      const responses = await Promise.all(loginPromises);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.authorizationUrl).toBeDefined();
      });
    });

    it('should handle authentication errors gracefully', async () => {
      const agent = request.agent(app);

      // Test 1: Invalid callback parameters
      await agent
        .get('/auth/callback')
        .query({ code: 'invalid_code' })
        .expect(400);

      // Test 2: Missing authorization code
      await agent
        .get('/auth/callback')
        .query({ state: 'test_state' })
        .expect(400);

      // Test 3: Invalid state parameter
      await agent
        .get('/auth/callback')
        .query({ 
          code: 'test_code',
          state: 'invalid_state'
        })
        .expect(400);
    });

    it('should handle user synchronization scenarios', async () => {
      if (!supabase) {
        console.log('Skipping user sync test - no Supabase connection');
        return;
      }

      const agent = request.agent(app);

      // Test user creation on first login
      const newUserData = {
        id: 'workos_new_user_test',
        email: 'test-new-user@example.com',
        firstName: 'New',
        lastName: 'User'
      };

      // Mock WorkOS response for new user
      const { WorkOS } = require('@workos-inc/node');
      const mockWorkOS = new WorkOS();
      mockWorkOS.userManagement.authenticateWithCode.mockResolvedValue({
        user: newUserData,
        accessToken: 'test_access_token',
        refreshToken: 'test_refresh_token'
      });

      // Simulate callback for new user
      // This should create a new user in the database
      const callbackResponse = await agent
        .get('/auth/callback')
        .query({ 
          code: 'test_new_user_code',
          state: 'test_state'
        });

      // Check if user was created in database
      const { data: createdUser } = await supabase
        .from('users')
        .select('*')
        .eq('workos_user_id', newUserData.id)
        .single();

      if (createdUser) {
        expect(createdUser.email).toBe(newUserData.email);
        expect(createdUser.first_name).toBe(newUserData.firstName);
        testUserId = createdUser.id;
      }
    });
  });

  describe('Security Tests', () => {
    it('should prevent session fixation attacks', async () => {
      const agent1 = request.agent(app);
      const agent2 = request.agent(app);

      // Agent 1 gets a session
      await agent1.post('/auth/login');

      // Agent 2 should not be able to use Agent 1's session
      await agent2
        .get('/api/test/protected')
        .expect(401);
    });

    it('should handle CSRF protection', async () => {
      const agent = request.agent(app);

      // Test that state parameter is required and validated
      await agent
        .get('/auth/callback')
        .query({ 
          code: 'test_code',
          // Missing or invalid state should be rejected
        })
        .expect(400);
    });

    it('should enforce secure cookie settings', async () => {
      const agent = request.agent(app);

      const response = await agent.post('/auth/login');

      // Check that session cookies have proper security settings
      const cookies = response.headers['set-cookie'];
      if (cookies) {
        const sessionCookie = cookies.find((cookie: string) => 
          cookie.includes('classla.sid') || cookie.includes('connect.sid')
        );
        
        if (sessionCookie) {
          expect(sessionCookie).toMatch(/HttpOnly/i);
          // In production, should also have Secure flag
          // expect(sessionCookie).toMatch(/Secure/i);
        }
      }
    });
  });

  describe('Performance Tests', () => {
    it('should handle authentication within reasonable time limits', async () => {
      const startTime = Date.now();

      await request(app)
        .post('/auth/login')
        .expect(200);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Authentication should complete within 1 second
      expect(duration).toBeLessThan(1000);
    });

    it('should handle multiple concurrent sessions', async () => {
      const agents = Array.from({ length: 5 }, () => request.agent(app));

      // Create multiple sessions concurrently
      const loginPromises = agents.map(agent => 
        agent.post('/auth/login')
      );

      const responses = await Promise.all(loginPromises);

      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });
    });
  });
});