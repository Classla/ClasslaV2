import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { AuthProvider, useAuth } from '../AuthContext';
import { authService, User, SessionInfo } from '../../services/auth';

// Mock the auth service
vi.mock('../../services/auth');
const mockAuthService = vi.mocked(authService);

// Test component that uses the auth context
const TestComponent = () => {
  const { user, session, loading, signInWithPassword, signUp, signOut, isAuthenticated } = useAuth();

  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'not-loading'}</div>
      <div data-testid="authenticated">{isAuthenticated ? 'authenticated' : 'not-authenticated'}</div>
      <div data-testid="user-email">{user?.email || 'no-user'}</div>
      <div data-testid="session-age">{session?.sessionAge || 'no-session'}</div>
      <button onClick={() => signInWithPassword('test@example.com', 'password')} data-testid="sign-in">Sign In</button>
      <button onClick={signUp} data-testid="sign-up">Sign Up</button>
      <button onClick={signOut} data-testid="sign-out">Sign Out</button>
    </div>
  );
};

// Component that throws error when used outside provider
const ComponentWithoutProvider = () => {
  useAuth();
  return <div>Should not render</div>;
};

describe('AuthContext', () => {
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

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock console.error to avoid noise in tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('useAuth hook', () => {
    it('should throw error when used outside AuthProvider', () => {
      expect(() => render(<ComponentWithoutProvider />)).toThrow(
        'useAuth must be used within an AuthProvider'
      );
    });
  });

  describe('AuthProvider', () => {
    it('should provide initial loading state', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Initially should be loading
      expect(screen.getByTestId('loading')).toHaveTextContent('loading');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });
    });

    it('should load authenticated user on mount', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
        expect(screen.getByTestId('user-email')).toHaveTextContent('test@example.com');
        expect(screen.getByTestId('session-age')).toHaveTextContent('3600000');
      });

      expect(mockAuthService.getCurrentUser).toHaveBeenCalled();
      expect(mockAuthService.getSessionInfo).toHaveBeenCalled();
    });

    it('should handle auth check failure', async () => {
      mockAuthService.getCurrentUser.mockRejectedValue(new Error('Auth check failed'));
      mockAuthService.getSessionInfo.mockRejectedValue(new Error('Session check failed'));

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
        expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
        expect(screen.getByTestId('user-email')).toHaveTextContent('no-user');
        expect(screen.getByTestId('session-age')).toHaveTextContent('no-session');
      });
    });

    it('should handle sign in', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);
      mockAuthService.signInWithPassword.mockResolvedValue();

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      const signInButton = screen.getByTestId('sign-in');
      
      await act(async () => {
        signInButton.click();
      });

      expect(mockAuthService.signInWithPassword).toHaveBeenCalled();
    });

    it('should handle sign in error', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);
      mockAuthService.signInWithPassword.mockRejectedValue(new Error('Sign in failed'));

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      const signInButton = screen.getByTestId('sign-in');
      
      // The error should be caught and handled by the component
      await act(async () => {
        try {
          signInButton.click();
          // Wait a bit for the async operation to complete
          await new Promise(resolve => setTimeout(resolve, 10));
        } catch (error) {
          // Expected to throw
        }
      });

      // Loading should be reset on error
      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });
    });

    it('should handle sign up', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);
      mockAuthService.redirectToSignup.mockResolvedValue();

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      const signUpButton = screen.getByTestId('sign-up');
      
      await act(async () => {
        signUpButton.click();
      });

      expect(mockAuthService.redirectToSignup).toHaveBeenCalled();
    });

    it('should handle sign up error', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);
      mockAuthService.redirectToSignup.mockRejectedValue(new Error('Sign up failed'));

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      const signUpButton = screen.getByTestId('sign-up');
      
      // The error should be caught and handled by the component
      await act(async () => {
        try {
          signUpButton.click();
          // Wait a bit for the async operation to complete
          await new Promise(resolve => setTimeout(resolve, 10));
        } catch (error) {
          // Expected to throw
        }
      });

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });
    });

    it('should handle sign out', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);
      mockAuthService.logout.mockResolvedValue();

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
      });

      const signOutButton = screen.getByTestId('sign-out');
      
      await act(async () => {
        signOutButton.click();
      });

      expect(mockAuthService.logout).toHaveBeenCalled();
      
      // Should clear user and session
      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
      });
      expect(screen.getByTestId('user-email')).toHaveTextContent('no-user');
      expect(screen.getByTestId('session-age')).toHaveTextContent('no-session');
    });

    it('should handle sign out error gracefully', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);
      mockAuthService.logout.mockRejectedValue(new Error('Logout failed'));

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
      });

      const signOutButton = screen.getByTestId('sign-out');
      
      await act(async () => {
        signOutButton.click();
      });

      expect(mockAuthService.logout).toHaveBeenCalled();
      
      // Should still clear user and session even on error
      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
      });
      expect(screen.getByTestId('user-email')).toHaveTextContent('no-user');
      expect(screen.getByTestId('session-age')).toHaveTextContent('no-session');
    });

    it('should handle session expired event', async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
      });

      // Dispatch session expired event
      act(() => {
        window.dispatchEvent(new CustomEvent('auth:session-expired'));
      });

      // Should clear user and session
      expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
      expect(screen.getByTestId('user-email')).toHaveTextContent('no-user');
      expect(screen.getByTestId('session-age')).toHaveTextContent('no-session');
      expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
    });

    it('should handle auth callback success event', async () => {
      mockAuthService.getCurrentUser
        .mockResolvedValueOnce(null) // Initial load
        .mockResolvedValueOnce(mockUser); // After callback
      mockAuthService.getSessionInfo
        .mockResolvedValueOnce(null) // Initial load
        .mockResolvedValueOnce(mockSession); // After callback

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      // Wait for initial load (not authenticated)
      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
      });

      // Dispatch callback success event
      act(() => {
        window.dispatchEvent(new CustomEvent('auth:callback-success'));
      });

      // Should re-check auth status and update
      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
        expect(screen.getByTestId('user-email')).toHaveTextContent('test@example.com');
      });

      // Should have called auth service twice (initial + callback)
      expect(mockAuthService.getCurrentUser).toHaveBeenCalledTimes(2);
      expect(mockAuthService.getSessionInfo).toHaveBeenCalledTimes(2);
    });

    it('should clean up event listeners on unmount', async () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');
      
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);

      const { unmount } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('auth:session-expired', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('auth:callback-success', expect.any(Function));
    });

    it('should provide correct isAuthenticated value', async () => {
      // Test not authenticated
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);

      const { rerender } = render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
      });

      // Test authenticated
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);

      rerender(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>
      );

      await waitFor(() => {
        expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
      });
    });
  });
});