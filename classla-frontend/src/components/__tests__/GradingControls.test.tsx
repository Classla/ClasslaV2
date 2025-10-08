import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GradingControls } from "../GradingControls";
import { Grader } from "../../types";

// Mock the toast hook
vi.mock("../../hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Mock the useEnsureGrader hook
vi.mock("../../hooks/useEnsureGrader", () => ({
  useEnsureGrader: (
    assignmentId: string,
    studentId: string,
    courseId: string,
    existingGrader: Grader | null
  ) => ({
    grader: existingGrader,
    isCreating: false,
    ensureGrader: vi.fn().mockResolvedValue(existingGrader),
    error: null,
  }),
}));

describe("GradingControls", () => {
  const mockGrader: Grader = {
    id: "grader-1",
    feedback: "Good work!",
    raw_assignment_score: 5,
    raw_rubric_score: 1,
    score_modifier: "0",
    submission_id: "sub-1",
  };

  const mockOnUpdate = vi.fn();
  const mockAssignmentId = "assign-1";
  const mockStudentId = "student-1";
  const mockCourseId = "course-1";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all input fields", () => {
    render(
      <GradingControls
        grader={mockGrader}
        assignmentId={mockAssignmentId}
        studentId={mockStudentId}
        courseId={mockCourseId}
        onUpdate={mockOnUpdate}
        autoSave={false}
      />
    );

    expect(screen.getByText("Grading Controls")).toBeInTheDocument();
    expect(screen.getByText("Autograded Score")).toBeInTheDocument();
    expect(screen.getByText("Raw Rubric Score")).toBeInTheDocument();
    expect(screen.getByLabelText("Score Modifier")).toBeInTheDocument();
    expect(screen.getByText("Final Grade")).toBeInTheDocument();
    expect(screen.getByLabelText("Feedback")).toBeInTheDocument();
    expect(screen.getByLabelText(/Reviewed/)).toBeInTheDocument();
  });

  it("displays read-only scores correctly", () => {
    render(
      <GradingControls
        grader={mockGrader}
        assignmentId={mockAssignmentId}
        studentId={mockStudentId}
        courseId={mockCourseId}
        onUpdate={mockOnUpdate}
        autoSave={false}
      />
    );

    // Check autograded score - find the div after the label
    const autogradedLabel = screen.getByText("Autograded Score");
    const autogradedScore = autogradedLabel.nextElementSibling;
    expect(autogradedScore?.textContent).toBe("5");

    // Check raw rubric score
    const rubricLabel = screen.getByText("Raw Rubric Score");
    const rubricScore = rubricLabel.nextElementSibling;
    expect(rubricScore?.textContent).toBe("1");
  });

  it("calculates final grade correctly", () => {
    render(
      <GradingControls
        grader={mockGrader}
        assignmentId={mockAssignmentId}
        studentId={mockStudentId}
        courseId={mockCourseId}
        onUpdate={mockOnUpdate}
        autoSave={false}
      />
    );

    // Base score: 5 + 1 = 6, modifier: 0, final: 6
    const finalGradeLabel = screen.getByText("Final Grade");
    const finalGrade = finalGradeLabel.nextElementSibling;
    expect(finalGrade?.textContent).toBe("6");
  });

  it("updates final grade when modifier changes", async () => {
    const user = userEvent.setup();
    render(
      <GradingControls
        grader={mockGrader}
        assignmentId={mockAssignmentId}
        studentId={mockStudentId}
        courseId={mockCourseId}
        onUpdate={mockOnUpdate}
        autoSave={false}
      />
    );

    const modifierInput = screen.getByLabelText("Score Modifier");
    await user.clear(modifierInput);
    await user.type(modifierInput, "2");

    // Base score: 5 + 1 = 6, modifier: 2, final: 8
    const finalGradeLabel = screen.getByText("Final Grade");
    const finalGrade = finalGradeLabel.nextElementSibling;
    expect(finalGrade?.textContent).toBe("8");
  });

  it("handles negative modifiers", async () => {
    const user = userEvent.setup();
    render(
      <GradingControls
        grader={mockGrader}
        assignmentId={mockAssignmentId}
        studentId={mockStudentId}
        courseId={mockCourseId}
        onUpdate={mockOnUpdate}
        autoSave={false}
      />
    );

    const modifierInput = screen.getByLabelText("Score Modifier");
    await user.clear(modifierInput);
    await user.type(modifierInput, "-1");

    // Base score: 5 + 1 = 6, modifier: -1, final: 5
    const finalGradeLabel = screen.getByText("Final Grade");
    const finalGrade = finalGradeLabel.nextElementSibling;
    expect(finalGrade?.textContent).toBe("5");
  });

  it("allows editing feedback", async () => {
    const user = userEvent.setup();
    render(
      <GradingControls
        grader={mockGrader}
        assignmentId={mockAssignmentId}
        studentId={mockStudentId}
        courseId={mockCourseId}
        onUpdate={mockOnUpdate}
        autoSave={false}
      />
    );

    const feedbackTextarea = screen.getByLabelText("Feedback");
    await user.clear(feedbackTextarea);
    await user.type(feedbackTextarea, "Excellent work!");

    expect(feedbackTextarea).toHaveValue("Excellent work!");
  });

  it("allows toggling reviewed checkbox", async () => {
    const user = userEvent.setup();
    render(
      <GradingControls
        grader={mockGrader}
        assignmentId={mockAssignmentId}
        studentId={mockStudentId}
        courseId={mockCourseId}
        onUpdate={mockOnUpdate}
        autoSave={false}
      />
    );

    const reviewedCheckbox = screen.getByRole("checkbox");
    expect(reviewedCheckbox).not.toBeChecked();

    await user.click(reviewedCheckbox);
    expect(reviewedCheckbox).toBeChecked();
  });

  it("handles null grader gracefully", () => {
    render(
      <GradingControls
        grader={null}
        assignmentId={mockAssignmentId}
        studentId={mockStudentId}
        courseId={mockCourseId}
        onUpdate={mockOnUpdate}
        autoSave={false}
      />
    );

    // Should display default values
    const autogradedLabel = screen.getByText("Autograded Score");
    const autogradedScore = autogradedLabel.nextElementSibling;
    expect(autogradedScore?.textContent).toBe("-");

    const modifierInput = screen.getByLabelText("Score Modifier");
    expect(modifierInput).toHaveValue("0");

    const feedbackTextarea = screen.getByLabelText("Feedback");
    expect(feedbackTextarea).toHaveValue("");
  });

  describe("Block Scores Display", () => {
    it("displays block scores section when block_scores exist", () => {
      const graderWithBlockScores: Grader = {
        ...mockGrader,
        block_scores: {
          "550e8400-e29b-41d4-a716-446655440000": {
            awarded: 5,
            possible: 5,
          },
          "6ba7b810-9dad-11d1-80b4-00c04fd430c8": {
            awarded: 0,
            possible: 3,
          },
          "7c9e6679-7425-40de-944b-e07fc1f90ae7": {
            awarded: 2,
            possible: 2,
          },
        },
      };

      render(
        <GradingControls
          grader={graderWithBlockScores}
          assignmentId={mockAssignmentId}
          studentId={mockStudentId}
          courseId={mockCourseId}
          onUpdate={mockOnUpdate}
          autoSave={false}
        />
      );

      expect(
        screen.getByText("Question Scores (Autograded)")
      ).toBeInTheDocument();
      expect(screen.getByText("Question 1")).toBeInTheDocument();
      expect(screen.getByText("Question 2")).toBeInTheDocument();
      expect(screen.getByText("Question 3")).toBeInTheDocument();
    });

    it("displays correct scores for each block", () => {
      const graderWithBlockScores: Grader = {
        ...mockGrader,
        raw_assignment_score: 7,
        block_scores: {
          "550e8400-e29b-41d4-a716-446655440000": {
            awarded: 5,
            possible: 5,
          },
          "6ba7b810-9dad-11d1-80b4-00c04fd430c8": {
            awarded: 0,
            possible: 3,
          },
          "7c9e6679-7425-40de-944b-e07fc1f90ae7": {
            awarded: 2,
            possible: 2,
          },
        },
      };

      render(
        <GradingControls
          grader={graderWithBlockScores}
          assignmentId={mockAssignmentId}
          studentId={mockStudentId}
          courseId={mockCourseId}
          onUpdate={mockOnUpdate}
          autoSave={false}
        />
      );

      expect(screen.getByText("5 / 5 pts")).toBeInTheDocument();
      expect(screen.getByText("0 / 3 pts")).toBeInTheDocument();
      expect(screen.getByText("2 / 2 pts")).toBeInTheDocument();
    });

    it("displays total raw assignment score in block scores section", () => {
      const graderWithBlockScores: Grader = {
        ...mockGrader,
        raw_assignment_score: 7,
        block_scores: {
          "550e8400-e29b-41d4-a716-446655440000": {
            awarded: 5,
            possible: 5,
          },
          "6ba7b810-9dad-11d1-80b4-00c04fd430c8": {
            awarded: 2,
            possible: 3,
          },
        },
      };

      render(
        <GradingControls
          grader={graderWithBlockScores}
          assignmentId={mockAssignmentId}
          studentId={mockStudentId}
          courseId={mockCourseId}
          onUpdate={mockOnUpdate}
          autoSave={false}
        />
      );

      expect(
        screen.getByText("Total Raw Assignment Score:")
      ).toBeInTheDocument();
      expect(screen.getByText("7 pts")).toBeInTheDocument();
    });

    it("displays shortened block IDs", () => {
      const graderWithBlockScores: Grader = {
        ...mockGrader,
        block_scores: {
          "550e8400-e29b-41d4-a716-446655440000": {
            awarded: 5,
            possible: 5,
          },
        },
      };

      render(
        <GradingControls
          grader={graderWithBlockScores}
          assignmentId={mockAssignmentId}
          studentId={mockStudentId}
          courseId={mockCourseId}
          onUpdate={mockOnUpdate}
          autoSave={false}
        />
      );

      expect(screen.getByText("(550e8400...)")).toBeInTheDocument();
    });

    it("does not display block scores section when block_scores is undefined", () => {
      render(
        <GradingControls
          grader={mockGrader}
          assignmentId={mockAssignmentId}
          studentId={mockStudentId}
          courseId={mockCourseId}
          onUpdate={mockOnUpdate}
          autoSave={false}
        />
      );

      expect(
        screen.queryByText("Question Scores (Autograded)")
      ).not.toBeInTheDocument();
    });

    it("does not display block scores section when block_scores is empty", () => {
      const graderWithEmptyBlockScores: Grader = {
        ...mockGrader,
        block_scores: {},
      };

      render(
        <GradingControls
          grader={graderWithEmptyBlockScores}
          assignmentId={mockAssignmentId}
          studentId={mockStudentId}
          courseId={mockCourseId}
          onUpdate={mockOnUpdate}
          autoSave={false}
        />
      );

      expect(
        screen.queryByText("Question Scores (Autograded)")
      ).not.toBeInTheDocument();
    });

    it("displays multiple block scores in order", () => {
      const graderWithBlockScores: Grader = {
        ...mockGrader,
        block_scores: {
          "block-1": { awarded: 1, possible: 1 },
          "block-2": { awarded: 2, possible: 2 },
          "block-3": { awarded: 3, possible: 3 },
          "block-4": { awarded: 4, possible: 4 },
        },
      };

      render(
        <GradingControls
          grader={graderWithBlockScores}
          assignmentId={mockAssignmentId}
          studentId={mockStudentId}
          courseId={mockCourseId}
          onUpdate={mockOnUpdate}
          autoSave={false}
        />
      );

      expect(screen.getByText("Question 1")).toBeInTheDocument();
      expect(screen.getByText("Question 2")).toBeInTheDocument();
      expect(screen.getByText("Question 3")).toBeInTheDocument();
      expect(screen.getByText("Question 4")).toBeInTheDocument();
      expect(screen.getByText("1 / 1 pts")).toBeInTheDocument();
      expect(screen.getByText("2 / 2 pts")).toBeInTheDocument();
      expect(screen.getByText("3 / 3 pts")).toBeInTheDocument();
      expect(screen.getByText("4 / 4 pts")).toBeInTheDocument();
    });
  });
});
