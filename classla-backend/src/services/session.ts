import { Request, Response } from 'express';
import { WorkOSUser } from './workos';

// User session data interface
export interface UserSessionData {
  userId: string;
  workosUserId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profilePictureUrl?: string;
  isAuthenticated: boolean;
  loginTime: Date;
  lastActivity: Date;
}

// Session configuration interface
export interface SessionConfig {
  maxAge: number;
  secure: boolean;
  httpOnly: boolean;
  sameSite: 'strict' | 'lax' | 'none';
}

export class SessionManagementError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'SessionManagementError';
  }
}

/**
 * Session Management Service
 * Handles session creation, validation, destruction, and cleanup
 */
export class SessionManagementService {
  private defaultConfig: SessionConfig;

  constructor() {
    this.defaultConfig = {
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      secure: process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
    };
  }

  /**
   * Create a new session for authenticated user
   * @param req Express request object
   * @param user WorkOS user data
   * @param config Optional session configuration override
   */
  async createSession(
    req: Request,
    user: WorkOSUser,
    config?: Partial<SessionConfig>
  ): Promise<void> {
    try {
      const sessionConfig = { ...this.defaultConfig, ...config };
      const now = new Date();

      // Create session data
      const sessionData: UserSessionData = {
        userId: user.id, // This will be mapped to internal user ID later
        workosUserId: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profilePictureUrl: user.profilePictureUrl,
        isAuthenticated: true,
        loginTime: now,
        lastActivity: now,
      };

      // Store session data
      (req.session as any).user = sessionData;

      // Configure session cookie
      if (req.session.cookie) {
        req.session.cookie.maxAge = sessionConfig.maxAge;
        req.session.cookie.secure = sessionConfig.secure;
        req.session.cookie.httpOnly = sessionConfig.httpOnly;
        req.session.cookie.sameSite = sessionConfig.sameSite;
      }

      // Force session save
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            reject(new SessionManagementError(
              'Failed to save session',
              'SESSION_SAVE_ERROR',
              500
            ));
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      if (error instanceof SessionManagementError) {
        throw error;
      }

      throw new SessionManagementError(
        'Failed to create session',
        'SESSION_CREATION_ERROR',
        500
      );
    }
  }

  /**
   * Validate and refresh session
   * @param req Express request object
   * @returns Session data if valid, null if invalid
   */
  async validateSession(req: Request): Promise<UserSessionData | null> {
    try {
      console.log('Session validation debug:', {
        hasSession: !!req.session,
        sessionID: req.sessionID,
        hasUser: !!(req.session as any)?.user,
        sessionKeys: req.session ? Object.keys(req.session) : []
      });

      if (!req.session || !(req.session as any).user) {
        console.log('No session or user data found');
        return null;
      }

      const sessionData = (req.session as any).user as UserSessionData;

      // Check if session is authenticated
      if (!sessionData.isAuthenticated) {
        return null;
      }

      // Check session expiration
      const now = new Date();
      const maxAge = req.session.cookie?.maxAge || this.defaultConfig.maxAge;
      const sessionAge = now.getTime() - new Date(sessionData.loginTime).getTime();

      if (sessionAge > maxAge) {
        // Session expired
        await this.destroySession(req);
        return null;
      }

      // Update last activity
      sessionData.lastActivity = now;
      (req.session as any).user = sessionData;

      // Save updated session
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            reject(new SessionManagementError(
              'Failed to update session',
              'SESSION_UPDATE_ERROR',
              500
            ));
          } else {
            resolve();
          }
        });
      });

      return sessionData;
    } catch (error) {
      if (error instanceof SessionManagementError) {
        throw error;
      }

      throw new SessionManagementError(
        'Session validation failed',
        'SESSION_VALIDATION_ERROR',
        500
      );
    }
  }

  /**
   * Destroy user session
   * @param req Express request object
   */
  async destroySession(req: Request): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        req.session.destroy((err) => {
          if (err) {
            reject(new SessionManagementError(
              'Failed to destroy session',
              'SESSION_DESTROY_ERROR',
              500
            ));
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      if (error instanceof SessionManagementError) {
        throw error;
      }

      throw new SessionManagementError(
        'Session destruction failed',
        'SESSION_DESTRUCTION_ERROR',
        500
      );
    }
  }

  /**
   * Clear session cookie from response
   * @param res Express response object
   */
  clearSessionCookie(res: Response): void {
    try {
      res.clearCookie('classla.sid', {
        path: '/',
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      });
    } catch (error) {
      throw new SessionManagementError(
        'Failed to clear session cookie',
        'COOKIE_CLEAR_ERROR',
        500
      );
    }
  }

  /**
   * Check if user is authenticated
   * @param req Express request object
   * @returns True if authenticated, false otherwise
   */
  isAuthenticated(req: Request): boolean {
    try {
      const sessionUser = (req.session as any)?.user as UserSessionData | undefined;
      return !!(
        req.session &&
        sessionUser &&
        sessionUser.isAuthenticated
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Get current user from session
   * @param req Express request object
   * @returns User data if authenticated, null otherwise
   */
  getCurrentUser(req: Request): UserSessionData | null {
    try {
      if (!this.isAuthenticated(req)) {
        return null;
      }

      return (req.session as any).user as UserSessionData;
    } catch (error) {
      return null;
    }
  }

  /**
   * Update user data in session
   * @param req Express request object
   * @param userData Partial user data to update
   */
  async updateUserInSession(
    req: Request,
    userData: Partial<Omit<UserSessionData, 'isAuthenticated' | 'loginTime'>>
  ): Promise<void> {
    try {
      if (!this.isAuthenticated(req)) {
        throw new SessionManagementError(
          'No authenticated session found',
          'NO_SESSION_ERROR',
          401
        );
      }

      const currentUser = (req.session as any).user as UserSessionData;
      const updatedUser: UserSessionData = {
        ...currentUser,
        ...userData,
        lastActivity: new Date(),
      };

      (req.session as any).user = updatedUser;

      // Save updated session
      await new Promise<void>((resolve, reject) => {
        req.session.save((err) => {
          if (err) {
            reject(new SessionManagementError(
              'Failed to update user in session',
              'SESSION_USER_UPDATE_ERROR',
              500
            ));
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      if (error instanceof SessionManagementError) {
        throw error;
      }

      throw new SessionManagementError(
        'Failed to update user in session',
        'USER_UPDATE_ERROR',
        500
      );
    }
  }

  /**
   * Cleanup expired sessions (for memory store)
   * This would be handled automatically by Redis in production
   */
  async cleanupExpiredSessions(): Promise<void> {
    // Note: This is primarily for memory store cleanup
    // In production with Redis, this would be handled automatically
    try {
      console.log('Session cleanup triggered (memory store only)');
      // Implementation would depend on the session store being used
      // For now, this is a placeholder for future implementation
    } catch (error) {
      console.warn('Session cleanup failed:', error);
    }
  }

  /**
   * Get session statistics (for monitoring)
   * @param req Express request object
   * @returns Session statistics
   */
  getSessionStats(req: Request): {
    isAuthenticated: boolean;
    sessionAge?: number;
    lastActivity?: Date;
    userId?: string;
  } {
    try {
      if (!this.isAuthenticated(req)) {
        return { isAuthenticated: false };
      }

      const user = (req.session as any).user as UserSessionData;
      const now = new Date();
      const sessionAge = now.getTime() - new Date(user.loginTime).getTime();

      return {
        isAuthenticated: true,
        sessionAge,
        lastActivity: user.lastActivity,
        userId: user.userId,
      };
    } catch (error) {
      return { isAuthenticated: false };
    }
  }
}

// Create singleton instance
export const sessionManagementService = new SessionManagementService();

export default sessionManagementService;