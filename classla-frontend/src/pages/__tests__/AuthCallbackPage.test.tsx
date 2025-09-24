import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuthCallbackPage from '../AuthCallbackPage';
import { AuthProvider } from '../../contexts/AuthContext';
import { authService } from '../../services/auth';

// Mock the auth service
vi.mock('../../services/auth');
const mockAuthService = vi.mocked(authService);

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock console.error to avoid noise in tests
vi.spyOn(console, 'error').mockImplementation(() => {});

// Mock window.dispatchEvent
const mockDispatchEvent = vi.fn();
Object.defineProperty(window, 'dispatchEvent', {
  value: mockDispatchEvent,
});

const renderAuthCallbackPage = (searchParams = '') => {
  return render(
    <MemoryRouter initialEntries={[`/auth/callback${searchParams}`]}>
      <AuthProvider>
        <AuthCallbackPage />
      </AuthProvider>
    </MemoryRouter>
  );
};

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthService.getCurrentUser.mockResolvedValue(null);
    mockAuthService.getSessionInfo.mockResolvedValue(null);
    
    // Set up default environment
    import.meta.env.VITE_API_BASE_URL = 'http://localhost:3001';
  });

  afterEach(() => {
    // Clean up
  });

  it('should show loading state initially', async () => {
    mockFetch.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    renderAuthCallbackPage('?code=test-code&state=test-state');

    expect(screen.getByText('Processing Authentication...')).toBeInTheDocument();
    expect(screen.getByText('Please wait while we complete your sign in.')).toBeInTheDocument();
  });

  it('should handle successful callback', async () => {
    const mockUser = {
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

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    // Mock user being loaded after callback
    mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
    mockAuthService.getSessionInfo.mockResolvedValue({
      isAuthenticated: true,
      sessionAge: 3600000,
      lastActivity: '2023-01-01T01:00:00Z',
    });

    renderAuthCallbackPage('?code=test-code&state=test-state');

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/callback'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ code: 'test-code', state: 'test-state' }),
        }
      );
    });

    await waitFor(() => {
      expect(mockDispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'auth:callback-success',
        })
      );
    });
  });

  it('should handle error from URL parameters', async () => {
    renderAuthCallbackPage('?error=access_denied&error_description=User%20denied%20access');

    await waitFor(() => {
      expect(screen.getByText('Authentication Failed')).toBeInTheDocument();
      expect(screen.getByText('User denied access')).toBeInTheDocument();
    });

    expect(screen.getByRole('link', { name: 'Try Again' })).toHaveAttribute('href', '/signin');
    expect(screen.getByRole('link', { name: 'Sign Up Instead' })).toHaveAttribute('href', '/signup');
  });

  it('should handle error without description', async () => {
    renderAuthCallbackPage('?error=access_denied');

    await waitFor(() => {
      expect(screen.getByText('Authentication Failed')).toBeInTheDocument();
      expect(screen.getByText('Authentication failed')).toBeInTheDocument();
    });
  });

  it('should handle missing authorization code', async () => {
    renderAuthCallbackPage('?state=test-state');

    await waitFor(() => {
      expect(screen.getByText('Authentication Failed')).toBeInTheDocument();
      expect(screen.getByText('No authorization code received')).toBeInTheDocument();
    });
  });

  it('should handle backend error response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: 'Invalid authorization code' }),
    } as Response);

    renderAuthCallbackPage('?code=invalid-code&state=test-state');

    await waitFor(() => {
      expect(screen.getByText('Authentication Failed')).toBeInTheDocument();
      expect(screen.getByText('Invalid authorization code')).toBeInTheDocument();
    });
  });

  it('should handle backend error without error message', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({}),
    } as Response);

    renderAuthCallbackPage('?code=invalid-code&state=test-state');

    await waitFor(() => {
      expect(screen.getByText('Authentication Failed')).toBeInTheDocument();
      expect(screen.getByText('Authentication failed')).toBeInTheDocument();
    });
  });

  it('should handle network error', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));

    renderAuthCallbackPage('?code=test-code&state=test-state');

    await waitFor(() => {
      expect(screen.getByText('Authentication Failed')).toBeInTheDocument();
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('should handle generic error without message', async () => {
    mockFetch.mockRejectedValue({});

    renderAuthCallbackPage('?code=test-code&state=test-state');

    await waitFor(() => {
      expect(screen.getByText('Authentication Failed')).toBeInTheDocument();
      expect(screen.getByText('Authentication failed')).toBeInTheDocument();
    });
  });

  it('should redirect to signin when no user and no error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    // Keep user as null
    mockAuthService.getCurrentUser.mockResolvedValue(null);
    mockAuthService.getSessionInfo.mockResolvedValue(null);

    renderAuthCallbackPage('?code=test-code&state=test-state');

    await waitFor(() => {
      // Should not show the callback page content
      expect(screen.queryByText('Processing Authentication...')).not.toBeInTheDocument();
    });
  });

  it('should use default API base URL when env var not set', async () => {
    // Temporarily unset the env var
    const originalEnv = import.meta.env.VITE_API_BASE_URL;
    delete import.meta.env.VITE_API_BASE_URL;
    
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    renderAuthCallbackPage('?code=test-code&state=test-state');

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/auth/callback'),
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          credentials: 'include',
          body: JSON.stringify({ code: 'test-code', state: 'test-state' }),
        }
      );
    });
    
    // Restore the env var
    import.meta.env.VITE_API_BASE_URL = originalEnv;
  });

  it('should show loading while auth context is loading', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    // Mock auth context as still loading
    mockAuthService.getCurrentUser.mockImplementation(() => new Promise(() => {}));

    renderAuthCallbackPage('?code=test-code&state=test-state');

    // Should show loading even after callback processing is done
    await waitFor(() => {
      expect(screen.getByText('Processing Authentication...')).toBeInTheDocument();
    });
  });

  it('should handle successful authentication and redirect', async () => {
    const mockUser = {
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

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    } as Response);

    // Simulate user being loaded after successful callback
    mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
    mockAuthService.getSessionInfo.mockResolvedValue({
      isAuthenticated: true,
      sessionAge: 3600000,
      lastActivity: '2023-01-01T01:00:00Z',
    });

    renderAuthCallbackPage('?code=test-code&state=test-state');

    await waitFor(() => {
      // Should not show the callback page content (redirected)
      expect(screen.queryByText('Processing Authentication...')).not.toBeInTheDocument();
    });
  });
});