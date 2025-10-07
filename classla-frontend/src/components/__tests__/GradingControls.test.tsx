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
});
