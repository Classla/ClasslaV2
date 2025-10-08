import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import AssignmentViewer from "../AssignmentViewer";
import { Assignment } from "../../types";

// Mock the API client
jest.mock("../../lib/api", () => ({
  apiClient: {
    getSubmission: jest.fn(),
    updateSubmissionValues: jest.fn(),
    createOrUpdateSubmission: jest.fn(),
    submitSubmission: jest.fn(),
    autogradeSubmission: jest.fn(),
  },
}));

// Mock the toast hook
jest.mock("../../hooks/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

describe("AssignmentViewer - Locked Prop", () => {
  const mockAssignment: Assignment = {
    id: "test-assignment-1",
    name: "Test Assignment",
    course_id: "test-course-1",
    content: JSON.stringify({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Test assignment content" }],
        },
        {
          type: "mcq-block",
          attrs: {
            mcqData: {
              id: "mcq-1",
              question: "What is 2+2?",
              options: [
                { id: "opt-1", text: "3", isCorrect: false },
                { id: "opt-2", text: "4", isCorrect: true },
                { id: "opt-3", text: "5", isCorrect: false },
              ],
              allowMultiple: false,
              points: 1,
            },
          },
        },
      ],
    }),
    published_to: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    settings: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("should allow interaction when locked=false and status is in-progress", async () => {
    const onAnswerChange = jest.fn();

    render(
      <AssignmentViewer
        assignment={mockAssignment}
        submissionId="sub-1"
        submissionStatus="in-progress"
        isStudent={true}
        studentId="student-1"
        locked={false}
        onAnswerChange={onAnswerChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    });

    // Find and click an option
    const option = screen.getByText("4");
    fireEvent.click(option);

    // Should trigger answer change
    await waitFor(() => {
      expect(onAnswerChange).toHaveBeenCalled();
    });
  });

  it("should prevent interaction when locked=true", async () => {
    const onAnswerChange = jest.fn();

    render(
      <AssignmentViewer
        assignment={mockAssignment}
        submissionId="sub-1"
        submissionStatus="submitted"
        isStudent={true}
        studentId="student-1"
        locked={true}
        onAnswerChange={onAnswerChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    });

    // Find and click an option
    const option = screen.getByText("4");
    fireEvent.click(option);

    // Should NOT trigger answer change
    await waitFor(() => {
      expect(onAnswerChange).not.toHaveBeenCalled();
    });
  });

  it("should prevent interaction when status is submitted and allowResubmissions is false", async () => {
    const onAnswerChange = jest.fn();
    const assignmentWithSettings = {
      ...mockAssignment,
      settings: {
        allowResubmissions: false,
      },
    };

    render(
      <AssignmentViewer
        assignment={assignmentWithSettings}
        submissionId="sub-1"
        submissionStatus="submitted"
        isStudent={true}
        studentId="student-1"
        locked={false} // Not explicitly locked, but should be locked due to status
        onAnswerChange={onAnswerChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    });

    // Find and click an option
    const option = screen.getByText("4");
    fireEvent.click(option);

    // Should NOT trigger answer change
    await waitFor(() => {
      expect(onAnswerChange).not.toHaveBeenCalled();
    });
  });

  it("should allow interaction when status is submitted but allowResubmissions is true", async () => {
    const onAnswerChange = jest.fn();
    const assignmentWithSettings = {
      ...mockAssignment,
      settings: {
        allowResubmissions: true,
      },
    };

    render(
      <AssignmentViewer
        assignment={assignmentWithSettings}
        submissionId="sub-1"
        submissionStatus="submitted"
        isStudent={true}
        studentId="student-1"
        locked={false}
        onAnswerChange={onAnswerChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    });

    // Find and click an option
    const option = screen.getByText("4");
    fireEvent.click(option);

    // Should trigger answer change
    await waitFor(() => {
      expect(onAnswerChange).toHaveBeenCalled();
    });
  });
});
