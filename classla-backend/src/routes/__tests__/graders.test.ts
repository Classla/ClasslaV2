// Set up environment variables before any imports
const originalEnv = process.env;
process.env = {
  ...originalEnv,
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test_service_key",
};

// Mock services and middleware before importing
const mockFrom = jest.fn();
jest.mock("../../middleware/auth", () => ({
  supabase: {
    from: mockFrom,
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
import gradersRouter from "../graders";
import { authenticateToken } from "../../middleware/auth";
import { getCoursePermissions } from "../../middleware/authorization";

const mockAuthenticateToken = authenticateToken as jest.MockedFunction<
  typeof authenticateToken
>;
const mockGetCoursePermissions = getCoursePermissions as jest.MockedFunction<
  typeof getCoursePermissions
>;

interface MockUser {
  id: string;
  workosUserId: string;
  email: string;
  roles: string[];
  isAdmin: boolean;
  firstName?: string;
  lastName?: string;
}

const createMockAuthMiddleware = (user: MockUser) => {
  return jest.fn((req: any, res: any, next: any) => {
    req.user = user;
    next();
  });
};

describe("POST /grader/create-with-submission", () => {
  let app: express.Application;

  const mockInstructorUser: MockUser = {
    id: "instructor-123",
    workosUserId: "workos_instructor_123",
    email: "instructor@example.com",
    roles: ["instructor"],
    isAdmin: false,
    firstName: "Test",
    lastName: "Instructor",
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

  const mockAssignment = {
    id: "assignment-123",
    course_id: "course-123",
    name: "Test Assignment",
  };

  const mockSubmission = {
    id: "submission-123",
    assignment_id: "assignment-123",
    student_id: "student-456",
    course_id: "course-123",
    status: "not-started",
    values: {},
    timestamp: new Date().toISOString(),
  };

  const mockGrader = {
    id: "grader-123",
    submission_id: "submission-123",
    raw_assignment_score: 0,
    raw_rubric_score: 0,
    score_modifier: "",
    feedback: "",
    reviewed_at: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use("/api", gradersRouter);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("should create both submission and grader when neither exists", async () => {
    mockAuthenticateToken.mockImplementation(
      createMockAuthMiddleware(mockInstructorUser)
    );

    mockGetCoursePermissions.mockResolvedValue({
      canRead: true,
      canWrite: true,
      canGrade: true,
      canManage: true,
    });

    // Mock assignment lookup
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockAssignment,
        error: null,
      }),
    });

    // Mock enrollment check
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { user_id: "student-456" },
        error: null,
      }),
    });

    // Mock submission check - doesn't exist
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    // Mock submission creation
    mockFrom.mockReturnValueOnce({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockSubmission,
        error: null,
      }),
    });

    // Mock grader check - doesn't exist
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    // Mock grader creation
    mockFrom.mockReturnValueOnce({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockGrader,
        error: null,
      }),
    });

    const response = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId: "assignment-123",
        studentId: "student-456",
        courseId: "course-123",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      submission: mockSubmission,
      grader: mockGrader,
      created: {
        submission: true,
        grader: true,
      },
    });
  });

  it("should create only grader when submission exists", async () => {
    mockAuthenticateToken.mockImplementation(
      createMockAuthMiddleware(mockInstructorUser)
    );

    mockGetCoursePermissions.mockResolvedValue({
      canRead: true,
      canWrite: true,
      canGrade: true,
      canManage: true,
    });

    // Mock assignment lookup
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockAssignment,
        error: null,
      }),
    });

    // Mock enrollment check
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { user_id: "student-456" },
        error: null,
      }),
    });

    // Mock submission check - exists
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: mockSubmission,
        error: null,
      }),
    });

    // Mock grader check - doesn't exist
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: null,
        error: null,
      }),
    });

    // Mock grader creation
    mockFrom.mockReturnValueOnce({
      insert: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockGrader,
        error: null,
      }),
    });

    const response = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId: "assignment-123",
        studentId: "student-456",
        courseId: "course-123",
      });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      submission: mockSubmission,
      grader: mockGrader,
      created: {
        submission: false,
        grader: true,
      },
    });
  });

  it("should return existing records when both exist", async () => {
    mockAuthenticateToken.mockImplementation(
      createMockAuthMiddleware(mockInstructorUser)
    );

    mockGetCoursePermissions.mockResolvedValue({
      canRead: true,
      canWrite: true,
      canGrade: true,
      canManage: true,
    });

    // Mock assignment lookup
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockAssignment,
        error: null,
      }),
    });

    // Mock enrollment check
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { user_id: "student-456" },
        error: null,
      }),
    });

    // Mock submission check - exists
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: mockSubmission,
        error: null,
      }),
    });

    // Mock grader check - exists
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({
        data: mockGrader,
        error: null,
      }),
    });

    const response = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId: "assignment-123",
        studentId: "student-456",
        courseId: "course-123",
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      submission: mockSubmission,
      grader: mockGrader,
      created: {
        submission: false,
        grader: false,
      },
    });
  });

  it("should return 400 when required fields are missing", async () => {
    mockAuthenticateToken.mockImplementation(
      createMockAuthMiddleware(mockInstructorUser)
    );

    const response = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId: "assignment-123",
        // Missing studentId and courseId
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("MISSING_REQUIRED_FIELDS");
  });

  it("should return 404 when assignment not found", async () => {
    mockAuthenticateToken.mockImplementation(
      createMockAuthMiddleware(mockInstructorUser)
    );

    // Mock assignment lookup - not found
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "Not found" },
      }),
    });

    const response = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId: "assignment-123",
        studentId: "student-456",
        courseId: "course-123",
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ASSIGNMENT_NOT_FOUND");
  });

  it("should return 403 when user lacks grading permissions", async () => {
    mockAuthenticateToken.mockImplementation(
      createMockAuthMiddleware(mockStudentUser)
    );

    mockGetCoursePermissions.mockResolvedValue({
      canRead: true,
      canWrite: false,
      canGrade: false,
      canManage: false,
    });

    // Mock assignment lookup
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockAssignment,
        error: null,
      }),
    });

    const response = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId: "assignment-123",
        studentId: "student-456",
        courseId: "course-123",
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("INSUFFICIENT_PERMISSIONS");
  });

  it("should return 400 when student is not enrolled", async () => {
    mockAuthenticateToken.mockImplementation(
      createMockAuthMiddleware(mockInstructorUser)
    );

    mockGetCoursePermissions.mockResolvedValue({
      canRead: true,
      canWrite: true,
      canGrade: true,
      canManage: true,
    });

    // Mock assignment lookup
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockAssignment,
        error: null,
      }),
    });

    // Mock enrollment check - not enrolled
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: null,
        error: { message: "Not found" },
      }),
    });

    const response = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId: "assignment-123",
        studentId: "student-456",
        courseId: "course-123",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("STUDENT_NOT_ENROLLED");
  });

  it("should handle database errors gracefully", async () => {
    mockAuthenticateToken.mockImplementation(
      createMockAuthMiddleware(mockInstructorUser)
    );

    mockGetCoursePermissions.mockResolvedValue({
      canRead: true,
      canWrite: true,
      canGrade: true,
      canManage: true,
    });

    // Mock assignment lookup
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: mockAssignment,
        error: null,
      }),
    });

    // Mock enrollment check
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: { user_id: "student-456" },
        error: null,
      }),
    });

    // Mock submission check - database error
    mockFrom.mockReturnValueOnce({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest
        .fn()
        .mockRejectedValue(new Error("Database connection failed")),
    });

    const response = await request(app)
      .post("/api/grader/create-with-submission")
      .send({
        assignmentId: "assignment-123",
        studentId: "student-456",
        courseId: "course-123",
      });

    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe("INTERNAL_SERVER_ERROR");
  });
});
