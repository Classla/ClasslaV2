import { WorkOS } from '@workos-inc/node';

// WorkOS configuration
export const WORKOS_CONFIG = {
  clientId: process.env.WORKOS_CLIENT_ID!,
  redirectUri: process.env.WORKOS_REDIRECT_URI!,
  apiKey: process.env.WORKOS_API_KEY!,
} as const;

// Validate required environment variables
if (!WORKOS_CONFIG.clientId) {
  throw new Error('WORKOS_CLIENT_ID environment variable is required');
}

if (!WORKOS_CONFIG.redirectUri) {
  throw new Error('WORKOS_REDIRECT_URI environment variable is required');
}

if (!WORKOS_CONFIG.apiKey) {
  throw new Error('WORKOS_API_KEY environment variable is required');
}

// Initialize WorkOS client
const workos = new WorkOS(WORKOS_CONFIG.apiKey);

// Types for WorkOS authentication
export interface WorkOSUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  profilePictureUrl?: string;
}

export interface AuthenticationResult {
  user: WorkOSUser;
  accessToken?: string;
  refreshToken?: string;
}

export class WorkOSAuthenticationError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'WorkOSAuthenticationError';
  }
}

/**
 * WorkOS Authentication Service
 * Handles OAuth flows, user profile retrieval, and authentication with WorkOS
 */
export class WorkOSAuthService {
  private workos: WorkOS;

  constructor() {
    this.workos = workos;
  }

  /**
   * Generate authorization URL for WorkOS OAuth flow
   * @param state Optional state parameter for CSRF protection
   * @returns Authorization URL for redirecting users
   */
  generateAuthorizationUrl(state?: string): string {
    try {
      const authorizationUrl = this.workos.userManagement.getAuthorizationUrl({
        clientId: WORKOS_CONFIG.clientId,
        redirectUri: WORKOS_CONFIG.redirectUri,
        provider: 'authkit',
        state,
      });

      return authorizationUrl;
    } catch (error) {
      throw new WorkOSAuthenticationError(
        'Failed to generate authorization URL',
        'AUTHORIZATION_URL_ERROR',
        500
      );
    }
  }

  /**
   * Handle OAuth callback and exchange authorization code for user profile
   * @param code Authorization code from WorkOS callback
   * @param state State parameter for CSRF validation
   * @returns User profile and authentication tokens
   */
  async handleCallback(
    code: string,
    state?: string
  ): Promise<AuthenticationResult> {
    try {
      // Exchange authorization code for user profile
      const { user, accessToken, refreshToken } = await this.workos.userManagement.authenticateWithCode({
        clientId: WORKOS_CONFIG.clientId,
        code,
      });

      if (!user) {
        throw new WorkOSAuthenticationError(
          'No user returned from WorkOS authentication',
          'NO_USER_ERROR',
          400
        );
      }

      // Transform WorkOS user to our interface
      const transformedUser: WorkOSUser = {
        id: user.id,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        profilePictureUrl: user.profilePictureUrl || undefined,
      };

      return {
        user: transformedUser,
        accessToken,
        refreshToken,
      };
    } catch (error) {
      if (error instanceof WorkOSAuthenticationError) {
        throw error;
      }

      // Handle WorkOS API errors
      if (error && typeof error === 'object' && 'message' in error) {
        throw new WorkOSAuthenticationError(
          `WorkOS authentication failed: ${error.message}`,
          'WORKOS_API_ERROR',
          400
        );
      }

      throw new WorkOSAuthenticationError(
        'Authentication callback failed',
        'CALLBACK_ERROR',
        500
      );
    }
  }

  /**
   * Retrieve user profile by WorkOS user ID
   * @param userId WorkOS user ID
   * @returns User profile information
   */
  async getUserProfile(userId: string): Promise<WorkOSUser> {
    try {
      const user = await this.workos.userManagement.getUser(userId);

      if (!user) {
        throw new WorkOSAuthenticationError(
          'User not found',
          'USER_NOT_FOUND',
          404
        );
      }

      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        profilePictureUrl: user.profilePictureUrl || undefined,
      };
    } catch (error) {
      if (error instanceof WorkOSAuthenticationError) {
        throw error;
      }

      // Handle WorkOS API errors
      if (error && typeof error === 'object' && 'message' in error) {
        throw new WorkOSAuthenticationError(
          `Failed to retrieve user profile: ${error.message}`,
          'PROFILE_RETRIEVAL_ERROR',
          400
        );
      }

      throw new WorkOSAuthenticationError(
        'Failed to retrieve user profile',
        'PROFILE_ERROR',
        500
      );
    }
  }

  /**
   * Validate access token with WorkOS
   * @param accessToken Access token to validate
   * @returns User information if token is valid
   */
  async validateAccessToken(accessToken: string): Promise<WorkOSUser> {
    try {
      // Note: This method depends on WorkOS SDK capabilities
      // You may need to adjust based on actual WorkOS SDK methods available
      const user = await this.workos.userManagement.getUser(accessToken);

      if (!user) {
        throw new WorkOSAuthenticationError(
          'Invalid access token',
          'INVALID_TOKEN',
          401
        );
      }

      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        profilePictureUrl: user.profilePictureUrl || undefined,
      };
    } catch (error) {
      if (error instanceof WorkOSAuthenticationError) {
        throw error;
      }

      throw new WorkOSAuthenticationError(
        'Token validation failed',
        'TOKEN_VALIDATION_ERROR',
        401
      );
    }
  }

  /**
   * Create a password authentication session (for custom login forms)
   * @param email User email
   * @param password User password
   * @returns Authentication result
   */
  async authenticateWithPassword(
    email: string,
    password: string
  ): Promise<AuthenticationResult> {
    try {
      const result = await this.workos.userManagement.authenticateWithPassword({
        clientId: WORKOS_CONFIG.clientId,
        email,
        password,
      });

      if (!result.user) {
        throw new WorkOSAuthenticationError(
          'Authentication failed',
          'AUTHENTICATION_FAILED',
          401
        );
      }

      const transformedUser: WorkOSUser = {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName || undefined,
        lastName: result.user.lastName || undefined,
        profilePictureUrl: result.user.profilePictureUrl || undefined,
      };

      return {
        user: transformedUser,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      };
    } catch (error) {
      if (error instanceof WorkOSAuthenticationError) {
        throw error;
      }

      // Handle WorkOS API errors
      if (error && typeof error === 'object' && 'message' in error) {
        throw new WorkOSAuthenticationError(
          `Password authentication failed: ${error.message}`,
          'PASSWORD_AUTH_ERROR',
          401
        );
      }

      throw new WorkOSAuthenticationError(
        'Password authentication failed',
        'PASSWORD_AUTH_FAILED',
        401
      );
    }
  }

  /**
   * Generate Google OAuth authorization URL
   * @param state Optional state parameter for CSRF protection
   * @returns Authorization URL for Google OAuth
   */
  generateGoogleAuthorizationUrl(state?: string): string {
    try {
      const authorizationUrl = this.workos.userManagement.getAuthorizationUrl({
        clientId: WORKOS_CONFIG.clientId,
        redirectUri: WORKOS_CONFIG.redirectUri,
        provider: 'GoogleOAuth',
        state,
      });

      return authorizationUrl;
    } catch (error) {
      throw new WorkOSAuthenticationError(
        'Failed to generate Google authorization URL',
        'GOOGLE_AUTHORIZATION_URL_ERROR',
        500
      );
    }
  }

  /**
   * Create a new user with email and password
   * @param email User email address
   * @param password User password (plaintext, WorkOS will hash it)
   * @param firstName Optional first name
   * @param lastName Optional last name
   * @returns Created user information
   */
  async signUpWithPassword(
    email: string,
    password: string,
    firstName?: string,
    lastName?: string
  ): Promise<WorkOSUser> {
    try {
      const user = await this.workos.userManagement.createUser({
        email,
        password,
        firstName,
        lastName,
        emailVerified: true, // Skip email verification as requested
      });

      if (!user) {
        throw new WorkOSAuthenticationError(
          'Failed to create user',
          'USER_CREATION_FAILED',
          500
        );
      }

      return {
        id: user.id,
        email: user.email,
        firstName: user.firstName || undefined,
        lastName: user.lastName || undefined,
        profilePictureUrl: user.profilePictureUrl || undefined,
      };
    } catch (error) {
      if (error instanceof WorkOSAuthenticationError) {
        throw error;
      }

      // Handle WorkOS API errors
      if (error && typeof error === 'object' && 'message' in error) {
        throw new WorkOSAuthenticationError(
          `User creation failed: ${error.message}`,
          'USER_CREATION_ERROR',
          400
        );
      }

      throw new WorkOSAuthenticationError(
        'User creation failed',
        'SIGNUP_ERROR',
        500
      );
    }
  }
}

// Create singleton instance
export const workosAuthService = new WorkOSAuthService();

// Export the original WorkOS client for direct access if needed
export { workos };
export default workosAuthService;