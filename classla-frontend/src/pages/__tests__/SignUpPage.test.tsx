import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SignUpPage from '../SignUpPage';
import { AuthProvider } from '../../contexts/AuthContext';
import { authService } from '../../services/auth';

// Mock the auth service
vi.mock('../../services/auth');
const mockAuthService = vi.mocked(authService);

// Mock console.error to avoid noise in tests
vi.spyOn(console, 'error').mockImplementation(() => {});

const renderSignUpPage = () => {
  return render(
    <MemoryRouter initialEntries={['/signup']}>
      <AuthProvider>
        <SignUpPage />
      </AuthProvider>
    </MemoryRouter>
  );
};

describe('SignUpPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthService.getCurrentUser.mockResolvedValue(null);
    mockAuthService.getSessionInfo.mockResolvedValue(null);
  });

  it('should render sign up page correctly', async () => {
    renderSignUpPage();

    await waitFor(() => {
      expect(screen.getByText('Sign Up for Classla LMS')).toBeInTheDocument();
    });

    expect(screen.getByText('Create your account to get started with Classla LMS. Click the button below to sign up.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign Up with WorkOS' })).toBeInTheDocument();
    expect(screen.getByText("Already have an account?")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in here' })).toBeInTheDocument();
  });

  it('should handle sign up button click', async () => {
    mockAuthService.redirectToSignup.mockResolvedValue();
    
    renderSignUpPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign Up with WorkOS' })).toBeInTheDocument();
    });

    const signUpButton = screen.getByRole('button', { name: 'Sign Up with WorkOS' });
    fireEvent.click(signUpButton);

    // Button should show loading state
    expect(screen.getByRole('button', { name: 'Redirecting...' })).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();

    await waitFor(() => {
      expect(mockAuthService.redirectToSignup).toHaveBeenCalled();
    });
  });

  it('should handle sign up error', async () => {
    const errorMessage = 'Failed to initiate signup';
    mockAuthService.redirectToSignup.mockRejectedValue(new Error(errorMessage));
    
    renderSignUpPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign Up with WorkOS' })).toBeInTheDocument();
    });

    const signUpButton = screen.getByRole('button', { name: 'Sign Up with WorkOS' });
    fireEvent.click(signUpButton);

    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    // Button should be enabled again
    expect(screen.getByRole('button', { name: 'Sign Up with WorkOS' })).toBeInTheDocument();
    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('should handle sign up error with custom message', async () => {
    const customError = { message: 'Custom error message' };
    mockAuthService.redirectToSignup.mockRejectedValue(customError);
    
    renderSignUpPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign Up with WorkOS' })).toBeInTheDocument();
    });

    const signUpButton = screen.getByRole('button', { name: 'Sign Up with WorkOS' });
    fireEvent.click(signUpButton);

    await waitFor(() => {
      expect(screen.getByText('Custom error message')).toBeInTheDocument();
    });
  });

  it('should handle sign up error without message', async () => {
    mockAuthService.redirectToSignup.mockRejectedValue({});
    
    renderSignUpPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign Up with WorkOS' })).toBeInTheDocument();
    });

    const signUpButton = screen.getByRole('button', { name: 'Sign Up with WorkOS' });
    fireEvent.click(signUpButton);

    await waitFor(() => {
      expect(screen.getByText('Failed to initiate sign up. Please try again.')).toBeInTheDocument();
    });
  });

  it('should redirect to home when user is already authenticated', async () => {
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

    mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
    mockAuthService.getSessionInfo.mockResolvedValue({
      isAuthenticated: true,
      sessionAge: 3600000,
      lastActivity: '2023-01-01T01:00:00Z',
    });

    renderSignUpPage();

    await waitFor(() => {
      // Should not render the sign up page content
      expect(screen.queryByText('Sign Up for Classla LMS')).not.toBeInTheDocument();
    });
  });

  it('should clear error when signing up again', async () => {
    mockAuthService.redirectToSignup
      .mockRejectedValueOnce(new Error('First error'))
      .mockResolvedValueOnce();
    
    renderSignUpPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign Up with WorkOS' })).toBeInTheDocument();
    });

    const signUpButton = screen.getByRole('button', { name: 'Sign Up with WorkOS' });
    
    // First click - should show error
    fireEvent.click(signUpButton);

    await waitFor(() => {
      expect(screen.getByText('First error')).toBeInTheDocument();
    });

    // Second click - should clear error
    fireEvent.click(signUpButton);

    await waitFor(() => {
      expect(screen.queryByText('First error')).not.toBeInTheDocument();
    });
  });

  it('should have correct link to sign in page', async () => {
    renderSignUpPage();

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Sign in here' })).toBeInTheDocument();
    });

    const signInLink = screen.getByRole('link', { name: 'Sign in here' });
    expect(signInLink).toHaveAttribute('href', '/signin');
  });

  it('should disable button during loading', async () => {
    mockAuthService.redirectToSignup.mockImplementation(() => new Promise(() => {})); // Never resolves
    
    renderSignUpPage();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Sign Up with WorkOS' })).toBeInTheDocument();
    });

    const signUpButton = screen.getByRole('button', { name: 'Sign Up with WorkOS' });
    fireEvent.click(signUpButton);

    // Button should be disabled and show loading text
    expect(screen.getByRole('button', { name: 'Redirecting...' })).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });
});