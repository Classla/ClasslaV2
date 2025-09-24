import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import axios from 'axios';
import { AuthService, User, SessionInfo, AuthError } from '../auth';

// Mock axios
vi.mock('axios');
const mockedAxios = vi.mocked(axios);

// Mock window.location
const mockLocation = {
  href: '',
};
Object.defineProperty(window, 'location', {
  value: mockLocation,
  writable: true,
});

// Mock window.dispatchEvent
const mockDispatchEvent = vi.fn();
Object.defineProperty(window, 'dispatchEvent', {
  value: mockDispatchEvent,
});

describe('AuthService', () => {
  let authService: AuthService;
  let mockAxiosInstance: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockLocation.href = '';
    
    // Create mock axios instance
    mockAxiosInstance = {
      post: vi.fn(),
      get: vi.fn(),
      request: vi.fn(),
      interceptors: {
        response: {
          use: vi.fn(),
        },
      },
    };

    // Mock axios.create to return our mock instance
    mockedAxios.create.mockReturnValue(mockAxiosInstance);
    mockedAxios.isAxiosError.mockImplementation((error: any) => {
      return error && error.isAxiosError === true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create axios instance with correct config', () => {
      // Create new instance to test constructor
      new AuthService();
      
      expect(mockedAxios.create).toHaveBeenCalledWith({
        baseURL: 'http://localhost:3001',
        withCredentials: true,
        timeout: 10000,
      });
    });

    it('should set up response interceptor', () => {
      // Create new instance to test constructor
      new AuthService();
      
      expect(mockAxiosInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('initiateLogin', () => {
    beforeEach(() => {
      authService = new AuthService();
    });
    const mockLoginResponse = {
      success: true,
      authorizationUrl: 'https://api.workos.com/sso/authorize?client_id=test',
      message: 'Login initiated successfully',
    };

    it('should initiate login successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: mockLoginResponse });

      const result = await authService.initiateLogin();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/login');
      expect(result).toEqual(mockLoginResponse);
    });

    it('should handle API errors with error response', async () => {
      const mockError = {
        isAxiosError: true,
        response: {
          data: {
            success: false,
            error: 'Login failed',
            code: 'LOGIN_ERROR',
          } as AuthError,
        },
      };

      mockAxiosInstance.post.mockRejectedValue(mockError);
      mockedAxios.isAxiosError.mockReturnValue(true);

      await expect(authService.initiateLogin()).rejects.toEqual({
        success: false,
        error: 'Login failed',
        code: 'LOGIN_ERROR',
      });
    });

    it('should handle generic errors', async () => {
      mockAxiosInstance.post.mockRejectedValue(new Error('Network error'));

      await expect(authService.initiateLogin()).rejects.toThrow('Failed to initiate login');
    });
  });

  describe('initiateSignup', () => {
    beforeEach(() => {
      authService = new AuthService();
    });
    const mockSignupResponse = {
      success: true,
      authorizationUrl: 'https://api.workos.com/sso/authorize?client_id=test&signup=true',
      message: 'Signup initiated successfully',
    };

    it('should initiate signup successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({ data: mockSignupResponse });

      const result = await authService.initiateSignup();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/signup');
      expect(result).toEqual(mockSignupResponse);
    });

    it('should handle API errors', async () => {
      const mockError = {
        isAxiosError: true,
        response: {
          data: {
            success: false,
            error: 'Signup failed',
            code: 'SIGNUP_ERROR',
          } as AuthError,
        },
      };

      mockAxiosInstance.post.mockRejectedValue(mockError);
      mockedAxios.isAxiosError.mockReturnValue(true);

      await expect(authService.initiateSignup()).rejects.toEqual({
        success: false,
        error: 'Signup failed',
        code: 'SIGNUP_ERROR',
      });
    });
  });

  describe('getCurrentUser', () => {
    beforeEach(() => {
      authService = new AuthService();
    });
    const mockUser: User = {
      id: 'user-123',
      workosUserId: 'workos-user-123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      roles: ['student'],
      isAdmin: false,
      createdAt: '2023-01-01T00:00:00Z',
      updatedAt: '2023-01-01T00:00:00Z',
    };

    const mockSession: SessionInfo = {
      isAuthenticated: true,
      sessionAge: 3600000,
      lastActivity: '2023-01-01T01:00:00Z',
    };

    it('should get current user successfully', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          success: true,
          user: mockUser,
          session: mockSession,
        },
      });

      const result = await authService.getCurrentUser();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/auth/profile');
      expect(result).toEqual(mockUser);
    });

    it('should return null for unauthenticated user', async () => {
      const mockError = {
        isAxiosError: true,
        response: { status: 401 },
      };

      mockAxiosInstance.get.mockRejectedValue(mockError);
      mockedAxios.isAxiosError.mockReturnValue(true);

      const result = await authService.getCurrentUser();

      expect(result).toBeNull();
    });

    it('should throw error for other API errors', async () => {
      const mockError = {
        isAxiosError: true,
        response: { status: 500 },
      };

      mockAxiosInstance.get.mockRejectedValue(mockError);
      mockedAxios.isAxiosError.mockReturnValue(true);

      await expect(authService.getCurrentUser()).rejects.toEqual(mockError);
    });
  });

  describe('getSessionInfo', () => {
    beforeEach(() => {
      authService = new AuthService();
    });
    const mockSession: SessionInfo = {
      isAuthenticated: true,
      sessionAge: 3600000,
      lastActivity: '2023-01-01T01:00:00Z',
    };

    it('should get session info successfully', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          success: true,
          user: {} as User,
          session: mockSession,
        },
      });

      const result = await authService.getSessionInfo();

      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/auth/profile');
      expect(result).toEqual(mockSession);
    });

    it('should return null for unauthenticated session', async () => {
      const mockError = {
        isAxiosError: true,
        response: { status: 401 },
      };

      mockAxiosInstance.get.mockRejectedValue(mockError);
      mockedAxios.isAxiosError.mockReturnValue(true);

      const result = await authService.getSessionInfo();

      expect(result).toBeNull();
    });
  });

  describe('logout', () => {
    beforeEach(() => {
      authService = new AuthService();
    });
    it('should logout successfully', async () => {
      mockAxiosInstance.post.mockResolvedValue({
        data: { success: true, message: 'Logged out successfully' },
      });

      await authService.logout();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/logout');
    });

    it('should handle logout errors gracefully', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockAxiosInstance.post.mockRejectedValue(new Error('Logout failed'));

      // Should not throw
      await authService.logout();

      expect(consoleErrorSpy).toHaveBeenCalledWith('Logout error:', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });

  describe('isAuthenticated', () => {
    beforeEach(() => {
      authService = new AuthService();
    });
    it('should return true when user is authenticated', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          success: true,
          user: { id: 'user-123' } as User,
          session: {} as SessionInfo,
        },
      });

      const result = await authService.isAuthenticated();

      expect(result).toBe(true);
    });

    it('should return false when user is not authenticated', async () => {
      const mockError = {
        isAxiosError: true,
        response: { status: 401 },
      };

      mockAxiosInstance.get.mockRejectedValue(mockError);
      mockedAxios.isAxiosError.mockReturnValue(true);

      const result = await authService.isAuthenticated();

      expect(result).toBe(false);
    });

    it('should return false on any error', async () => {
      mockAxiosInstance.get.mockRejectedValue(new Error('Network error'));

      const result = await authService.isAuthenticated();

      expect(result).toBe(false);
    });
  });

  describe('redirectToLogin', () => {
    beforeEach(() => {
      authService = new AuthService();
    });
    it('should redirect to login URL', async () => {
      const mockLoginResponse = {
        success: true,
        authorizationUrl: 'https://api.workos.com/sso/authorize?client_id=test',
        message: 'Login initiated successfully',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockLoginResponse });

      await authService.signInWithPassword('test@example.com', 'password');

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/login');
      expect(mockLocation.href).toBe('https://api.workos.com/sso/authorize?client_id=test');
    });

    it('should handle redirect errors', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockAxiosInstance.post.mockRejectedValue(new Error('Login failed'));

      await expect(authService.signInWithPassword('test@example.com', 'password')).rejects.toThrow('Login failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to redirect to login:', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });

  describe('redirectToSignup', () => {
    beforeEach(() => {
      authService = new AuthService();
    });
    it('should redirect to signup URL', async () => {
      const mockSignupResponse = {
        success: true,
        authorizationUrl: 'https://api.workos.com/sso/authorize?client_id=test&signup=true',
        message: 'Signup initiated successfully',
      };

      mockAxiosInstance.post.mockResolvedValue({ data: mockSignupResponse });

      await authService.redirectToSignup();

      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/auth/signup');
      expect(mockLocation.href).toBe('https://api.workos.com/sso/authorize?client_id=test&signup=true');
    });

    it('should handle redirect errors', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockAxiosInstance.post.mockRejectedValue(new Error('Signup failed'));

      await expect(authService.redirectToSignup()).rejects.toThrow('Signup failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to redirect to signup:', expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });

  describe('authenticatedRequest', () => {
    beforeEach(() => {
      authService = new AuthService();
    });
    it('should make authenticated GET request', async () => {
      const mockData = { id: 1, name: 'Test' };
      mockAxiosInstance.request.mockResolvedValue({ data: mockData });

      const result = await authService.authenticatedRequest('GET', '/api/test');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'get',
        url: '/api/test',
      });
      expect(result).toEqual(mockData);
    });

    it('should make authenticated POST request with data', async () => {
      const mockData = { success: true };
      const requestData = { name: 'Test' };
      mockAxiosInstance.request.mockResolvedValue({ data: mockData });

      const result = await authService.authenticatedRequest('POST', '/api/test', requestData);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'post',
        url: '/api/test',
        data: requestData,
      });
      expect(result).toEqual(mockData);
    });

    it('should handle request errors', async () => {
      const mockError = new Error('Request failed');
      mockAxiosInstance.request.mockRejectedValue(mockError);

      await expect(authService.authenticatedRequest('GET', '/api/test')).rejects.toThrow('Request failed');
    });
  });

  describe('response interceptor', () => {
    beforeEach(() => {
      authService = new AuthService();
    });
    it('should handle 401 errors by dispatching session expired event', () => {
      // Get the interceptor function that was registered
      const interceptorCall = mockAxiosInstance.interceptors.response.use.mock.calls[0];
      const errorHandler = interceptorCall[1];

      const mockError = {
        response: { status: 401 },
      };

      expect(() => errorHandler(mockError)).toThrow();
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth:session-expired',
        })
      );
    });

    it('should pass through non-401 errors', () => {
      const interceptorCall = mockAxiosInstance.interceptors.response.use.mock.calls[0];
      const errorHandler = interceptorCall[1];

      const mockError = {
        response: { status: 500 },
      };

      expect(() => errorHandler(mockError)).toThrow();
      expect(mockDispatchEvent).not.toHaveBeenCalled();
    });
  });
});