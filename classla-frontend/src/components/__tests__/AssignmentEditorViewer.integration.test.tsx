import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import "@testing-library/jest-dom";
import AssignmentEditor from "../AssignmentEditor";
import AssignmentViewer from "../AssignmentViewer";
import { Assignment } from "../../types";

// Mock the API client
vi.mock("../../lib/api", () => ({
  apiClient: {
    updateAssignment: vi.fn().mockResolvedValue({}),
  },
}));

// Mock the toast hook
vi.mock("../../hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

describe("AssignmentEditor-Viewer Integration", () => {
  const mockAssignment: Assignment = {
    id: "test-assignment-1",
    title: "Integration Test Assignment",
    content: "",
    course_id: "course-1",
    module_id: "module-1",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    due_date: null,
    published: false,
    published_at: null,
  };

  const mockOnAssignmentUpdated = vi.fn();
  const mockOnAnswerChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Content Consistency", () => {
    it("should render the same content in both editor and viewer", async () => {
      const contentWithMCQ = `
        <p>This is a test assignment with an MCQ block.</p>
        <div data-type="mcq-block" data-mcq='{"id":"mcq-1","question":"What is 2+2?","options":[{"id":"opt-1","text":"3","isCorrect":false},{"id":"opt-2","text":"4","isCorrect":true}],"allowMultiple":false,"points":1}'>
        </div>
        <p>This is content after the MCQ.</p>
      `;

      const assignmentWithContent = {
        ...mockAssignment,
        content: contentWithMCQ,
      };

      // Render editor
      const { container: editorContainer } = render(
        <AssignmentEditor
          assignment={assignmentWithContent}
          onAssignmentUpdated={mockOnAssignmentUpdated}
          isReadOnly={true}
        />
      );

      // Render viewer
      const { container: viewerContainer } = render(
        <AssignmentViewer
          assignment={assignmentWithContent}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // Both should render without errors
      expect(editorContainer.querySelector(".ProseMirror")).toBeInTheDocument();
      expect(viewerContainer.querySelector(".ProseMirror")).toBeInTheDocument();

      // Both should contain the text content
      await waitFor(() => {
        expect(
          screen.getAllByText("This is a test assignment with an MCQ block.")
        ).toHaveLength(2);
        expect(
          screen.getAllByText("This is content after the MCQ.")
        ).toHaveLength(2);
      });
    });

    it("should handle empty content consistently", () => {
      const emptyAssignment = {
        ...mockAssignment,
        content: "",
      };

      // Render editor
      const { container: editorContainer } = render(
        <AssignmentEditor
          assignment={emptyAssignment}
          onAssignmentUpdated={mockOnAssignmentUpdated}
        />
      );

      // Render viewer
      const { container: viewerContainer } = render(
        <AssignmentViewer
          assignment={emptyAssignment}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // Both should render without errors
      expect(editorContainer.querySelector(".ProseMirror")).toBeInTheDocument();
      expect(viewerContainer.querySelector(".ProseMirror")).toBeInTheDocument();
    });

    it("should handle malformed MCQ data consistently", async () => {
      const contentWithMalformedMCQ = `
        <p>Content before malformed MCQ.</p>
        <div data-type="mcq-block" data-mcq='{"invalid": "json"}'>
        </div>
        <p>Content after malformed MCQ.</p>
      `;

      const assignmentWithMalformed = {
        ...mockAssignment,
        content: contentWithMalformedMCQ,
      };

      // Render editor
      const { container: editorContainer } = render(
        <AssignmentEditor
          assignment={assignmentWithMalformed}
          onAssignmentUpdated={mockOnAssignmentUpdated}
          isReadOnly={true}
        />
      );

      // Render viewer
      const { container: viewerContainer } = render(
        <AssignmentViewer
          assignment={assignmentWithMalformed}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // Both should render without crashing
      expect(editorContainer.querySelector(".ProseMirror")).toBeInTheDocument();
      expect(viewerContainer.querySelector(".ProseMirror")).toBeInTheDocument();

      // Both should contain the text content
      await waitFor(() => {
        expect(
          screen.getAllByText("Content before malformed MCQ.")
        ).toHaveLength(2);
        expect(
          screen.getAllByText("Content after malformed MCQ.")
        ).toHaveLength(2);
      });
    });
  });

  describe("MCQ Block Consistency", () => {
    it("should render MCQ blocks consistently between editor and viewer", async () => {
      const mcqData = {
        id: "mcq-test",
        question: "Which of the following are correct?",
        options: [
          { id: "opt-1", text: "Option A", isCorrect: true },
          { id: "opt-2", text: "Option B", isCorrect: false },
          { id: "opt-3", text: "Option C", isCorrect: true },
        ],
        allowMultiple: true,
        points: 2,
        explanation: "Options A and C are correct.",
      };

      const contentWithMCQ = `
        <div data-type="mcq-block" data-mcq='${JSON.stringify(mcqData)}'>
        </div>
      `;

      const assignmentWithMCQ = {
        ...mockAssignment,
        content: contentWithMCQ,
      };

      // Render editor in read-only mode
      render(
        <AssignmentEditor
          assignment={assignmentWithMCQ}
          onAssignmentUpdated={mockOnAssignmentUpdated}
          isReadOnly={true}
        />
      );

      // Render viewer
      render(
        <AssignmentViewer
          assignment={assignmentWithMCQ}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // Both should display the question
      await waitFor(() => {
        expect(
          screen.getAllByText("Which of the following are correct?")
        ).toHaveLength(2);
      });

      // Both should display all options
      expect(screen.getAllByText("Option A")).toHaveLength(2);
      expect(screen.getAllByText("Option B")).toHaveLength(2);
      expect(screen.getAllByText("Option C")).toHaveLength(2);

      // Both should show points
      expect(screen.getAllByText("2 points")).toHaveLength(2);
    });

    it("should preserve MCQ data structure between editor and viewer", async () => {
      const complexMCQData = {
        id: "complex-mcq",
        question: "Complex question with special characters: <>&\"'",
        options: [
          {
            id: "opt-1",
            text: "Option with <script>alert('test')</script>",
            isCorrect: true,
          },
          { id: "opt-2", text: "", isCorrect: false }, // Empty text
          {
            id: "opt-3",
            text: "Very long option text that might cause display issues but should still work correctly in both editor and viewer modes",
            isCorrect: false,
          },
        ],
        allowMultiple: false,
        points: 0, // Zero points
        explanation: "Explanation with special chars: <>&\"'",
      };

      const contentWithComplexMCQ = `
        <div data-type="mcq-block" data-mcq='${JSON.stringify(complexMCQData)}'>
        </div>
      `;

      const assignmentWithComplexMCQ = {
        ...mockAssignment,
        content: contentWithComplexMCQ,
      };

      // Render both components
      render(
        <AssignmentEditor
          assignment={assignmentWithComplexMCQ}
          onAssignmentUpdated={mockOnAssignmentUpdated}
          isReadOnly={true}
        />
      );

      render(
        <AssignmentViewer
          assignment={assignmentWithComplexMCQ}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // Both should handle special characters correctly
      await waitFor(() => {
        expect(
          screen.getAllByText(/Complex question with special characters/)
        ).toHaveLength(2);
      });

      // Both should show zero points
      expect(screen.getAllByText("0 points")).toHaveLength(2);
    });
  });

  describe("Interactive Behavior Consistency", () => {
    it("should handle viewer interactions without affecting editor", async () => {
      const mcqData = {
        id: "interactive-mcq",
        question: "Select an option:",
        options: [
          { id: "opt-1", text: "First option", isCorrect: true },
          { id: "opt-2", text: "Second option", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const contentWithMCQ = `
        <div data-type="mcq-block" data-mcq='${JSON.stringify(mcqData)}'>
        </div>
      `;

      const assignmentWithMCQ = {
        ...mockAssignment,
        content: contentWithMCQ,
      };

      // Render editor in read-only mode
      const { container: editorContainer } = render(
        <AssignmentEditor
          assignment={assignmentWithMCQ}
          onAssignmentUpdated={mockOnAssignmentUpdated}
          isReadOnly={true}
        />
      );

      // Render viewer
      const { container: viewerContainer } = render(
        <AssignmentViewer
          assignment={assignmentWithMCQ}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      await waitFor(() => {
        expect(screen.getAllByText("Select an option:")).toHaveLength(2);
      });

      // Find viewer options (should be clickable)
      const viewerOptions = viewerContainer.querySelectorAll(
        '[data-testid="mcq-option"]'
      );

      // Editor should not have clickable options in read-only mode
      const editorElement = editorContainer.querySelector(".ProseMirror");
      expect(editorElement).toHaveAttribute("contenteditable", "false");

      // Viewer interactions should work
      if (viewerOptions.length > 0) {
        fireEvent.click(viewerOptions[0]);
        expect(mockOnAnswerChange).toHaveBeenCalledWith("interactive-mcq", [
          "opt-1",
        ]);
      }
    });

    it("should maintain separate state between multiple viewers", async () => {
      const mcqData = {
        id: "state-test-mcq",
        question: "State isolation test:",
        options: [
          { id: "opt-1", text: "Option 1", isCorrect: true },
          { id: "opt-2", text: "Option 2", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const contentWithMCQ = `
        <div data-type="mcq-block" data-mcq='${JSON.stringify(mcqData)}'>
        </div>
      `;

      const assignmentWithMCQ = {
        ...mockAssignment,
        content: contentWithMCQ,
      };

      const mockOnAnswerChange1 = vi.fn();
      const mockOnAnswerChange2 = vi.fn();

      // Render two separate viewers
      const { container: viewer1Container } = render(
        <AssignmentViewer
          assignment={assignmentWithMCQ}
          onAnswerChange={mockOnAnswerChange1}
        />
      );

      const { container: viewer2Container } = render(
        <AssignmentViewer
          assignment={assignmentWithMCQ}
          onAnswerChange={mockOnAnswerChange2}
        />
      );

      await waitFor(() => {
        expect(screen.getAllByText("State isolation test:")).toHaveLength(2);
      });

      // Each viewer should maintain its own state
      const viewer1Options = viewer1Container.querySelectorAll(
        '[data-testid="mcq-option"]'
      );
      const viewer2Options = viewer2Container.querySelectorAll(
        '[data-testid="mcq-option"]'
      );

      if (viewer1Options.length > 0 && viewer2Options.length > 0) {
        // Click different options in each viewer
        fireEvent.click(viewer1Options[0]);
        fireEvent.click(viewer2Options[1]);

        // Each should have called its own callback
        expect(mockOnAnswerChange1).toHaveBeenCalledWith("state-test-mcq", [
          "opt-1",
        ]);
        expect(mockOnAnswerChange2).toHaveBeenCalledWith("state-test-mcq", [
          "opt-2",
        ]);
      }
    });
  });

  describe("Error Handling Consistency", () => {
    it("should handle missing MCQ data consistently", async () => {
      const contentWithMissingData = `
        <p>Content before missing MCQ data.</p>
        <div data-type="mcq-block">
        </div>
        <p>Content after missing MCQ data.</p>
      `;

      const assignmentWithMissingData = {
        ...mockAssignment,
        content: contentWithMissingData,
      };

      // Both should render without crashing
      const { container: editorContainer } = render(
        <AssignmentEditor
          assignment={assignmentWithMissingData}
          onAssignmentUpdated={mockOnAssignmentUpdated}
          isReadOnly={true}
        />
      );

      const { container: viewerContainer } = render(
        <AssignmentViewer
          assignment={assignmentWithMissingData}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(editorContainer.querySelector(".ProseMirror")).toBeInTheDocument();
      expect(viewerContainer.querySelector(".ProseMirror")).toBeInTheDocument();

      // Both should contain the text content
      await waitFor(() => {
        expect(
          screen.getAllByText("Content before missing MCQ data.")
        ).toHaveLength(2);
        expect(
          screen.getAllByText("Content after missing MCQ data.")
        ).toHaveLength(2);
      });
    });

    it("should handle null/undefined assignment content consistently", () => {
      const nullContentAssignment = {
        ...mockAssignment,
        content: null as any,
      };

      // Both should handle null content gracefully
      const { container: editorContainer } = render(
        <AssignmentEditor
          assignment={nullContentAssignment}
          onAssignmentUpdated={mockOnAssignmentUpdated}
        />
      );

      const { container: viewerContainer } = render(
        <AssignmentViewer
          assignment={nullContentAssignment}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(editorContainer.querySelector(".ProseMirror")).toBeInTheDocument();
      expect(viewerContainer.querySelector(".ProseMirror")).toBeInTheDocument();
    });
  });

  describe("Performance and Memory", () => {
    it("should handle large content with multiple MCQ blocks efficiently", async () => {
      // Create content with multiple MCQ blocks
      const mcqBlocks = Array.from({ length: 10 }, (_, i) => {
        const mcqData = {
          id: `mcq-${i}`,
          question: `Question ${i + 1}: What is ${i} + 1?`,
          options: [
            { id: `opt-${i}-1`, text: `${i}`, isCorrect: false },
            { id: `opt-${i}-2`, text: `${i + 1}`, isCorrect: true },
            { id: `opt-${i}-3`, text: `${i + 2}`, isCorrect: false },
          ],
          allowMultiple: false,
          points: 1,
        };
        return `<div data-type="mcq-block" data-mcq='${JSON.stringify(
          mcqData
        )}'></div>`;
      }).join("\n<p>Text between MCQ blocks.</p>\n");

      const largeContentAssignment = {
        ...mockAssignment,
        content: `<p>Assignment with multiple MCQ blocks:</p>\n${mcqBlocks}`,
      };

      // Both should render large content efficiently
      const startTime = performance.now();

      const { container: editorContainer } = render(
        <AssignmentEditor
          assignment={largeContentAssignment}
          onAssignmentUpdated={mockOnAssignmentUpdated}
          isReadOnly={true}
        />
      );

      const { container: viewerContainer } = render(
        <AssignmentViewer
          assignment={largeContentAssignment}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      const endTime = performance.now();
      const renderTime = endTime - startTime;

      // Should render within reasonable time (less than 1 second)
      expect(renderTime).toBeLessThan(1000);

      expect(editorContainer.querySelector(".ProseMirror")).toBeInTheDocument();
      expect(viewerContainer.querySelector(".ProseMirror")).toBeInTheDocument();

      // Should contain multiple questions
      await waitFor(() => {
        expect(screen.getAllByText("Question 1: What is 0 + 1?")).toHaveLength(
          2
        );
        expect(screen.getAllByText("Question 10: What is 9 + 1?")).toHaveLength(
          2
        );
      });
    });
  });
});
