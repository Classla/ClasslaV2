// Set up environment variables before any imports
const originalEnv = process.env;
process.env = {
  ...originalEnv,
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test_service_key",
};

// Mock services and middleware before importing
jest.mock("../../middleware/auth");
jest.mock("../../middleware/authorization");
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
import session from "express-session";
import usersRouter from "../users";
import { authenticateToken } from "../../middleware/auth";
import {
  requireOwnershipOrElevated,
  requireRoles,
  getUserCourseRole,
} from "../../middleware/authorization";
import {
  createTestApp,
  createMockAuthMiddleware,
  mockSupabase,
  defaultMockUser,
  mockInstructorUser,
  mockAdminUser,
  clearAllMocks,
} from "../../__tests__/helpers/auth-test-helper";
import { UserRole } from "../../types/enums";
import { it } from "node:test";
import { describe } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { describe } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { beforeEach } from "node:test";
import { describe } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { describe } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { it } from "node:test";
import { describe } from "node:test";
import { beforeEach } from "node:test";
import { describe } from "node:test";

const mockAuthenticateToken = authenticateToken as jest.MockedFunction<
  typeof authenticateToken
>;
const mockRequireOwnershipOrElevated =
  requireOwnershipOrElevated as jest.MockedFunction<
    typeof requireOwnershipOrElevated
  >;
const mockRequireRoles = requireRoles as jest.MockedFunction<
  typeof requireRoles
>;
const mockGetUserCourseRole = getUserCourseRole as jest.MockedFunction<
  typeof getUserCourseRole
>;

describe("Users Routes", () => {
  let app: express.Application;

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    app = createTestApp(usersRouter);
    clearAllMocks();

    // Set up default middleware mocks
    mockAuthenticateToken.mockImplementation(
      createMockAuthMiddleware(defaultMockUser)
    );
    mockRequireOwnershipOrElevated.mockImplementation(
      () => (req: any, res: any, next: any) => next()
    );
    mockRequireRoles.mockImplementation(
      () => (req: any, res: any, next: any) => next()
    );
  });

  describe("GET /user/:id", () => {
    const mockUserData = {
      id: "test-user-123",
      workos_user_id: "workos_test_123",
      email: "test@example.com",
      first_name: "Test",
      last_name: "User",
      roles: ["student"],
      is_admin: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    it("should return user data for authenticated user", async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: mockUserData,
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await request(app)
        .get("/user/test-user-123")
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        user: {
          id: mockUserData.id,
          workosUserId: mockUserData.workos_user_id,
          email: mockUserData.email,
          firstName: mockUserData.first_name,
          lastName: mockUserData.last_name,
          isAdmin: mockUserData.is_admin,
          createdAt: mockUserData.created_at,
          updatedAt: mockUserData.updated_at,
        },
      });

      expect(mockAuthenticateToken).toHaveBeenCalled();
      expect(mockRequireOwnershipOrElevated).toHaveBeenCalledWith("id");
    });

    it("should return 404 when user not found", async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: { code: "PGRST116" },
              }),
            }),
          }),
        }),
      });

      const response = await request(app)
        .get("/user/nonexistent-user")
        .expect(404);

      expect(response.body).toEqual({
        success: false,
        error: "User not found",
        code: "USER_NOT_FOUND",
      });
    });

    it("should handle database errors", async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: null,
                error: { message: "Database connection error" },
              }),
            }),
          }),
        }),
      });

      const response = await request(app)
        .get("/user/test-user-123")
        .expect(500);

      expect(response.body).toEqual({
        success: false,
        error: "Failed to retrieve user",
        code: "USER_RETRIEVAL_ERROR",
      });
    });

    it("should require authentication", async () => {
      // Mock authentication failure
      mockAuthenticateToken.mockImplementation(
        (req: any, res: any, next: any) => {
          res.status(401).json({
            success: false,
            error: "Authentication required",
            code: "AUTHENTICATION_REQUIRED",
          });
        }
      );

      const response = await request(app)
        .get("/user/test-user-123")
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe("AUTHENTICATION_REQUIRED");
    });
  });

  describe("GET /users/:userId/courses", () => {
    const mockCoursesData = [
      {
        id: "course-1",
        name: "Test Course 1",
        slug: "test-course-1",
        description: "A test course",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        role: "student",
      },
    ];

    it("should return user courses for authenticated user", async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockResolvedValue({
              data: mockCoursesData,
              error: null,
            }),
          }),
        }),
      });

      const response = await request(app)
        .get("/users/test-user-123/courses")
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        courses: mockCoursesData,
      });

      expect(mockAuthenticateToken).toHaveBeenCalled();
      expect(mockRequireOwnershipOrElevated).toHaveBeenCalledWith("userId");
    });

    it("should handle empty courses list", async () => {
      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      });

      const response = await request(app)
        .get("/users/test-user-123/courses")
        .expect(200);

      expect(response.body).toEqual({
        success: true,
        courses: [],
      });
    });
  });

  describe("POST /user/enroll", () => {
    const enrollmentRequest = {
      user_id: "student-123",
      course_id: "course-456",
      role: UserRole.STUDENT,
    };

    beforeEach(() => {
      // Mock instructor authentication for enrollment endpoint
      mockAuthenticateToken.mockImplementation(
        createMockAuthMiddleware(mockInstructorUser)
      );
    });

    it("should enroll user successfully", async () => {
      // Mock user lookup
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "users") {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                is: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: { id: "student-123", email: "student@example.com" },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "courses") {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                is: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: { id: "course-456", name: "Test Course" },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "course_enrollments") {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: null,
                    error: { code: "PGRST116" }, // Not found
                  }),
                }),
              }),
            }),
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnValue({
                single: jest.fn().mockResolvedValue({
                  data: {
                    id: "enrollment-123",
                    user_id: "student-123",
                    course_id: "course-456",
                    role: UserRole.STUDENT,
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        return mockSupabase.from(table);
      });

      const response = await request(app)
        .post("/user/enroll")
        .send(enrollmentRequest)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.enrollment).toBeDefined();
      expect(mockRequireRoles).toHaveBeenCalledWith([
        UserRole.INSTRUCTOR,
        UserRole.ADMIN,
      ]);
    });

    it("should prevent duplicate enrollment", async () => {
      // Mock existing enrollment
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === "course_enrollments") {
          return {
            select: jest.fn().mockReturnValue({
              eq: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  single: jest.fn().mockResolvedValue({
                    data: { id: "existing-enrollment" },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        return mockSupabase.from(table);
      });

      const response = await request(app)
        .post("/user/enroll")
        .send(enrollmentRequest)
        .expect(409);

      expect(response.body).toEqual({
        success: false,
        error: "User is already enrolled in this course",
        code: "DUPLICATE_ENROLLMENT",
      });
    });

    it("should require instructor or admin role", async () => {
      // Mock student authentication (should be rejected)
      mockAuthenticateToken.mockImplementation(
        createMockAuthMiddleware(defaultMockUser)
      );
      mockRequireRoles.mockImplementation(
        () => (req: any, res: any, next: any) => {
          res.status(403).json({
            success: false,
            error: "Insufficient permissions",
            code: "INSUFFICIENT_PERMISSIONS",
          });
        }
      );

      const response = await request(app)
        .post("/user/enroll")
        .send(enrollmentRequest)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe("INSUFFICIENT_PERMISSIONS");
    });
  });

  describe("PUT /user/:id", () => {
    const updateRequest = {
      first_name: "Updated",
      last_name: "Name",
      email: "updated@example.com",
    };

    it("should update user successfully", async () => {
      const updatedUser = {
        id: "test-user-123",
        workos_user_id: "workos_test_123",
        email: "updated@example.com",
        first_name: "Updated",
        last_name: "Name",
        roles: ["student"],
        is_admin: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      mockSupabase.from.mockReturnValue({
        update: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: updatedUser,
                error: null,
              }),
            }),
          }),
        }),
      });

      const response = await request(app)
        .put("/user/test-user-123")
        .send(updateRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user.firstName).toBe("Updated");
      expect(response.body.user.lastName).toBe("Name");
      expect(response.body.user.email).toBe("updated@example.com");
    });

    it("should validate required fields", async () => {
      const response = await request(app)
        .put("/user/test-user-123")
        .send({}) // Empty request
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("Authentication and Authorization Integration", () => {
    it("should properly chain authentication and authorization middleware", async () => {
      // Test that middleware is called in correct order
      const middlewareCallOrder: string[] = [];

      mockAuthenticateToken.mockImplementation(
        (req: any, res: any, next: any) => {
          middlewareCallOrder.push("authenticate");
          req.user = defaultMockUser;
          next();
        }
      );

      mockRequireOwnershipOrElevated.mockImplementation(
        () => (req: any, res: any, next: any) => {
          middlewareCallOrder.push("authorize");
          next();
        }
      );

      mockSupabase.from.mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            is: jest.fn().mockReturnValue({
              single: jest.fn().mockResolvedValue({
                data: {
                  id: "test-user-123",
                  email: "test@example.com",
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      await request(app).get("/user/test-user-123").expect(200);

      expect(middlewareCallOrder).toEqual(["authenticate", "authorize"]);
    });
  });
});
