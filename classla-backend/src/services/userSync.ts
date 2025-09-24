import { createClient } from '@supabase/supabase-js';
import { WorkOSUser } from './workos';
import { logger } from '../utils/logger';

// Initialize Supabase client with service role key for server-side operations
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing required Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export interface SupabaseUser {
  id: string;
  workos_user_id?: string; // Optional for backward compatibility
  name?: string; // Kept for backward compatibility
  email: string;
  first_name?: string;
  last_name?: string;
  roles: string[];
  is_admin: boolean;
  settings?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export class UserSynchronizationError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'UserSynchronizationError';
  }
}

/**
 * User Synchronization Service
 * Handles syncing WorkOS users with Supabase users table
 */
export class UserSynchronizationService {
  /**
   * Sync WorkOS user with Supabase users table
   * Creates new user if doesn't exist, updates if exists
   * Handles backward compatibility for existing users without WorkOS IDs
   * @param workosUser WorkOS user data
   * @returns Supabase user record
   */
  async syncUser(workosUser: WorkOSUser): Promise<SupabaseUser> {
    try {
      // First check if user already exists by WorkOS ID
      let existingUser = await this.getUserByWorkOSId(workosUser.id);

      if (existingUser) {
        // Update existing user with WorkOS ID
        return await this.updateUser(existingUser.id, workosUser);
      }

      // Check for existing user by email (backward compatibility)
      existingUser = await this.getUserByEmail(workosUser.email);

      if (existingUser) {
        // Update existing user to add WorkOS ID and sync profile data
        return await this.updateUserWithWorkOSId(existingUser.id, workosUser);
      }

      // Create new user
      return await this.createUser(workosUser);
    } catch (error) {
      logger.error('User synchronization failed', {
        workosUserId: workosUser.id,
        email: workosUser.email,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      if (error instanceof UserSynchronizationError) {
        throw error;
      }

      throw new UserSynchronizationError(
        'Failed to synchronize user',
        'SYNC_ERROR',
        500
      );
    }
  }

  /**
   * Get user by email (for backward compatibility)
   * @param email User email
   * @returns Supabase user record or null if not found
   */
  async getUserByEmail(email: string): Promise<SupabaseUser | null> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - user doesn't exist
          return null;
        }
        throw error;
      }

      return data as SupabaseUser;
    } catch (error) {
      logger.error('Failed to get user by email', {
        email,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new UserSynchronizationError(
        'Failed to retrieve user by email',
        'USER_RETRIEVAL_ERROR',
        500
      );
    }
  }

  /**
   * Get user by WorkOS user ID
   * @param workosUserId WorkOS user ID
   * @returns Supabase user record or null if not found
   */
  async getUserByWorkOSId(workosUserId: string): Promise<SupabaseUser | null> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('workos_user_id', workosUserId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - user doesn't exist
          return null;
        }
        throw error;
      }

      return data as SupabaseUser;
    } catch (error) {
      logger.error('Failed to get user by WorkOS ID', {
        workosUserId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new UserSynchronizationError(
        'Failed to retrieve user',
        'USER_RETRIEVAL_ERROR',
        500
      );
    }
  }

  /**
   * Create new user in Supabase
   * @param workosUser WorkOS user data
   * @returns Created Supabase user record
   */
  async createUser(workosUser: WorkOSUser): Promise<SupabaseUser> {
    try {
      const userData = {
        workos_user_id: workosUser.id,
        email: workosUser.email,
        first_name: workosUser.firstName || null,
        last_name: workosUser.lastName || null,
        roles: [], // No default roles - roles are course-specific
        is_admin: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('users')
        .insert(userData)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      logger.info('New user created', {
        userId: data.id,
        workosUserId: workosUser.id,
        email: workosUser.email
      });

      return data as SupabaseUser;
    } catch (error) {
      logger.error('Failed to create user', {
        workosUserId: workosUser.id,
        email: workosUser.email,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new UserSynchronizationError(
        'Failed to create user',
        'USER_CREATION_ERROR',
        500
      );
    }
  }

  /**
   * Update existing user with WorkOS ID (for backward compatibility)
   * @param userId Supabase user ID
   * @param workosUser WorkOS user data
   * @returns Updated Supabase user record
   */
  async updateUserWithWorkOSId(userId: string, workosUser: WorkOSUser): Promise<SupabaseUser> {
    try {
      const updateData = {
        workos_user_id: workosUser.id,
        email: workosUser.email,
        first_name: workosUser.firstName || null,
        last_name: workosUser.lastName || null,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      logger.info('User updated with WorkOS ID', {
        userId: data.id,
        workosUserId: workosUser.id,
        email: workosUser.email
      });

      return data as SupabaseUser;
    } catch (error) {
      logger.error('Failed to update user with WorkOS ID', {
        userId,
        workosUserId: workosUser.id,
        email: workosUser.email,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new UserSynchronizationError(
        'Failed to update user with WorkOS ID',
        'USER_WORKOS_UPDATE_ERROR',
        500
      );
    }
  }

  /**
   * Update existing user in Supabase
   * @param userId Supabase user ID
   * @param workosUser WorkOS user data
   * @returns Updated Supabase user record
   */
  async updateUser(userId: string, workosUser: WorkOSUser): Promise<SupabaseUser> {
    try {
      const updateData = {
        email: workosUser.email,
        first_name: workosUser.firstName || null,
        last_name: workosUser.lastName || null,
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      logger.info('User updated', {
        userId: data.id,
        workosUserId: workosUser.id,
        email: workosUser.email
      });

      return data as SupabaseUser;
    } catch (error) {
      logger.error('Failed to update user', {
        userId,
        workosUserId: workosUser.id,
        email: workosUser.email,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new UserSynchronizationError(
        'Failed to update user',
        'USER_UPDATE_ERROR',
        500
      );
    }
  }

  /**
   * Get user by Supabase user ID
   * @param userId Supabase user ID
   * @returns Supabase user record or null if not found
   */
  async getUserById(userId: string): Promise<SupabaseUser | null> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned - user doesn't exist
          return null;
        }
        throw error;
      }

      return data as SupabaseUser;
    } catch (error) {
      logger.error('Failed to get user by ID', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new UserSynchronizationError(
        'Failed to retrieve user',
        'USER_RETRIEVAL_ERROR',
        500
      );
    }
  }

  /**
   * Update user roles
   * @param userId Supabase user ID
   * @param roles Array of role strings
   * @returns Updated user record
   */
  async updateUserRoles(userId: string, roles: string[]): Promise<SupabaseUser> {
    try {
      const { data, error } = await supabase
        .from('users')
        .update({
          roles,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      logger.info('User roles updated', {
        userId: data.id,
        roles
      });

      return data as SupabaseUser;
    } catch (error) {
      logger.error('Failed to update user roles', {
        userId,
        roles,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new UserSynchronizationError(
        'Failed to update user roles',
        'ROLE_UPDATE_ERROR',
        500
      );
    }
  }

  /**
   * Update user admin status
   * @param userId Supabase user ID
   * @param isAdmin Admin status
   * @returns Updated user record
   */
  async updateUserAdminStatus(userId: string, isAdmin: boolean): Promise<SupabaseUser> {
    try {
      const { data, error } = await supabase
        .from('users')
        .update({
          is_admin: isAdmin,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      logger.info('User admin status updated', {
        userId: data.id,
        isAdmin
      });

      return data as SupabaseUser;
    } catch (error) {
      logger.error('Failed to update user admin status', {
        userId,
        isAdmin,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new UserSynchronizationError(
        'Failed to update admin status',
        'ADMIN_UPDATE_ERROR',
        500
      );
    }
  }

  /**
   * Delete user from Supabase
   * @param userId Supabase user ID
   */
  async deleteUser(userId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('users')
        .delete()
        .eq('id', userId);

      if (error) {
        throw error;
      }

      logger.info('User deleted', { userId });
    } catch (error) {
      logger.error('Failed to delete user', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      throw new UserSynchronizationError(
        'Failed to delete user',
        'USER_DELETION_ERROR',
        500
      );
    }
  }

  /**
   * Batch sync multiple users
   * @param workosUsers Array of WorkOS users
   * @returns Array of synced Supabase users
   */
  async batchSyncUsers(workosUsers: WorkOSUser[]): Promise<SupabaseUser[]> {
    const results: SupabaseUser[] = [];
    const errors: Array<{ user: WorkOSUser; error: Error }> = [];

    for (const workosUser of workosUsers) {
      try {
        const syncedUser = await this.syncUser(workosUser);
        results.push(syncedUser);
      } catch (error) {
        errors.push({
          user: workosUser,
          error: error instanceof Error ? error : new Error('Unknown error')
        });
      }
    }

    if (errors.length > 0) {
      logger.warn('Some users failed to sync in batch operation', {
        totalUsers: workosUsers.length,
        successCount: results.length,
        errorCount: errors.length,
        errors: errors.map(e => ({
          workosUserId: e.user.id,
          email: e.user.email,
          error: e.error.message
        }))
      });
    }

    return results;
  }
}

// Create singleton instance
export const userSynchronizationService = new UserSynchronizationService();

export default userSynchronizationService;