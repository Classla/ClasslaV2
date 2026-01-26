import { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import {
  AuthenticationError,
  DatabaseError,
  asyncHandler,
} from "./errorHandler";
import { logger } from "../utils/logger";
import { sessionManagementService, UserSessionData } from "../services/session";

// Load environment variables
dotenv.config();

// Initialize Supabase client with service role key for server-side operations
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing required Supabase environment variables");
}

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

// Extend Express Request interface to include user context
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        workosUserId?: string; // Optional for managed students
        email?: string;
        roles?: string[];
        isAdmin?: boolean;
        isManagedStudent?: boolean; // True for managed student accounts
      };
    }
  }
}

/**
 * Authentication middleware that validates session cookies
 * and extracts user context from the session
 */
export const authenticateToken = asyncHandler(
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Allow test user ID in development mode without authentication
    // This enables E2E testing without requiring actual user sessions
    if (process.env.NODE_ENV === 'development') {
      const testUserId = req.body?.userId || req.body?.user_id || req.query?.userId;
      if (testUserId === '00000000-0000-0000-0000-000000000000') {
        // Create a mock user for testing
        req.user = {
          id: '00000000-0000-0000-0000-000000000000',
          workosUserId: 'test-workos-user-id',
          email: 'test@example.com',
          isAdmin: false,
        };
        logger.info("Test user authentication bypass", {
          path: req.path,
          testUserId,
        });
        next();
        return;
      }
    }

    // Log cookie information for debugging
    logger.debug("Authentication attempt", {
      path: req.path,
      sessionId: req.sessionID,
      cookies: req.headers.cookie,
      cookieHeader: req.headers.cookie ? req.headers.cookie.split(';').map(c => c.trim().substring(0, 50)) : [],
      hasSession: !!req.session,
      sessionKeys: req.session ? Object.keys(req.session) : [],
    });

    // Validate session using session management service
    const sessionData = await sessionManagementService.validateSession(req);

    if (!sessionData) {
      logger.warn("Invalid session attempt", {
        path: req.path,
        sessionId: req.sessionID,
        hasSession: !!req.session,
        sessionKeys: req.session ? Object.keys(req.session) : [],
        cookies: req.headers.cookie,
        cookieHeader: req.headers.cookie ? req.headers.cookie.split(';').map(c => c.trim().substring(0, 50)) : [],
      });
      throw new AuthenticationError("Valid session is required");
    }

    // Extract user information from the database
    // Handle both WorkOS users and managed students
    let userData;
    let userError;

    if (sessionData.isManagedStudent) {
      // For managed students, look up by user ID directly
      const result = await supabase
        .from("users")
        .select(
          "id, email, is_admin, is_managed, first_name, last_name, settings"
        )
        .eq("id", sessionData.userId)
        .eq("is_managed", true)
        .single();

      userData = result.data;
      userError = result.error;

      if (userError || !userData) {
        logger.error("Managed student not found in database", {
          error: userError,
          userId: sessionData.userId,
        });
        throw new AuthenticationError("User not found");
      }

      // Set user context for managed student
      req.user = {
        id: userData.id,
        email: userData.email,
        isAdmin: false, // Managed students are never admins
        isManagedStudent: true,
      };
    } else {
      // For regular users, look up by WorkOS user ID
      const result = await supabase
        .from("users")
        .select(
          "id, email, is_admin, workos_user_id, first_name, last_name, settings"
        )
        .eq("workos_user_id", sessionData.workosUserId)
        .single();

      userData = result.data;
      userError = result.error;

      if (userError || !userData) {
        logger.error("User not found in database", {
          error: userError,
          workosUserId: sessionData.workosUserId,
        });
        throw new AuthenticationError("User not found");
      }

      // Set user context from database data
      req.user = {
        id: userData.id,
        workosUserId: userData.workos_user_id,
        email: userData.email,
        isAdmin: userData.is_admin || false,
        isManagedStudent: false,
      };
    }

    next();
  }
);

/**
 * Optional authentication middleware - doesn't fail if no session is provided
 * but extracts user context if a valid session is present
 */
export const optionalAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Check if session exists
    const sessionData = await sessionManagementService.validateSession(req);

    if (!sessionData) {
      // No valid session, continue without user context
      next();
      return;
    }

    // If session is valid, try to get user data
    // Handle both WorkOS users and managed students
    if (sessionData.isManagedStudent) {
      // For managed students, look up by user ID
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select(
          "id, email, is_admin, is_managed, first_name, last_name, settings"
        )
        .eq("id", sessionData.userId)
        .eq("is_managed", true)
        .single();

      if (!userError && userData) {
        req.user = {
          id: userData.id,
          email: userData.email,
          isAdmin: false,
          isManagedStudent: true,
        };
      }
    } else {
      // For regular users, look up by WorkOS user ID
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select(
          "id, email, is_admin, workos_user_id, first_name, last_name, settings"
        )
        .eq("workos_user_id", sessionData.workosUserId)
        .single();

      if (!userError && userData) {
        req.user = {
          id: userData.id,
          workosUserId: userData.workos_user_id,
          email: userData.email,
          isAdmin: userData.is_admin || false,
          isManagedStudent: false,
        };
      }
    }

    next();
  } catch (error) {
    // If there's an error, continue without user context
    logger.warn("Optional auth failed", {
      error: error instanceof Error ? error.message : "Unknown error",
    });
    next();
  }
};
