// Mock environment variables for testing
const originalEnv = process.env;

// Set up environment variables before any imports
process.env = {
  ...originalEnv,
  WORKOS_API_KEY: 'test_api_key',
  WORKOS_CLIENT_ID: 'test_client_id',
  WORKOS_REDIRECT_URI: 'http://localhost:3001/auth/callback',
};

// Mock WorkOS SDK
jest.mock('@workos-inc/node', () => {
  return {
    WorkOS: jest.fn().mockImplementation(() => ({
      userManagement: {
        getAuthorizationUrl: jest.fn(),
        authenticateWithCode: jest.fn(),
        getUser: jest.fn(),
        authenticateWithPassword: jest.fn(),
      },
    })),
  };
});

import { WorkOSAuthService, WorkOSAuthenticationError, type WorkOSUser } from '../workos';

afterAll(() => {
  process.env = originalEnv;
});

describe('WorkOS Configuration', () => {
  it('should export WorkOS client instance', async () => {
    const { workos } = await import('../workos');
    expect(workos).toBeDefined();
  });

  it('should export WorkOS configuration', async () => {
    const { WORKOS_CONFIG } = await import('../workos');
    expect(WORKOS_CONFIG).toBeDefined();
    expect(WORKOS_CONFIG.clientId).toBe('test_client_id');
    expect(WORKOS_CONFIG.redirectUri).toBe('http://localhost:3001/auth/callback');
    expect(WORKOS_CONFIG.apiKey).toBe('test_api_key');
  });

  it('should throw error when required environment variables are missing', () => {
    const testEnv = { ...originalEnv };
    delete testEnv.WORKOS_CLIENT_ID;
    
    expect(() => {
      jest.isolateModules(() => {
        process.env = testEnv;
        require('../workos');
      });
    }).toThrow('WORKOS_CLIENT_ID environment variable is required');
  });
});

describe('WorkOSAuthService', () => {
  let authService: WorkOSAuthService;
  let mockWorkOS: any;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Re-import to get fresh instance
    const { workosAuthService, workos } = require('../workos');
    authService = workosAuthService;
    mockWorkOS = workos;
  });

  describe('generateAuthorizationUrl', () => {
    it('should generate authorization URL successfully', () => {
      const expectedUrl = 'https://api.workos.com/sso/authorize?client_id=test_client_id';
      mockWorkOS.userManagement.getAuthorizationUrl.mockReturnValue(expectedUrl);

      const url = authService.generateAuthorizationUrl('test-state');

      expect(url).toBe(expectedUrl);
      expect(mockWorkOS.userManagement.getAuthorizationUrl).toHaveBeenCalledWith({
        clientId: 'test_client_id',
        redirectUri: 'http://localhost:3001/auth/callback',
        state: 'test-state',
      });
    });

    it('should throw WorkOSAuthenticationError on failure', () => {
      mockWorkOS.userManagement.getAuthorizationUrl.mockImplementation(() => {
        throw new Error('WorkOS error');
      });

      expect(() => {
        authService.generateAuthorizationUrl();
      }).toThrow(WorkOSAuthenticationError);
    });
  });

  describe('handleCallback', () => {
    const mockUser = {
      id: 'user_123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      profilePictureUrl: 'https://example.com/avatar.jpg',
    };

    it('should handle callback successfully', async () => {
      mockWorkOS.userManagement.authenticateWithCode.mockResolvedValue({
        user: mockUser,
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_123',
      });

      const result = await authService.handleCallback('auth_code_123');

      expect(result).toEqual({
        user: {
          id: 'user_123',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          profilePictureUrl: 'https://example.com/avatar.jpg',
        },
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_123',
      });

      expect(mockWorkOS.userManagement.authenticateWithCode).toHaveBeenCalledWith({
        clientId: 'test_client_id',
        code: 'auth_code_123',
      });
    });

    it('should throw error when no user returned', async () => {
      mockWorkOS.userManagement.authenticateWithCode.mockResolvedValue({
        user: null,
        accessToken: 'access_token_123',
      });

      await expect(authService.handleCallback('auth_code_123')).rejects.toThrow(
        WorkOSAuthenticationError
      );
    });

    it('should handle WorkOS API errors', async () => {
      mockWorkOS.userManagement.authenticateWithCode.mockRejectedValue(
        new Error('Invalid authorization code')
      );

      await expect(authService.handleCallback('invalid_code')).rejects.toThrow(
        WorkOSAuthenticationError
      );
    });
  });

  describe('getUserProfile', () => {
    const mockUser = {
      id: 'user_123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      profilePictureUrl: 'https://example.com/avatar.jpg',
    };

    it('should retrieve user profile successfully', async () => {
      mockWorkOS.userManagement.getUser.mockResolvedValue(mockUser);

      const result = await authService.getUserProfile('user_123');

      expect(result).toEqual({
        id: 'user_123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        profilePictureUrl: 'https://example.com/avatar.jpg',
      });

      expect(mockWorkOS.userManagement.getUser).toHaveBeenCalledWith('user_123');
    });

    it('should throw error when user not found', async () => {
      mockWorkOS.userManagement.getUser.mockResolvedValue(null);

      await expect(authService.getUserProfile('nonexistent_user')).rejects.toThrow(
        WorkOSAuthenticationError
      );
    });

    it('should handle WorkOS API errors', async () => {
      mockWorkOS.userManagement.getUser.mockRejectedValue(
        new Error('User not found')
      );

      await expect(authService.getUserProfile('user_123')).rejects.toThrow(
        WorkOSAuthenticationError
      );
    });
  });

  describe('authenticateWithPassword', () => {
    const mockUser = {
      id: 'user_123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
    };

    it('should authenticate with password successfully', async () => {
      mockWorkOS.userManagement.authenticateWithPassword.mockResolvedValue({
        user: mockUser,
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_123',
      });

      const result = await authService.authenticateWithPassword(
        'test@example.com',
        'password123'
      );

      expect(result).toEqual({
        user: {
          id: 'user_123',
          email: 'test@example.com',
          firstName: 'John',
          lastName: 'Doe',
          profilePictureUrl: undefined,
        },
        accessToken: 'access_token_123',
        refreshToken: 'refresh_token_123',
      });

      expect(mockWorkOS.userManagement.authenticateWithPassword).toHaveBeenCalledWith({
        clientId: 'test_client_id',
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('should throw error on authentication failure', async () => {
      mockWorkOS.userManagement.authenticateWithPassword.mockResolvedValue({
        user: null,
      });

      await expect(
        authService.authenticateWithPassword('test@example.com', 'wrong_password')
      ).rejects.toThrow(WorkOSAuthenticationError);
    });

    it('should handle WorkOS API errors', async () => {
      mockWorkOS.userManagement.authenticateWithPassword.mockRejectedValue(
        new Error('Invalid credentials')
      );

      await expect(
        authService.authenticateWithPassword('test@example.com', 'password123')
      ).rejects.toThrow(WorkOSAuthenticationError);
    });
  });
});

describe('WorkOSAuthenticationError', () => {
  it('should create error with message, code, and status code', () => {
    const error = new WorkOSAuthenticationError(
      'Test error',
      'TEST_ERROR',
      400
    );

    expect(error.message).toBe('Test error');
    expect(error.code).toBe('TEST_ERROR');
    expect(error.statusCode).toBe(400);
    expect(error.name).toBe('WorkOSAuthenticationError');
  });

  it('should create error with just message', () => {
    const error = new WorkOSAuthenticationError('Test error');

    expect(error.message).toBe('Test error');
    expect(error.code).toBeUndefined();
    expect(error.statusCode).toBeUndefined();
  });
});