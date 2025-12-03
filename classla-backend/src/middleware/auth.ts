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
        workosUserId: string;
        email?: string;
        roles?: string[];
        isAdmin?: boolean;
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
    // Validate session using session management service
    const sessionData = await sessionManagementService.validateSession(req);

    if (!sessionData) {
      logger.warn("Invalid session attempt", {
        path: req.path,
        sessionId: req.sessionID,
        hasSession: !!req.session,
        sessionKeys: req.session ? Object.keys(req.session) : [],
      });
      throw new AuthenticationError("Valid session is required");
    }

    // Extract user information from the database using WorkOS user ID
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select(
        "id, email, is_admin, workos_user_id, first_name, last_name, settings"
      )
      .eq("workos_user_id", sessionData.workosUserId)
      .single();

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
    };

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
      };
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
