import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "../contexts/AuthContext";
import { authService } from "../services/auth";
import SignInPage from "../pages/SignInPage";
import SignUpPage from "../pages/SignUpPage";
import AuthCallbackPage from "../pages/AuthCallbackPage";
import Dashboard from "../pages/Dashboard";
import ProtectedRoute from "../components/ProtectedRoute";

// Mock the auth service
vi.mock("../services/auth");
const mockAuthService = vi.mocked(authService);

// Mock fetch for callback page
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock window.location
const mockLocation = {
  href: "",
  assign: vi.fn(),
  replace: vi.fn(),
};
Object.defineProperty(window, "location", {
  value: mockLocation,
  writable: true,
});

// Mock console.error to avoid noise in tests
vi.spyOn(console, "error").mockImplementation(() => {});

// Test App component that includes routing
const TestApp = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/signin" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

// Component to display auth state for testing
const AuthStateDisplay = () => {
  const { user, loading, isAuthenticated } = useAuth();

  return (
    <div>
      <div data-testid="auth-loading">
        {loading ? "loading" : "not-loading"}
      </div>
      <div data-testid="auth-status">
        {isAuthenticated ? "authenticated" : "not-authenticated"}
      </div>
      <div data-testid="user-email">{user?.email || "no-user"}</div>
    </div>
  );
};

const TestAppWithAuthDisplay = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AuthStateDisplay />
        <Routes>
          <Route path="/signin" element={<SignInPage />} />
          <Route path="/signup" element={<SignUpPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

describe("Authentication End-to-End Tests", () => {
  const mockUser = {
    id: "user-123",
    workosUserId: "workos-user-123",
    email: "test@example.com",
    firstName: "John",
    lastName: "Doe",
    roles: ["student"],
    isAdmin: false,
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  };

  const mockSession = {
    isAuthenticated: true,
    sessionAge: 3600000,
    lastActivity: "2023-01-01T01:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocation.href = "";

    // Set up default environment
    import.meta.env.VITE_API_BASE_URL = "http://localhost:3001";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Complete Authentication Flow", () => {
    it("should handle complete login flow from sign-in to dashboard", async () => {
      // Start with unauthenticated state
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);
      mockAuthService.signInWithPassword.mockResolvedValue();

      render(<TestAppWithAuthDisplay />);

      // Should start in loading state
      expect(screen.getByTestId("auth-loading")).toHaveTextContent("loading");

      // Wait for initial auth check to complete
      await waitFor(() => {
        expect(screen.getByTestId("auth-loading")).toHaveTextContent(
          "not-loading"
        );
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "not-authenticated"
        );
      });

      // Should show sign-in page
      expect(screen.getByText("Sign In to Classla")).toBeInTheDocument();

      // Click sign-in button
      const signInButton = screen.getByRole("button", {
        name: "Sign In with WorkOS",
      });
      fireEvent.click(signInButton);

      // Should call redirectToLogin
      await waitFor(() => {
        expect(mockAuthService.signInWithPassword).toHaveBeenCalled();
      });

      // Simulate successful authentication by updating mocks
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);

      // Simulate auth callback success event
      fireEvent(window, new CustomEvent("auth:callback-success"));

      // Should update to authenticated state
      await waitFor(() => {
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "authenticated"
        );
        expect(screen.getByTestId("user-email")).toHaveTextContent(
          "test@example.com"
        );
      });
    });

    it("should handle complete signup flow", async () => {
      // Start with unauthenticated state
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);
      mockAuthService.redirectToSignup.mockResolvedValue();

      // Navigate to signup page
      window.history.pushState({}, "", "/signup");

      render(<TestAppWithAuthDisplay />);

      // Wait for initial auth check
      await waitFor(() => {
        expect(screen.getByTestId("auth-loading")).toHaveTextContent(
          "not-loading"
        );
      });

      // Should show sign-up page
      expect(screen.getByText("Sign Up for Classla")).toBeInTheDocument();

      // Click sign-up button
      const signUpButton = screen.getByRole("button", {
        name: "Sign Up with WorkOS",
      });
      fireEvent.click(signUpButton);

      // Should call redirectToSignup
      await waitFor(() => {
        expect(mockAuthService.redirectToSignup).toHaveBeenCalled();
      });
    });

    it("should handle authentication callback flow", async () => {
      // Mock successful callback
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      } as Response);

      // Start with unauthenticated, then become authenticated after callback
      mockAuthService.getCurrentUser
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      mockAuthService.getSessionInfo
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockSession);

      // Navigate to callback page with auth code
      window.history.pushState(
        {},
        "",
        "/auth/callback?code=test-code&state=test-state"
      );

      render(<TestAppWithAuthDisplay />);

      // Should show loading initially
      expect(
        screen.getByText("Processing Authentication...")
      ).toBeInTheDocument();

      // Wait for callback processing
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining("/auth/callback"),
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({ code: "test-code", state: "test-state" }),
          })
        );
      });

      // Should eventually show authenticated state
      await waitFor(() => {
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "authenticated"
        );
      });
    });

    it("should handle logout flow", async () => {
      // Start authenticated
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);
      mockAuthService.logout.mockResolvedValue();

      render(<TestAppWithAuthDisplay />);

      // Wait for initial auth check
      await waitFor(() => {
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "authenticated"
        );
      });

      // Should show dashboard
      expect(screen.getByText("Welcome to Classla")).toBeInTheDocument();

      // Find and click logout button
      const logoutButton = screen.getByRole("button", { name: "Sign Out" });
      fireEvent.click(logoutButton);

      // Should call logout service
      await waitFor(() => {
        expect(mockAuthService.logout).toHaveBeenCalled();
      });

      // Should update to unauthenticated state
      await waitFor(() => {
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "not-authenticated"
        );
      });
    });
  });

  describe("Protected Route Access", () => {
    it("should redirect unauthenticated users to sign-in", async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);

      // Try to access dashboard directly
      window.history.pushState({}, "", "/dashboard");

      render(<TestApp />);

      // Should redirect to sign-in
      await waitFor(() => {
        expect(screen.getByText("Sign In to Classla")).toBeInTheDocument();
      });
    });

    it("should allow authenticated users to access protected routes", async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);

      // Try to access dashboard
      window.history.pushState({}, "", "/dashboard");

      render(<TestApp />);

      // Should show dashboard
      await waitFor(() => {
        expect(screen.getByText("Welcome to Classla")).toBeInTheDocument();
      });
    });

    it("should redirect authenticated users away from auth pages", async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);

      // Try to access sign-in page while authenticated
      window.history.pushState({}, "", "/signin");

      render(<TestApp />);

      // Should redirect to dashboard
      await waitFor(() => {
        expect(screen.getByText("Welcome to Classla")).toBeInTheDocument();
      });
    });
  });

  describe("Session Management", () => {
    it("should handle session expiry", async () => {
      // Start authenticated
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);

      render(<TestAppWithAuthDisplay />);

      // Wait for initial auth
      await waitFor(() => {
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "authenticated"
        );
      });

      // Simulate session expiry
      fireEvent(window, new CustomEvent("auth:session-expired"));

      // Should update to unauthenticated
      await waitFor(() => {
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "not-authenticated"
        );
      });
    });

    it("should persist authentication across page reloads", async () => {
      // Simulate page reload by re-rendering with authenticated state
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);

      const { rerender } = render(<TestAppWithAuthDisplay />);

      // Should load as authenticated
      await waitFor(() => {
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "authenticated"
        );
      });

      // Simulate page reload by re-rendering
      rerender(<TestAppWithAuthDisplay />);

      // Should still be authenticated
      await waitFor(() => {
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "authenticated"
        );
      });

      // Should have called auth service again
      expect(mockAuthService.getCurrentUser).toHaveBeenCalledTimes(2);
    });
  });

  describe("Error Handling", () => {
    it("should handle authentication errors gracefully", async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);
      mockAuthService.signInWithPassword.mockRejectedValue(
        new Error("Login failed")
      );

      render(<TestAppWithAuthDisplay />);

      // Wait for initial load
      await waitFor(() => {
        expect(screen.getByTestId("auth-loading")).toHaveTextContent(
          "not-loading"
        );
      });

      // Try to sign in
      const signInButton = screen.getByRole("button", {
        name: "Sign In with WorkOS",
      });
      fireEvent.click(signInButton);

      // Should show error message
      await waitFor(() => {
        expect(screen.getByText("Login failed")).toBeInTheDocument();
      });
    });

    it("should handle callback errors", async () => {
      // Mock callback error
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Invalid authorization code" }),
      } as Response);

      mockAuthService.getCurrentUser.mockResolvedValue(null);
      mockAuthService.getSessionInfo.mockResolvedValue(null);

      // Navigate to callback with error
      window.history.pushState(
        {},
        "",
        "/auth/callback?code=invalid-code&state=test-state"
      );

      render(<TestApp />);

      // Should show error page
      await waitFor(() => {
        expect(screen.getByText("Authentication Failed")).toBeInTheDocument();
        expect(
          screen.getByText("Invalid authorization code")
        ).toBeInTheDocument();
      });
    });

    it("should handle network errors during authentication", async () => {
      mockAuthService.getCurrentUser.mockRejectedValue(
        new Error("Network error")
      );
      mockAuthService.getSessionInfo.mockRejectedValue(
        new Error("Network error")
      );

      render(<TestAppWithAuthDisplay />);

      // Should handle error gracefully and show unauthenticated state
      await waitFor(() => {
        expect(screen.getByTestId("auth-loading")).toHaveTextContent(
          "not-loading"
        );
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "not-authenticated"
        );
      });
    });
  });

  describe("User Experience", () => {
    it("should show loading states during authentication", async () => {
      // Mock slow auth check
      mockAuthService.getCurrentUser.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(null), 100))
      );
      mockAuthService.getSessionInfo.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve(null), 100))
      );

      render(<TestAppWithAuthDisplay />);

      // Should show loading initially
      expect(screen.getByTestId("auth-loading")).toHaveTextContent("loading");

      // Should eventually finish loading
      await waitFor(() => {
        expect(screen.getByTestId("auth-loading")).toHaveTextContent(
          "not-loading"
        );
      });
    });

    it("should maintain user context across navigation", async () => {
      mockAuthService.getCurrentUser.mockResolvedValue(mockUser);
      mockAuthService.getSessionInfo.mockResolvedValue(mockSession);

      render(<TestAppWithAuthDisplay />);

      // Wait for auth
      await waitFor(() => {
        expect(screen.getByTestId("auth-status")).toHaveTextContent(
          "authenticated"
        );
        expect(screen.getByTestId("user-email")).toHaveTextContent(
          "test@example.com"
        );
      });

      // Navigate to different route (simulated)
      // User context should persist
      expect(screen.getByTestId("user-email")).toHaveTextContent(
        "test@example.com"
      );
    });
  });
});
