import { describe, it, expect, beforeEach, jest, afterEach } from '@jest/globals';

// Mock environment variables
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';

// Mock logger
jest.mock('../../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  }
}));

import { UserSynchronizationService, UserSynchronizationError } from '../userSync';
import { WorkOSUser } from '../workos';

// Mock the createClient function
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data: null, error: null }))
        }))
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn(() => Promise.resolve({ data: null, error: null }))
        }))
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn(() => Promise.resolve({ data: null, error: null }))
          }))
        }))
      })),
      delete: jest.fn(() => ({
        eq: jest.fn(() => Promise.resolve({ data: null, error: null }))
      }))
    }))
  }))
}));

describe('UserSynchronizationService', () => {
  let userSyncService: UserSynchronizationService;
  let mockWorkOSUser: WorkOSUser;

  beforeEach(() => {
    userSyncService = new UserSynchronizationService();
    mockWorkOSUser = {
      id: 'workos_user_123',
      email: 'test@example.com',
      firstName: 'John',
      lastName: 'Doe',
      profilePictureUrl: 'https://example.com/avatar.jpg'
    };

    // Reset all mocks
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('UserSynchronizationService', () => {
    it('should be instantiated correctly', () => {
      expect(userSyncService).toBeInstanceOf(UserSynchronizationService);
    });

    it('should have all required methods', () => {
      expect(typeof userSyncService.syncUser).toBe('function');
      expect(typeof userSyncService.getUserByWorkOSId).toBe('function');
      expect(typeof userSyncService.createUser).toBe('function');
      expect(typeof userSyncService.updateUser).toBe('function');
      expect(typeof userSyncService.updateUserRoles).toBe('function');
      expect(typeof userSyncService.updateUserAdminStatus).toBe('function');
      expect(typeof userSyncService.batchSyncUsers).toBe('function');
    });

    it('should export UserSynchronizationError', () => {
      expect(UserSynchronizationError).toBeDefined();
      const error = new UserSynchronizationError('test error');
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('UserSynchronizationError');
    });
  });
});