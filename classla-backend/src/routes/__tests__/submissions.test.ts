// Set up environment variables before any imports
const originalEnv = process.env;
process.env = {
  ...originalEnv,
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test_service_key",
};

// Mock services and middleware before importing
jest.mock("../../middleware/auth", () => ({
  supabase: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      neq: jest.fn().mockReturnThis(),
      in: jest.fn().mockReturnThis(),
      is: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
  },
  authenticateToken: jest.fn((req: any, res: any, next: any) => next()),
}));
jest.mock("../../middleware/authorization", () => ({
  getCoursePermissions: jest.fn(),
  getUserCourseRole: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

import request from "supertest";
import express from "express";
import submissionsRouter from "../submissions";
import { authenticateToken } from "../../middleware/auth";
import {
  getCoursePermissions,
  getUserCourseRole,
} from "../../middleware/authorization";
import {
  createTestApp,
  createMockAuthMiddleware,
  mockSupabase,
  clearAllMocks,
  MockUser,
} from "../../__tests__/helpers/auth-test-helper";
import { UserRole, SubmissionStatus } from "../../types/enums";

const mockAuthenticateToken = authenticateToken as jest.MockedFunction<
  typeof authenticateToken
>;
const mockGetCoursePermissions = getCoursePermissions as jest.MockedFunction<
  typeof getCoursePermissions
>;
const mockGetUserCourseRole = getUserCourseRole as jest.MockedFunction<
  typeof getUserCourseRole
>;

describe("Submissions Routes - Authorization Tests", () => {
  let app: express.Application;

  const mockSubmission = {
    id: "submission-123",
    assignment_id: "assignment-123",
    course_id: "course-123",
    student_id: "student-456",
    values: { answer1: "test answer" },
    status: SubmissionStatus.SUBMITTED,
    timestamp: new Date().toISOString(),
    grade: null,
    grader_id: null,
  };

  const mockStudentUser: MockUser = {
    id: "student-456",
    workosUserId: "workos_student_456",
    email: "student@example.com",
    roles: ["student"],
    isAdmin: false,
    firstName: "Test",
    lastName: "Student",
  };

  const mockOtherStudentUser: MockUser = {
    id: "other-student-789",
    workosUserId: "workos_student_789",
    email: "otherstudent@example.com",
    roles: ["student"],
    isAdmin: false,
    firstName: "Other",
    lastName: "Student",
  };

  const mockInstructorUser: MockUser = {
    id: "instructor-123",
    workosUserId: "workos_instructor_123",
    email: "instructor@example.com",
    roles: ["instructor"],
    isAdmin: false,
    firstName: "Test",
    lastName: "Instructor",
  };

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    app = createTestApp(submissionsRouter);
    clearAllMocks();

    // Set up default middleware mocks
    mockAuthenticateToken.mockImplementation(
      createMockAuthMiddleware(mockStudentUser)
    );
    mockGetCoursePermissions.mockResolvedValue({
      canRead: true,
      canWrite: false,
      canGrade: false,
      canManage: false,
    });
    mockGetUserCourseRole.mockResolvedValue(UserRole.STUDENT);
  });

  describe("GET /submission/:id - Authorization (Requirements 2.1, 2.2, 2.3)", () => {
    it("Requirement 2.1: should allow student to access their own submission", async () => {
      mockAuthenticateToken.mockImplementation(
        createMockAuthMiddleware(mockStudentUser)
      );
      mockGetUserCourseRole.mockResolvedValue(UserRole.STUDENT);

      const queryBuilder = mockSupabase.from();
      queryBuilder.single.mockResolvedValue({
        data: mockSubmission,
        error: null,
      });

      const response = await request(app)
        .get("/submission/submission-123")
        .expect(200);

      expect(response.body.id).toBe("submission-123");
      expect(response.body.student_id).toBe("student-456");
    });

    it("Requirement 2.1: should deny student access to another student submission", async () => {
      mockAuthenticateToken.mockImplementation(
        createMockAuthMiddleware(mockOtherStudentUser)
      );
      mockGetUserCourseRole.mockResolvedValue(UserRole.STUDENT);

      const queryBuilder = mockSupabase.from();
      queryBuilder.single.mockResolvedValue({
        data: mockSubmission,
        error: null,
      });

      const response = await request(app)
        .get("/submission/submission-123")
        .expect(403);

      expect(response.body.error.code).toBe("ACCESS_DENIED");
      expect(response.body.error.message).toContain(
        "Students can only access their own submissions"
      );
    });

    it("Requirement 2.2: should allow instructor to access any submission in their course", async () => {
      mockAuthenticateToken.mockImplementation(
        createMockAuthMiddleware(mockInstructorUser)
      );
      mockGetUserCourseRole.mockResolvedValue(UserRole.INSTRUCTOR);
      mockGetCoursePermissions.mockResolvedValue({
        canRead: true,
        canWrite: true,
        canGrade: true,
        canManage: true,
      });

      const queryBuilder = mockSupabase.from();
      queryBuilder.single.mockResolvedValue({
        data: mockSubmission,
        error: null,
      });

      const response = await request(app)
        .get("/submission/submission-123")
        .expect(200);

      expect(response.body.id).toBe("submission-123");
    });

    it("Requirement 2.3: should deny access to user not enrolled in course", async () => {
      const unenrolledUser: MockUser = {
        id: "unenrolled-999",
        workosUserId: "workos_unenrolled_999",
        email: "unenrolled@example.com",
        roles: ["student"],
        isAdmin: false,
        firstName: "Unenrolled",
        lastName: "User",
      };

      mockAuthenticateToken.mockImplementation(
        createMockAuthMiddleware(unenrolledUser)
      );
      mockGetUserCourseRole.mockResolvedValue(null);
      mockGetCoursePermissions.mockResolvedValue({
        canRead: false,
        canWrite: false,
        canGrade: false,
        canManage: false,
      });

      const queryBuilder = mockSupabase.from();
      queryBuilder.single.mockResolvedValue({
        data: mockSubmission,
        error: null,
      });

      const response = await request(app)
        .get("/submission/submission-123")
        .expect(403);

      expect(response.body.error.code).toBe("ACCESS_DENIED");
      expect(response.body.error.message).toContain(
        "Not enrolled in the course"
      );
    });
  });
});
