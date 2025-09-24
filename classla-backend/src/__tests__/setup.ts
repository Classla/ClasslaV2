import { supabase } from '../middleware/auth';

// Mock Supabase for all tests
jest.mock('../middleware/auth', () => ({
  supabase: {
    auth: {
      getUser: jest.fn()
    },
    from: jest.fn(() => ({
      select: jest.fn(() => ({
        eq: jest.fn(() => ({
          single: jest.fn(),
          limit: jest.fn(() => ({
            single: jest.fn()
          }))
        })),
        in: jest.fn(() => ({
          eq: jest.fn(() => ({
            single: jest.fn()
          }))
        })),
        limit: jest.fn(() => ({
          single: jest.fn()
        }))
      })),
      insert: jest.fn(() => ({
        select: jest.fn(() => ({
          single: jest.fn()
        }))
      })),
      update: jest.fn(() => ({
        eq: jest.fn(() => ({
          select: jest.fn(() => ({
            single: jest.fn()
          }))
        }))
      })),
      delete: jest.fn(() => ({
        eq: jest.fn()
      }))
    }))
  }
}));

// Mock logger to prevent console output during tests
jest.mock('../utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}));

// Setup test environment
beforeEach(() => {
  jest.clearAllMocks();
});

// Prevent this file from being treated as a test suite
// This file is used for test setup only
describe('Setup', () => {
  it('should be configured correctly', () => {
    expect(true).toBe(true);
  });
});

// Helper function to create mock user
export const createMockUser = (overrides = {}) => ({
  id: 'test-user-123',
  email: 'test@example.com',
  roles: ['student'],
  isAdmin: false,
  ...overrides
});

// Helper function to create mock course
export const createMockCourse = (overrides = {}) => ({
  id: 'test-course-123',
  name: 'Test Course',
  slug: 'test-course',
  settings: {},
  thumbnail_url: null,
  summary_content: 'Test course description',
  created_by_id: 'test-user-123',
  created_at: new Date().toISOString(),
  deleted_at: null,
  ...overrides
});

// Helper function to create mock assignment
export const createMockAssignment = (overrides = {}) => ({
  id: 'test-assignment-123',
  name: 'Test Assignment',
  course_id: 'test-course-123',
  settings: {},
  content: 'Test assignment content',
  published_to: ['section-1'],
  due_dates_map: {},
  module_path: [],
  is_lockdown: false,
  lockdown_time_map: {},
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides
});

// Helper function to create mock submission
export const createMockSubmission = (overrides = {}) => ({
  id: 'test-submission-123',
  assignment_id: 'test-assignment-123',
  timestamp: new Date().toISOString(),
  values: {},
  course_id: 'test-course-123',
  student_id: 'test-user-123',
  grader_id: null,
  grade: null,
  status: 'in-progress',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides
});