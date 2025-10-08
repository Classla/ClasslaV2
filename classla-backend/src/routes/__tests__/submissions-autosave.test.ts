import request from "supertest";
import express from "express";
import submissionsRouter from "../submissions";
import { authenticateToken } from "../../middleware/auth";

// Mock the auth middleware
jest.mock("../../middleware/auth", () => ({
  authenticateToken: jest.fn((req, res, next) => {
    req.user = { id: "test-user-id", isAdmin: false };
    next();
  }),
  supabase: {
    from: jest.fn(),
  },
}));

// Mock authorization functions
jest.mock("../../middleware/authorization", () => ({
  getCoursePermissions: jest.fn().mockResolvedValue({
    canRead: true,
    canGrade: false,
    canManage: false,
  }),
  getUserCourseRole: jest.fn().mockResolvedValue("student"),
}));

describe("Submissions Auto-Save Status Bug", () => {
  let app: express.Application;
  let mockSupabase: any;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/api", submissionsRouter);

    // Setup mock supabase
    mockSupabase = {
      from: jest.fn().mockReturnThis(),
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      single: jest.fn(),
      update: jest.fn().mockReturnThis(),
    };

    // Mock the supabase import
    const authModule = require("../../middleware/auth");
    authModule.supabase = mockSupabase;
  });

  it("should NOT change status to submitted when updating submission values (auto-save)", async () => {
    // Mock existing submission with in-progress status
    const existingSubmission = {
      id: "submission-123",
      assignment_id: "assignment-456",
      course_id: "course-789",
      student_id: "test-user-id",
      values: { "mcq-1": ["option-1"] },
      status: "in-progress",
      timestamp: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Mock the database calls
    mockSupabase.single
      .mockResolvedValueOnce({
        data: existingSubmission,
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ...existingSubmission,
          values: { "mcq-1": ["option-2"] },
          timestamp: new Date(),
        },
        error: null,
      });

    // Make the update request (simulating auto-save)
    const response = await request(app)
      .put("/api/submission/submission-123")
      .send({
        values: { "mcq-1": ["option-2"] },
      })
      .expect(200);

    // Verify the update was called
    expect(mockSupabase.update).toHaveBeenCalled();

    // Get the update data that was passed
    const updateCall = mockSupabase.update.mock.calls[0][0];

    // CRITICAL: Status should NOT be set to 'submitted'
    expect(updateCall.status).toBeUndefined();

    // Only timestamp and values should be updated
    expect(updateCall.timestamp).toBeDefined();
    expect(updateCall.values).toBeUndefined(); // values is set separately
  });

  it("should only change status to submitted via the /submit endpoint", async () => {
    // This test verifies that the submit endpoint is the ONLY way to change status
    const existingSubmission = {
      id: "submission-123",
      assignment_id: "assignment-456",
      course_id: "course-789",
      student_id: "test-user-id",
      values: { "mcq-1": ["option-1"] },
      status: "in-progress",
      timestamp: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    };

    // Mock the database calls for submit endpoint
    mockSupabase.single
      .mockResolvedValueOnce({
        data: existingSubmission,
        error: null,
      })
      .mockResolvedValueOnce({
        data: { settings: { allowResubmissions: false } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          ...existingSubmission,
          status: "submitted",
          timestamp: new Date(),
        },
        error: null,
      });

    // Make the submit request
    const response = await request(app)
      .post("/api/submission/submission-123/submit")
      .expect(200);

    // Verify the update was called with status change
    expect(mockSupabase.update).toHaveBeenCalled();

    const updateCall = mockSupabase.update.mock.calls[0][0];

    // Status SHOULD be set to 'submitted' via this endpoint
    expect(updateCall.status).toBe("submitted");
  });
});
