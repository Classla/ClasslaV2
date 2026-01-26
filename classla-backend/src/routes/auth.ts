import { Router, Request, Response } from "express";
import {
  workosAuthService,
  WorkOSAuthenticationError,
} from "../services/workos";
import {
  sessionManagementService,
  SessionManagementError,
} from "../services/session";
import {
  userSynchronizationService,
  UserSynchronizationError,
} from "../services/userSync";
import {
  managedStudentService,
  ManagedStudentServiceError,
} from "../services/managedStudentService";
import { authenticateToken } from "../middleware/auth";
import { logger } from "../utils/logger";
import { storeOAuthState, validateOAuthState } from "../services/stateStore";
import crypto from "crypto";

const router = Router();

/**
 * POST /auth/password-login
 * Authenticate user with email and password
 */
router.post("/auth/password-login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Validate required parameters
    if (!email || !password) {
      logger.warn("Password login missing credentials", {
        requestId: req.headers["x-request-id"],
        email: email ? "[PROVIDED]" : "[MISSING]",
        password: password ? "[PROVIDED]" : "[MISSING]",
        ip: req.ip,
      });

      return res.status(400).json({
        success: false,
        error: "Email and password are required",
        code: "MISSING_CREDENTIALS",
      });
    }

    // Authenticate with WorkOS
    const authResult = await workosAuthService.authenticateWithPassword(
      email,
      password
    );

    logger.info("Password authentication successful", {
      requestId: req.headers["x-request-id"],
      workosUserId: authResult.user.id,
      email: authResult.user.email,
      ip: req.ip,
    });

    // Sync user with Supabase database
    const supabaseUser = await userSynchronizationService.syncUser(
      authResult.user
    );

    logger.info("User synchronized with database", {
      requestId: req.headers["x-request-id"],
      supabaseUserId: supabaseUser.id,
      workosUserId: authResult.user.id,
      email: authResult.user.email,
    });

    // Create user session
    await sessionManagementService.createSession(req, authResult.user);

    logger.info("User session created", {
      requestId: req.headers["x-request-id"],
      supabaseUserId: supabaseUser.id,
      workosUserId: authResult.user.id,
      email: authResult.user.email,
    });

    return res.json({
      success: true,
      message: "Authentication successful",
    });
  } catch (error) {
    logger.error("Password authentication failed", {
      requestId: req.headers["x-request-id"],
      error: error instanceof Error ? error.message : "Unknown error",
      ip: req.ip,
    });

    if (error instanceof WorkOSAuthenticationError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }

    if (error instanceof UserSynchronizationError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: "Failed to sync user data",
        code: error.code || "USER_SYNC_ERROR",
      });
    }

    if (error instanceof SessionManagementError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: "Failed to create session",
        code: error.code || "SESSION_ERROR",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Authentication failed",
      code: "PASSWORD_AUTH_ERROR",
    });
  }
});

/**
 * POST /auth/managed-login
 * Authenticate managed student with username and password
 */
router.post("/auth/managed-login", async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    // Validate required parameters
    if (!username || !password) {
      logger.warn("Managed login missing credentials", {
        requestId: req.headers["x-request-id"],
        username: username ? "[PROVIDED]" : "[MISSING]",
        password: password ? "[PROVIDED]" : "[MISSING]",
        ip: req.ip,
      });

      return res.status(400).json({
        success: false,
        error: "Username and password are required",
        code: "MISSING_CREDENTIALS",
      });
    }

    // Authenticate the managed student
    const student = await managedStudentService.authenticateManagedStudent(
      username,
      password
    );

    if (!student) {
      logger.warn("Managed login failed - invalid credentials", {
        requestId: req.headers["x-request-id"],
        username,
        ip: req.ip,
      });

      return res.status(401).json({
        success: false,
        error: "Invalid username or password",
        code: "INVALID_CREDENTIALS",
      });
    }

    logger.info("Managed student authentication successful", {
      requestId: req.headers["x-request-id"],
      studentId: student.id,
      username: student.username,
      ip: req.ip,
    });

    // Create session for managed student
    await sessionManagementService.createManagedStudentSession(req, {
      id: student.id,
      email: student.email,
      firstName: student.first_name,
      lastName: student.last_name,
    });

    logger.info("Managed student session created", {
      requestId: req.headers["x-request-id"],
      studentId: student.id,
      username: student.username,
    });

    return res.json({
      success: true,
      message: "Authentication successful",
    });
  } catch (error) {
    logger.error("Managed login failed", {
      requestId: req.headers["x-request-id"],
      error: error instanceof Error ? error.message : "Unknown error",
      ip: req.ip,
    });

    if (error instanceof ManagedStudentServiceError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }

    if (error instanceof SessionManagementError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: "Failed to create session",
        code: error.code || "SESSION_ERROR",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Authentication failed",
      code: "MANAGED_AUTH_ERROR",
    });
  }
});

/**
 * POST /auth/google-login
 * Initiate Google OAuth flow
 * Generates Google authorization URL and redirects user to Google
 */
router.post("/auth/google-login", async (req: Request, res: Response) => {
  try {
    // Generate CSRF state token for security
    const state = crypto.randomBytes(32).toString("hex");

    // Store state in Redis/memory store (not session, because session cookies don't work cross-domain)
    await storeOAuthState(state, 600); // 10 minute TTL

    // Generate Google OAuth authorization URL
    const authorizationUrl =
      workosAuthService.generateGoogleAuthorizationUrl(state);

    logger.info("Google login initiated", {
      requestId: req.headers["x-request-id"],
      state,
      ip: req.ip,
    });

    // Return authorization URL for frontend to redirect to
    return res.json({
      success: true,
      authorizationUrl,
      message: "Google login initiated successfully",
    });
  } catch (error) {
    logger.error("Google login initiation failed", {
      requestId: req.headers["x-request-id"],
      error: error instanceof Error ? error.message : "Unknown error",
      ip: req.ip,
    });

    if (error instanceof WorkOSAuthenticationError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to initiate Google login",
      code: "GOOGLE_LOGIN_INITIATION_ERROR",
    });
  }
});

/**
 * GET /auth/callback
 * Handle WorkOS OAuth callback
 * Exchange authorization code for user profile and create session
 */
router.get("/auth/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    // Validate required parameters
    if (!code || typeof code !== "string") {
      logger.warn("Callback missing authorization code", {
        requestId: req.headers["x-request-id"],
        query: req.query,
        ip: req.ip,
      });

      return res.status(400).json({
        success: false,
        error: "Authorization code is required",
        code: "MISSING_AUTH_CODE",
      });
    }

    // Validate CSRF state token using Redis/memory store (not session)
    if (!state || typeof state !== "string") {
      logger.warn("Missing state parameter", {
        requestId: req.headers["x-request-id"],
        query: req.query,
        ip: req.ip,
      });

      return res.status(400).json({
        success: false,
        error: "State parameter is required",
        code: "MISSING_STATE",
      });
    }

    // Validate state from Redis/memory store
    const isValidState = await validateOAuthState(state);
    if (!isValidState) {
      logger.warn("Invalid or expired state parameter", {
        requestId: req.headers["x-request-id"],
        providedState: state,
        ip: req.ip,
      });

      return res.status(400).json({
        success: false,
        error: "Invalid or expired state parameter",
        code: "INVALID_STATE",
      });
    }

    // Exchange authorization code for user profile
    const authResult = await workosAuthService.handleCallback(
      code,
      state as string
    );

    logger.info("WorkOS authentication successful", {
      requestId: req.headers["x-request-id"],
      workosUserId: authResult.user.id,
      email: authResult.user.email,
      ip: req.ip,
    });

    // Sync user with Supabase database
    const supabaseUser = await userSynchronizationService.syncUser(
      authResult.user
    );

    logger.info("User synchronized with database", {
      requestId: req.headers["x-request-id"],
      supabaseUserId: supabaseUser.id,
      workosUserId: authResult.user.id,
      email: authResult.user.email,
    });

    // Create user session
    await sessionManagementService.createSession(req, authResult.user);

    logger.info("User session created", {
      requestId: req.headers["x-request-id"],
      supabaseUserId: supabaseUser.id,
      workosUserId: authResult.user.id,
      email: authResult.user.email,
      sessionId: req.sessionID,
      cookieDomain: req.session.cookie?.domain,
      cookieSameSite: req.session.cookie?.sameSite,
    });

    // Verify session has user data before saving
    const sessionUser = (req.session as any).user;
    if (!sessionUser) {
      logger.error("Session user data missing before save", {
        requestId: req.headers["x-request-id"],
        sessionId: req.sessionID,
        sessionKeys: Object.keys(req.session || {}),
      });
      throw new Error("Session user data is missing");
    }

    // Ensure session is saved and cookie is set before redirect
    await new Promise<void>((resolve, reject) => {
      req.session.save((err) => {
        if (err) {
          logger.error("Failed to save session before redirect", {
            requestId: req.headers["x-request-id"],
            error: err.message,
            sessionId: req.sessionID,
          });
          reject(err);
        } else {
          // Verify session still has user data after save
          const savedUser = (req.session as any).user;
          
          if (!savedUser) {
            logger.error("Session user data lost after save!", {
              requestId: req.headers["x-request-id"],
              sessionId: req.sessionID,
            });
            reject(new Error("Session user data is missing after save"));
            return;
          }
          
          logger.info("Session saved successfully before redirect", {
            requestId: req.headers["x-request-id"],
            sessionId: req.sessionID,
            userEmail: savedUser.email,
          });
          
          resolve();
        }
      });
    });

    // DO NOT explicitly set the cookie - express-session handles this automatically
    // Setting it explicitly can cause signature mismatches and prevent express-session
    // from recognizing the cookie on subsequent requests
    // The session.save() call above ensures the cookie is set by express-session

    // Redirect to frontend dashboard
    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
      logger.error("FRONTEND_URL environment variable is not set");
      return res.status(500).json({
        success: false,
        error: "Frontend URL not configured",
        code: "CONFIGURATION_ERROR",
      });
    }
    return res.redirect(`${frontendUrl}/dashboard?auth=success`);
  } catch (error) {
    logger.error("Authentication callback failed", {
      requestId: req.headers["x-request-id"],
      error: error instanceof Error ? error.message : "Unknown error",
      query: req.query,
      ip: req.ip,
    });

    // Determine error type and status code
    let statusCode = 500;
    let errorMessage = "Authentication failed";
    let errorCode = "CALLBACK_ERROR";

    if (error instanceof WorkOSAuthenticationError) {
      statusCode = error.statusCode || 400;
      errorMessage = error.message;
      errorCode = error.code || "WORKOS_ERROR";
    } else if (error instanceof UserSynchronizationError) {
      statusCode = error.statusCode || 500;
      errorMessage = "Failed to sync user data";
      errorCode = error.code || "USER_SYNC_ERROR";
    } else if (error instanceof SessionManagementError) {
      statusCode = error.statusCode || 500;
      errorMessage = "Failed to create session";
      errorCode = error.code || "SESSION_ERROR";
    }

    // Redirect to frontend with error
    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
      logger.error("FRONTEND_URL environment variable is not set");
      return res.status(500).json({
        success: false,
        error: "Frontend URL not configured",
        code: "CONFIGURATION_ERROR",
      });
    }
    return res.redirect(
      `${frontendUrl}/login?error=${encodeURIComponent(
        errorMessage
      )}&code=${errorCode}`
    );
  }
});

/**
 * POST /auth/logout
 * Destroy user session and clear cookies
 */
router.post("/auth/logout", async (req: Request, res: Response) => {
  try {
    const currentUser = sessionManagementService.getCurrentUser(req);

    if (currentUser) {
      logger.info("User logout initiated", {
        requestId: req.headers["x-request-id"],
        userId: currentUser.userId,
        workosUserId: currentUser.workosUserId,
        email: currentUser.email,
        ip: req.ip,
      });
    }

    // Destroy session
    await sessionManagementService.destroySession(req);

    // Clear session cookie
    sessionManagementService.clearSessionCookie(res);

    logger.info("User logout completed", {
      requestId: req.headers["x-request-id"],
      userId: currentUser?.userId,
      ip: req.ip,
    });

    return res.json({
      success: true,
      message: "Logged out successfully",
    });
  } catch (error) {
    logger.error("Logout failed", {
      requestId: req.headers["x-request-id"],
      error: error instanceof Error ? error.message : "Unknown error",
      ip: req.ip,
    });

    if (error instanceof SessionManagementError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to logout",
      code: "LOGOUT_ERROR",
    });
  }
});

/**
 * GET /auth/profile
 * Get current user profile information
 * Protected route - requires valid session
 */
router.get(
  "/auth/profile",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      // User context is set by authenticateToken middleware
      if (!req.user) {
        logger.error("User context missing after authentication", {
          requestId: req.headers["x-request-id"],
          sessionId: req.sessionID,
        });

        return res.status(500).json({
          success: false,
          error: "User context not available",
          code: "USER_CONTEXT_ERROR",
        });
      }

      // Fetch complete user data from Supabase
      const supabaseUser = await userSynchronizationService.getUserById(
        req.user.id
      );

      if (!supabaseUser) {
        logger.error("User not found in database", {
          requestId: req.headers["x-request-id"],
          userId: req.user.id,
          workosUserId: req.user.workosUserId,
        });

        return res.status(404).json({
          success: false,
          error: "User not found",
          code: "USER_NOT_FOUND",
        });
      }

      // Get session statistics for additional context
      const sessionStats = sessionManagementService.getSessionStats(req);

      logger.info("User profile retrieved", {
        requestId: req.headers["x-request-id"],
        userId: supabaseUser.id,
        workosUserId: supabaseUser.workos_user_id,
        email: supabaseUser.email,
      });

      // Return user profile data
      return res.json({
        success: true,
        user: {
          id: supabaseUser.id,
          workosUserId: supabaseUser.workos_user_id,
          email: supabaseUser.email,
          firstName: supabaseUser.first_name,
          lastName: supabaseUser.last_name,
          isAdmin: supabaseUser.is_admin,
          isManagedStudent: supabaseUser.is_managed === true,
          createdAt: supabaseUser.created_at,
          updatedAt: supabaseUser.updated_at,
        },
        session: {
          isAuthenticated: sessionStats.isAuthenticated,
          sessionAge: sessionStats.sessionAge,
          lastActivity: sessionStats.lastActivity,
        },
      });
    } catch (error) {
      logger.error("Failed to retrieve user profile", {
        requestId: req.headers["x-request-id"],
        userId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
        ip: req.ip,
      });

      if (error instanceof UserSynchronizationError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to retrieve user profile",
        code: "PROFILE_RETRIEVAL_ERROR",
      });
    }
  }
);

/**
 * POST /auth/password-signup
 * Create a new user account with email and password
 */
router.post("/auth/password-signup", async (req: Request, res: Response) => {
  try {
    const { email, password, firstName, lastName } = req.body;

    // Validate required parameters
    if (!email || !password) {
      logger.warn("Password signup missing credentials", {
        requestId: req.headers["x-request-id"],
        email: email ? "[PROVIDED]" : "[MISSING]",
        password: password ? "[PROVIDED]" : "[MISSING]",
        ip: req.ip,
      });

      return res.status(400).json({
        success: false,
        error: "Email and password are required",
        code: "MISSING_CREDENTIALS",
      });
    }

    // Validate password length
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: "Password must be at least 8 characters long",
        code: "INVALID_PASSWORD",
      });
    }

    // Create user with WorkOS
    const workosUser = await workosAuthService.signUpWithPassword(
      email,
      password,
      firstName,
      lastName
    );

    logger.info("User created with WorkOS", {
      requestId: req.headers["x-request-id"],
      workosUserId: workosUser.id,
      email: workosUser.email,
      ip: req.ip,
    });

    // Sync user with Supabase database
    const supabaseUser = await userSynchronizationService.syncUser(workosUser);

    logger.info("User synchronized with database", {
      requestId: req.headers["x-request-id"],
      supabaseUserId: supabaseUser.id,
      workosUserId: workosUser.id,
      email: workosUser.email,
    });

    // Authenticate the user immediately after signup
    const authResult = await workosAuthService.authenticateWithPassword(
      email,
      password
    );

    // Create user session
    await sessionManagementService.createSession(req, authResult.user);

    logger.info("User session created after signup", {
      requestId: req.headers["x-request-id"],
      supabaseUserId: supabaseUser.id,
      workosUserId: workosUser.id,
      email: workosUser.email,
    });

    return res.json({
      success: true,
      message: "Account created successfully",
    });
  } catch (error) {
    logger.error("Password signup failed", {
      requestId: req.headers["x-request-id"],
      error: error instanceof Error ? error.message : "Unknown error",
      ip: req.ip,
    });

    if (error instanceof WorkOSAuthenticationError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }

    if (error instanceof UserSynchronizationError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: "Failed to sync user data",
        code: error.code || "USER_SYNC_ERROR",
      });
    }

    if (error instanceof SessionManagementError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: "Failed to create session",
        code: error.code || "SESSION_ERROR",
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to create account",
      code: "SIGNUP_ERROR",
    });
  }
});

/**
 * POST /auth/signup
 * Initiate WorkOS signup flow (redirects to WorkOS hosted signup)
 * This is kept for backward compatibility and OAuth-based signup
 */
router.post("/auth/signup", async (req: Request, res: Response) => {
  try {
    // Generate CSRF state token for security
    const state = crypto.randomBytes(32).toString("hex");

    // Store state in Redis/memory store (not session, because session cookies don't work cross-domain)
    await storeOAuthState(state, 600); // 10 minute TTL

    // Generate WorkOS authorization URL for signup
    const authorizationUrl = workosAuthService.generateAuthorizationUrl(state);

    logger.info("Signup initiated", {
      requestId: req.headers["x-request-id"],
      state,
      ip: req.ip,
    });

    // Return authorization URL for frontend to redirect to
    return res.json({
      success: true,
      authorizationUrl,
      message: "Signup initiated successfully",
    });
  } catch (error) {
    logger.error("Signup initiation failed", {
      requestId: req.headers["x-request-id"],
      error: error instanceof Error ? error.message : "Unknown error",
      ip: req.ip,
    });

    if (error instanceof WorkOSAuthenticationError) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        code: error.code,
      });
    }

    return res.status(500).json({
      success: false,
      error: "Failed to initiate signup",
      code: "SIGNUP_INITIATION_ERROR",
    });
  }
});

/**
 * POST /auth/change-password
 * Allow managed students to change their own password
 * Protected route - requires valid session and must be a managed student
 */
router.post(
  "/auth/change-password",
  authenticateToken,
  async (req: Request, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: "Not authenticated",
          code: "NOT_AUTHENTICATED",
        });
      }

      // Only managed students can use this endpoint
      if (!req.user.isManagedStudent) {
        return res.status(403).json({
          success: false,
          error: "This feature is only available for managed student accounts",
          code: "NOT_MANAGED_STUDENT",
        });
      }

      const { currentPassword, newPassword } = req.body;

      if (!currentPassword || !newPassword) {
        return res.status(400).json({
          success: false,
          error: "Current password and new password are required",
          code: "MISSING_FIELDS",
        });
      }

      await managedStudentService.changeOwnPassword(
        req.user.id,
        currentPassword,
        newPassword
      );

      logger.info("Managed student changed password", {
        requestId: req.headers["x-request-id"],
        userId: req.user.id,
        ip: req.ip,
      });

      return res.json({
        success: true,
        message: "Password changed successfully",
      });
    } catch (error) {
      logger.error("Password change failed", {
        requestId: req.headers["x-request-id"],
        userId: req.user?.id,
        error: error instanceof Error ? error.message : "Unknown error",
        ip: req.ip,
      });

      if (error instanceof ManagedStudentServiceError) {
        return res.status(error.statusCode || 500).json({
          success: false,
          error: error.message,
          code: error.code,
        });
      }

      return res.status(500).json({
        success: false,
        error: "Failed to change password",
        code: "PASSWORD_CHANGE_ERROR",
      });
    }
  }
);

export default router;
