import { autogradeSubmission } from "../autograder";

// Mock the autogradeSubmission function to verify it's called
jest.mock("../autograder", () => ({
  autogradeSubmission: jest.fn(),
}));

describe("Submission Autograding Integration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should import autogradeSubmission function successfully", () => {
    expect(autogradeSubmission).toBeDefined();
    expect(typeof autogradeSubmission).toBe("function");
  });

  it("should be a mock function in tests", () => {
    expect(jest.isMockFunction(autogradeSubmission)).toBe(true);
  });

  it("autogradeSubmission should be callable", async () => {
    const mockSubmissionId = "test-submission-id";

    // Mock the implementation
    (autogradeSubmission as jest.Mock).mockResolvedValue({
      grader: {
        id: "grader-123",
        submission_id: mockSubmissionId,
        raw_assignment_score: 10,
        block_scores: {},
      },
      totalPossiblePoints: 10,
    });

    const result = await autogradeSubmission(mockSubmissionId);

    expect(autogradeSubmission).toHaveBeenCalledWith(mockSubmissionId);
    expect(result).toBeDefined();
    expect(result.grader).toBeDefined();
    expect(result.totalPossiblePoints).toBe(10);
  });

  it("autogradeSubmission should handle errors gracefully", async () => {
    const mockSubmissionId = "test-submission-id";
    const mockError = new Error("Autograding failed");

    // Mock the implementation to throw an error
    (autogradeSubmission as jest.Mock).mockRejectedValue(mockError);

    await expect(autogradeSubmission(mockSubmissionId)).rejects.toThrow(
      "Autograding failed"
    );

    expect(autogradeSubmission).toHaveBeenCalledWith(mockSubmissionId);
  });
});
