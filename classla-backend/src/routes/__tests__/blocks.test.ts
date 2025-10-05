import request from "supertest";
import app from "../../server";
import { supabase } from "../../middleware/auth";

// Mock Supabase
jest.mock("../../middleware/auth", () => ({
  supabase: {
    from: jest.fn(),
  },
  authenticateToken: (req: any, res: any, next: any) => {
    req.user = {
      id: "test-user-id",
      isAdmin: false,
    };
    next();
  },
}));

// Mock authorization middleware
jest.mock("../../middleware/authorization", () => ({
  getCoursePermissions: jest.fn().mockResolvedValue({
    canRead: true,
    canWrite: false,
    canGrade: false,
    canManage: false,
  }),
  getUserCourseRole: jest.fn().mockResolvedValue("student"),
}));

describe("Blocks API", () => {
  describe("POST /api/blocks/autograde/:assignmentId", () => {
    const mockAssignment = {
      id: "assignment-1",
      course_id: "course-1",
      content: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "mcqBlock",
            attrs: {
              mcqData: {
                id: "550e8400-e29b-41d4-a716-446655440000",
                question: "What is 2+2?",
                options: [
                  { id: "opt-1", text: "3", isCorrect: false },
                  { id: "opt-2", text: "4", isCorrect: true },
                  { id: "opt-3", text: "5", isCorrect: false },
                ],
                allowMultiple: false,
                points: 1,
                explanation: "Basic arithmetic",
              },
            },
          },
          {
            type: "mcqBlock",
            attrs: {
              mcqData: {
                id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
                question: "Select all prime numbers",
                options: [
                  { id: "opt-4", text: "2", isCorrect: true },
                  { id: "opt-5", text: "3", isCorrect: true },
                  { id: "opt-6", text: "4", isCorrect: false },
                  { id: "opt-7", text: "5", isCorrect: true },
                ],
                allowMultiple: true,
                points: 2,
                explanation:
                  "Prime numbers are divisible only by 1 and themselves",
              },
            },
          },
        ],
      }),
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should autograde correct single-choice answer", async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockAssignment,
              error: null,
            }),
          }),
        }),
      });

      const response = await request(app)
        .post("/api/blocks/autograde/assignment-1")
        .send({
          submissionValues: {
            "550e8400-e29b-41d4-a716-446655440000": ["opt-2"],
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0]).toMatchObject({
        blockId: "550e8400-e29b-41d4-a716-446655440000",
        isCorrect: true,
        pointsEarned: 1,
        pointsPossible: 1,
      });
      expect(response.body.totalPointsEarned).toBe(1);
      expect(response.body.totalPointsPossible).toBe(3);
    });

    it("should autograde incorrect single-choice answer", async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockAssignment,
              error: null,
            }),
          }),
        }),
      });

      const response = await request(app)
        .post("/api/blocks/autograde/assignment-1")
        .send({
          submissionValues: {
            "550e8400-e29b-41d4-a716-446655440000": ["opt-1"],
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.results[0]).toMatchObject({
        blockId: "550e8400-e29b-41d4-a716-446655440000",
        isCorrect: false,
        pointsEarned: 0,
        pointsPossible: 1,
      });
    });

    it("should autograde correct multiple-choice answer", async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockAssignment,
              error: null,
            }),
          }),
        }),
      });

      const response = await request(app)
        .post("/api/blocks/autograde/assignment-1")
        .send({
          submissionValues: {
            "6ba7b810-9dad-11d1-80b4-00c04fd430c8": ["opt-4", "opt-5", "opt-7"],
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.results[1]).toMatchObject({
        blockId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        isCorrect: true,
        pointsEarned: 2,
        pointsPossible: 2,
      });
    });

    it("should autograde partially correct multiple-choice answer", async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockAssignment,
              error: null,
            }),
          }),
        }),
      });

      const response = await request(app)
        .post("/api/blocks/autograde/assignment-1")
        .send({
          submissionValues: {
            "6ba7b810-9dad-11d1-80b4-00c04fd430c8": ["opt-4", "opt-5"], // Missing opt-7
          },
        });

      expect(response.status).toBe(200);
      expect(response.body.results[1]).toMatchObject({
        blockId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
        isCorrect: false,
        pointsEarned: 0,
        pointsPossible: 2,
      });
    });

    it("should handle unanswered blocks", async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockAssignment,
              error: null,
            }),
          }),
        }),
      });

      const response = await request(app)
        .post("/api/blocks/autograde/assignment-1")
        .send({
          submissionValues: {},
        });

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(2);
      expect(response.body.results[0]).toMatchObject({
        blockId: "550e8400-e29b-41d4-a716-446655440000",
        isCorrect: false,
        pointsEarned: 0,
        pointsPossible: 1,
        feedback: "Not answered",
      });
      expect(response.body.totalPointsEarned).toBe(0);
      expect(response.body.totalPointsPossible).toBe(3);
    });

    it("should return 404 for non-existent assignment", async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: null,
              error: { message: "Not found" },
            }),
          }),
        }),
      });

      const response = await request(app)
        .post("/api/blocks/autograde/non-existent")
        .send({
          submissionValues: {},
        });

      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe("ASSIGNMENT_NOT_FOUND");
    });

    it("should return 400 for invalid request body", async () => {
      const response = await request(app)
        .post("/api/blocks/autograde/assignment-1")
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("INVALID_REQUEST");
    });

    it("should handle assignment with no MCQ blocks", async () => {
      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: {
                ...mockAssignment,
                content: JSON.stringify({
                  type: "doc",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "No MCQ blocks here" }],
                    },
                  ],
                }),
              },
              error: null,
            }),
          }),
        }),
      });

      const response = await request(app)
        .post("/api/blocks/autograde/assignment-1")
        .send({
          submissionValues: {},
        });

      expect(response.status).toBe(200);
      expect(response.body.results).toHaveLength(0);
      expect(response.body.totalPointsEarned).toBe(0);
      expect(response.body.totalPointsPossible).toBe(0);
      expect(response.body.message).toBe(
        "No interactive blocks found in assignment"
      );
    });
  });

  describe("GET /api/blocks/extract/:assignmentId", () => {
    const mockAssignment = {
      id: "assignment-1",
      course_id: "course-1",
      content: JSON.stringify({
        type: "doc",
        content: [
          {
            type: "mcqBlock",
            attrs: {
              mcqData: {
                id: "550e8400-e29b-41d4-a716-446655440000",
                question: "What is 2+2?",
                options: [
                  { id: "opt-1", text: "3", isCorrect: false },
                  { id: "opt-2", text: "4", isCorrect: true },
                ],
                allowMultiple: false,
                points: 1,
              },
            },
          },
        ],
      }),
    };

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("should extract MCQ blocks for instructor", async () => {
      // Mock instructor permissions
      const {
        getCoursePermissions,
      } = require("../../middleware/authorization");
      (getCoursePermissions as jest.Mock).mockResolvedValueOnce({
        canRead: true,
        canWrite: true,
        canGrade: true,
        canManage: true,
      });

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockAssignment,
              error: null,
            }),
          }),
        }),
      });

      const response = await request(app).get(
        "/api/blocks/extract/assignment-1"
      );

      expect(response.status).toBe(200);
      expect(response.body.blocks).toHaveLength(1);
      expect(response.body.blocks[0]).toMatchObject({
        id: "550e8400-e29b-41d4-a716-446655440000",
        question: "What is 2+2?",
        options: expect.arrayContaining([
          expect.objectContaining({ text: "4", isCorrect: true }),
        ]),
      });
      expect(response.body.count).toBe(1);
    });

    it("should deny access for students", async () => {
      // Mock student permissions
      const {
        getCoursePermissions,
      } = require("../../middleware/authorization");
      (getCoursePermissions as jest.Mock).mockResolvedValueOnce({
        canRead: true,
        canWrite: false,
        canGrade: false,
        canManage: false,
      });

      (supabase.from as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            single: jest.fn().mockResolvedValue({
              data: mockAssignment,
              error: null,
            }),
          }),
        }),
      });

      const response = await request(app).get(
        "/api/blocks/extract/assignment-1"
      );

      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("INSUFFICIENT_PERMISSIONS");
    });
  });
});
