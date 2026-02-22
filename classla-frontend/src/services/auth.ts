import axios, { AxiosError } from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';

// User interface matching backend response
export interface User {
  id: string;
  workosUserId?: string; // Optional for managed students
  email: string;
  firstName?: string;
  lastName?: string;
  roles: string[];
  isAdmin: boolean;
  isManagedStudent?: boolean; // True for managed student accounts
  createdAt: string;
  updatedAt: string;
}

// Session interface matching backend response
export interface SessionInfo {
  isAuthenticated: boolean;
  sessionAge: number;
  lastActivity: string;
}

// Auth response interfaces
export interface LoginResponse {
  success: boolean;
  authorizationUrl: string;
  message: string;
}

export interface SignupResponse {
  success: boolean;
  authorizationUrl: string;
  message: string;
}

export interface ProfileResponse {
  success: boolean;
  user: User;
  session: SessionInfo;
}

export interface LogoutResponse {
  success: boolean;
  message: string;
}

// Auth error interface
export interface AuthError {
  success: false;
  error: string;
  code: string;
}

// Auth service class
export class AuthService {
  private apiClient = axios.create({
    baseURL: API_BASE_URL,
    withCredentials: true, // Include cookies for session management
    timeout: 10000,
  });

  constructor() {
    // Add response interceptor for error handling
    this.apiClient.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Session expired or invalid, trigger auth state update
          this.handleAuthError();
        }
        throw error;
      }
    );
  }

  /**
   * Initiate login flow by getting WorkOS authorization URL
   */
  async initiateLogin(): Promise<LoginResponse> {
    try {
      const response = await this.apiClient.post<LoginResponse>('/auth/login');
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data) {
        throw error.response.data as AuthError;
      }
      throw new Error('Failed to initiate login');
    }
  }

  /**
   * Initiate signup flow by getting WorkOS authorization URL
   */
  async initiateSignup(): Promise<SignupResponse> {
    try {
      const response = await this.apiClient.post<SignupResponse>('/auth/signup');
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data) {
        throw error.response.data as AuthError;
      }
      throw new Error('Failed to initiate signup');
    }
  }

  /**
   * Get current user profile if authenticated
   */
  async getCurrentUser(): Promise<User | null> {
    try {
      const response = await this.apiClient.get<ProfileResponse>('/auth/profile');
      return response.data.user;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        // Not authenticated
        return null;
      }
      throw error;
    }
  }

  /**
   * Get current session information
   */
  async getSessionInfo(): Promise<SessionInfo | null> {
    try {
      const response = await this.apiClient.get<ProfileResponse>('/auth/profile');
      return response.data.session;
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        // Not authenticated
        return null;
      }
      throw error;
    }
  }

  /**
   * Logout user and destroy session
   */
  async logout(): Promise<void> {
    try {
      await this.apiClient.post<LogoutResponse>('/auth/logout');
    } catch (error) {
      // Even if logout fails on server, we should clear local state
      console.error('Logout error:', error);
    }
  }

  /**
   * Check if user is currently authenticated
   */
  async isAuthenticated(): Promise<boolean> {
    try {
      const user = await this.getCurrentUser();
      return user !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * Sign in with email and password
   */
  async signInWithPassword(email: string, password: string): Promise<void> {
    try {
      const response = await this.apiClient.post('/auth/password-login', {
        email,
        password
      });
      
      if (!response.data.success) {
        throw new Error(response.data.error || 'Password authentication failed');
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data) {
        throw error.response.data as AuthError;
      }
      throw new Error('Failed to sign in with password');
    }
  }

  /**
   * Sign in as a managed student with username and password
   */
  async signInManagedStudent(username: string, password: string): Promise<void> {
    try {
      const response = await this.apiClient.post('/auth/managed-login', {
        username,
        password
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Managed student authentication failed');
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data) {
        throw error.response.data as AuthError;
      }
      throw new Error('Failed to sign in');
    }
  }

  /**
   * Sign in with Google OAuth
   */
  async signInWithGoogle(): Promise<void> {
    try {
      const response = await this.apiClient.post('/auth/google-login');
      
      if (response.data.success && response.data.authorizationUrl) {
        window.location.href = response.data.authorizationUrl;
      } else {
        throw new Error('Failed to initiate Google sign in');
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data) {
        throw error.response.data as AuthError;
      }
      throw new Error('Failed to sign in with Google');
    }
  }

  /**
   * Sign up with email and password
   */
  async signUpWithPassword(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string
  ): Promise<void> {
    try {
      const response = await this.apiClient.post('/auth/password-signup', {
        email,
        password,
        firstName,
        lastName,
      });
      
      if (!response.data.success) {
        throw new Error(response.data.error || 'Password signup failed');
      }
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.data) {
        throw error.response.data as AuthError;
      }
      throw new Error('Failed to sign up with password');
    }
  }

  /**
   * Redirect to WorkOS signup
   */
  async redirectToSignup(): Promise<void> {
    try {
      const signupResponse = await this.initiateSignup();
      window.location.href = signupResponse.authorizationUrl;
    } catch (error) {
      console.error('Failed to redirect to signup:', error);
      throw error;
    }
  }

  /**
   * Handle authentication errors (e.g., session expiry)
   */
  private handleAuthError(): void {
    // This will be called by the response interceptor
    // The AuthContext will handle the actual state updates
    window.dispatchEvent(new CustomEvent('auth:session-expired'));
  }

  /**
   * Make authenticated API request
   * This method can be used by other services that need to make authenticated requests
   */
  async authenticatedRequest<T = any>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    data?: any
  ): Promise<T> {
    const config = {
      method: method.toLowerCase(),
      url,
      ...(data && { data }),
    };

    const response = await this.apiClient.request<T>(config);
    return response.data;
  }
}

// Export singleton instance
export const authService = new AuthService();