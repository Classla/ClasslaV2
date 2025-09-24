import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SignInPage from '../SignInPage';
import { useAuth } from '../../contexts/AuthContext';

// Mock the auth context
vi.mock('../../contexts/AuthContext');
const mockUseAuth = vi.mocked(useAuth);

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    Navigate: ({ to }: { to: string }) => {
      mockNavigate(to);
      return <div data-testid="navigate-to">{to}</div>;
    },
  };
});

describe('SignInPage', () => {
  const renderSignInPage = (initialEntries = ['/signin']) => {
    return render(
      <MemoryRouter initialEntries={initialEntries}>
        <SignInPage />
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mock implementation
    mockUseAuth.mockReturnValue({
      user: null,
      session: null,
      loading: false,
      signInWithPassword: vi.fn(),
      signInWithGoogle: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      isAuthenticated: false,
    });
  });

  it('should render sign in page correctly', () => {
    renderSignInPage();

    expect(screen.getByRole('heading', { name: 'Sign In to Classla LMS' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In with Google' })).toBeInTheDocument();
    expect(screen.getByText("Don't have an account?")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign up here' })).toBeInTheDocument();
  });

  it('should handle password sign in', async () => {
    const mockSignInWithPassword = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: null,
      session: null,
      loading: false,
      signInWithPassword: mockSignInWithPassword,
      signInWithGoogle: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      isAuthenticated: false,
    });
    
    renderSignInPage();

    const emailInput = screen.getByLabelText('Email');
    const passwordInput = screen.getByLabelText('Password');
    const signInButton = screen.getByRole('button', { name: 'Sign In' });

    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    fireEvent.click(signInButton);

    await waitFor(() => {
      expect(mockSignInWithPassword).toHaveBeenCalledWith('test@example.com', 'password123');
    });
  });

  it('should handle Google sign in', async () => {
    const mockSignInWithGoogle = vi.fn().mockResolvedValue(undefined);
    mockUseAuth.mockReturnValue({
      user: null,
      session: null,
      loading: false,
      signInWithPassword: vi.fn(),
      signInWithGoogle: mockSignInWithGoogle,
      signUp: vi.fn(),
      signOut: vi.fn(),
      isAuthenticated: false,
    });
    
    renderSignInPage();

    const googleButton = screen.getByRole('button', { name: 'Sign In with Google' });
    fireEvent.click(googleButton);

    await waitFor(() => {
      expect(mockSignInWithGoogle).toHaveBeenCalled();
    });
  });

  it('should redirect to dashboard if user is already authenticated', () => {
    mockUseAuth.mockReturnValue({
      user: {
        id: '1',
        workosUserId: 'workos-1',
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        roles: ['student'],
        isAdmin: false,
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-01T00:00:00Z',
      },
      session: null,
      loading: false,
      signInWithPassword: vi.fn(),
      signInWithGoogle: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      isAuthenticated: true,
    });

    renderSignInPage();

    expect(screen.getByTestId('navigate-to')).toHaveTextContent('/');
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('should require email and password to enable sign in button', () => {
    renderSignInPage();

    const signInButton = screen.getByRole('button', { name: 'Sign In' });
    expect(signInButton).toBeDisabled();

    const emailInput = screen.getByLabelText('Email');
    fireEvent.change(emailInput, { target: { value: 'test@example.com' } });
    expect(signInButton).toBeDisabled();

    const passwordInput = screen.getByLabelText('Password');
    fireEvent.change(passwordInput, { target: { value: 'password123' } });
    expect(signInButton).not.toBeDisabled();
  });
});