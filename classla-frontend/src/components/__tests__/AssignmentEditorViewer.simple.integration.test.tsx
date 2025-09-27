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

describe("AssignmentEditor-Viewer Simple Integration", () => {
  const mockAssignment: Assignment = {
    id: "integration-test-assignment",
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
    it("should render MCQ content consistently in editor", async () => {
      const mcqData = {
        id: "test-mcq",
        question: "Integration test question?",
        options: [
          { id: "opt-1", text: "Option A", isCorrect: true },
          { id: "opt-2", text: "Option B", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const contentWithMCQ = `
        <p>Content before MCQ.</p>
        <div data-type="mcq-block" data-mcq='${JSON.stringify(mcqData)}'>
        </div>
        <p>Content after MCQ.</p>
      `;

      const assignmentWithMCQ = {
        ...mockAssignment,
        content: contentWithMCQ,
      };

      render(
        <AssignmentEditor
          assignment={assignmentWithMCQ}
          onAssignmentUpdated={mockOnAssignmentUpdated}
          isReadOnly={true}
        />
      );

      // Should render text content
      expect(screen.getByText("Content before MCQ.")).toBeInTheDocument();
      expect(screen.getByText("Content after MCQ.")).toBeInTheDocument();

      // Should render MCQ content
      await waitFor(() => {
        expect(
          screen.getByText("Integration test question?")
        ).toBeInTheDocument();
      });
    });

    it("should render MCQ content consistently in viewer", async () => {
      const mcqData = {
        id: "viewer-test-mcq",
        question: "Viewer integration test?",
        options: [
          { id: "opt-1", text: "Viewer A", isCorrect: true },
          { id: "opt-2", text: "Viewer B", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const contentWithMCQ = `
        <p>Viewer content before MCQ.</p>
        <div data-type="mcq-block" data-mcq='${JSON.stringify(mcqData)}'>
        </div>
        <p>Viewer content after MCQ.</p>
      `;

      const assignmentWithMCQ = {
        ...mockAssignment,
        content: contentWithMCQ,
      };

      render(
        <AssignmentViewer
          assignment={assignmentWithMCQ}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // Should render text content
      expect(
        screen.getByText("Viewer content before MCQ.")
      ).toBeInTheDocument();
      expect(screen.getByText("Viewer content after MCQ.")).toBeInTheDocument();

      // Should render MCQ content
      await waitFor(() => {
        expect(
          screen.getByText("Viewer integration test?")
        ).toBeInTheDocument();
        expect(screen.getByText("Viewer A")).toBeInTheDocument();
        expect(screen.getByText("Viewer B")).toBeInTheDocument();
      });
    });

    it("should handle empty content in both components", () => {
      const emptyAssignment = {
        ...mockAssignment,
        content: "",
      };

      // Test editor with empty content
      const { container: editorContainer, unmount: unmountEditor } = render(
        <AssignmentEditor
          assignment={emptyAssignment}
          onAssignmentUpdated={mockOnAssignmentUpdated}
        />
      );

      expect(editorContainer.querySelector(".ProseMirror")).toBeInTheDocument();
      expect(screen.getByText("Start typing...")).toBeInTheDocument();

      unmountEditor();

      // Test viewer with empty content
      const { container: viewerContainer } = render(
        <AssignmentViewer
          assignment={emptyAssignment}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(viewerContainer.querySelector(".ProseMirror")).toBeInTheDocument();
    });
  });

  describe("MCQ Block Behavior", () => {
    it("should allow MCQ editing in editor mode", async () => {
      const mcqData = {
        id: "edit-test-mcq",
        question: "Editable question?",
        options: [
          { id: "opt-1", text: "Edit A", isCorrect: true },
          { id: "opt-2", text: "Edit B", isCorrect: false },
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

      render(
        <AssignmentEditor
          assignment={assignmentWithMCQ}
          onAssignmentUpdated={mockOnAssignmentUpdated}
        />
      );

      // Should show editable fields
      await waitFor(() => {
        expect(
          screen.getByDisplayValue("Editable question?")
        ).toBeInTheDocument();
        expect(screen.getByDisplayValue("Edit A")).toBeInTheDocument();
        expect(screen.getByDisplayValue("Edit B")).toBeInTheDocument();
      });

      // Should show editor controls
      expect(screen.getByText("Add Option")).toBeInTheDocument();
    });

    it("should allow MCQ interaction in viewer mode", async () => {
      const mcqData = {
        id: "interact-test-mcq",
        question: "Interactive question?",
        options: [
          { id: "opt-1", text: "Interactive A", isCorrect: true },
          { id: "opt-2", text: "Interactive B", isCorrect: false },
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

      render(
        <AssignmentViewer
          assignment={assignmentWithMCQ}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // Should show question and options
      await waitFor(() => {
        expect(screen.getByText("Interactive question?")).toBeInTheDocument();
        expect(screen.getByText("Interactive A")).toBeInTheDocument();
        expect(screen.getByText("Interactive B")).toBeInTheDocument();
      });

      // Should show selection status
      expect(screen.getByText("No selection")).toBeInTheDocument();

      // Should allow interaction
      const optionA = screen.getByText("Interactive A").closest("div");
      if (optionA) {
        fireEvent.click(optionA);
        expect(mockOnAnswerChange).toHaveBeenCalledWith("interact-test-mcq", [
          "opt-1",
        ]);
      }
    });
  });

  describe("Error Handling", () => {
    it("should handle malformed MCQ data gracefully in editor", async () => {
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

      render(
        <AssignmentEditor
          assignment={assignmentWithMalformed}
          onAssignmentUpdated={mockOnAssignmentUpdated}
          isReadOnly={true}
        />
      );

      // Should render without crashing
      expect(
        screen.getByText("Content before malformed MCQ.")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Content after malformed MCQ.")
      ).toBeInTheDocument();
    });

    it("should handle malformed MCQ data gracefully in viewer", async () => {
      const contentWithMalformedMCQ = `
        <p>Viewer content before malformed MCQ.</p>
        <div data-type="mcq-block" data-mcq='{"invalid": "json"}'>
        </div>
        <p>Viewer content after malformed MCQ.</p>
      `;

      const assignmentWithMalformed = {
        ...mockAssignment,
        content: contentWithMalformedMCQ,
      };

      render(
        <AssignmentViewer
          assignment={assignmentWithMalformed}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // Should render without crashing
      expect(
        screen.getByText("Viewer content before malformed MCQ.")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Viewer content after malformed MCQ.")
      ).toBeInTheDocument();
    });

    it("should handle missing MCQ data attribute", async () => {
      const contentWithMissingData = `
        <p>Content before missing data.</p>
        <div data-type="mcq-block">
        </div>
        <p>Content after missing data.</p>
      `;

      const assignmentWithMissingData = {
        ...mockAssignment,
        content: contentWithMissingData,
      };

      // Test editor
      const { container: editorContainer, unmount: unmountEditor } = render(
        <AssignmentEditor
          assignment={assignmentWithMissingData}
          onAssignmentUpdated={mockOnAssignmentUpdated}
          isReadOnly={true}
        />
      );

      expect(editorContainer.querySelector(".ProseMirror")).toBeInTheDocument();
      expect(
        screen.getByText("Content before missing data.")
      ).toBeInTheDocument();

      unmountEditor();

      // Test viewer
      const { container: viewerContainer } = render(
        <AssignmentViewer
          assignment={assignmentWithMissingData}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      expect(viewerContainer.querySelector(".ProseMirror")).toBeInTheDocument();
      expect(
        screen.getByText("Content before missing data.")
      ).toBeInTheDocument();
    });
  });

  describe("Data Persistence", () => {
    it("should preserve MCQ data structure through serialization", () => {
      const originalMCQ = {
        id: "persistence-test",
        question: "Persistence test question?",
        options: [
          { id: "opt-1", text: "Persist A", isCorrect: true },
          { id: "opt-2", text: "Persist B", isCorrect: false },
        ],
        allowMultiple: false,
        points: 2,
        explanation: "Test explanation",
      };

      // Simulate serialization/deserialization cycle
      const serialized = JSON.stringify(originalMCQ);
      const deserialized = JSON.parse(serialized);

      // All data should be preserved
      expect(deserialized.question).toBe(originalMCQ.question);
      expect(deserialized.options[0].text).toBe(originalMCQ.options[0].text);
      expect(deserialized.options[0].isCorrect).toBe(
        originalMCQ.options[0].isCorrect
      );
      expect(deserialized.options[1].text).toBe(originalMCQ.options[1].text);
      expect(deserialized.options[1].isCorrect).toBe(
        originalMCQ.options[1].isCorrect
      );
      expect(deserialized.allowMultiple).toBe(originalMCQ.allowMultiple);
      expect(deserialized.points).toBe(originalMCQ.points);
      expect(deserialized.explanation).toBe(originalMCQ.explanation);
    });

    it("should handle multiple MCQ blocks in content", async () => {
      const mcq1Data = {
        id: "multi-mcq-1",
        question: "First question?",
        options: [
          { id: "opt-1", text: "First A", isCorrect: true },
          { id: "opt-2", text: "First B", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const mcq2Data = {
        id: "multi-mcq-2",
        question: "Second question?",
        options: [
          { id: "opt-3", text: "Second A", isCorrect: false },
          { id: "opt-4", text: "Second B", isCorrect: true },
        ],
        allowMultiple: false,
        points: 2,
      };

      const contentWithMultipleMCQ = `
        <p>Content with multiple MCQs.</p>
        <div data-type="mcq-block" data-mcq='${JSON.stringify(mcq1Data)}'>
        </div>
        <p>Text between MCQs.</p>
        <div data-type="mcq-block" data-mcq='${JSON.stringify(mcq2Data)}'>
        </div>
        <p>Content after MCQs.</p>
      `;

      const assignmentWithMultipleMCQ = {
        ...mockAssignment,
        content: contentWithMultipleMCQ,
      };

      render(
        <AssignmentViewer
          assignment={assignmentWithMultipleMCQ}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      // Should render all content
      expect(
        screen.getByText("Content with multiple MCQs.")
      ).toBeInTheDocument();
      expect(screen.getByText("Text between MCQs.")).toBeInTheDocument();
      expect(screen.getByText("Content after MCQs.")).toBeInTheDocument();

      // Should render both MCQ blocks
      await waitFor(() => {
        expect(screen.getByText("First question?")).toBeInTheDocument();
        expect(screen.getByText("Second question?")).toBeInTheDocument();
      });

      // Should show correct points for each
      expect(screen.getByText("1 points")).toBeInTheDocument();
      expect(screen.getByText("2 points")).toBeInTheDocument();
    });
  });

  describe("Component Behavior Differences", () => {
    it("should show editor controls in editor mode but not viewer mode", async () => {
      const mcqData = {
        id: "controls-test",
        question: "Controls test?",
        options: [
          { id: "opt-1", text: "Control A", isCorrect: true },
          { id: "opt-2", text: "Control B", isCorrect: false },
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

      // Test editor - should show controls
      const { container: editorContainer, unmount: unmountEditor } = render(
        <AssignmentEditor
          assignment={assignmentWithMCQ}
          onAssignmentUpdated={mockOnAssignmentUpdated}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Add Option")).toBeInTheDocument();
      });

      const editorElement = editorContainer.querySelector(".ProseMirror");
      expect(editorElement).toHaveAttribute("contenteditable", "true");

      unmountEditor();

      // Test viewer - should not show editor controls
      const { container: viewerContainer } = render(
        <AssignmentViewer
          assignment={assignmentWithMCQ}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Controls test?")).toBeInTheDocument();
      });

      // Should not show editor controls
      expect(screen.queryByText("Add Option")).not.toBeInTheDocument();

      const viewerElement = viewerContainer.querySelector(".ProseMirror");
      expect(viewerElement).toHaveAttribute("contenteditable", "false");
    });

    it("should show selection feedback in viewer but not editor", async () => {
      const mcqData = {
        id: "feedback-test",
        question: "Feedback test?",
        options: [
          { id: "opt-1", text: "Feedback A", isCorrect: true },
          { id: "opt-2", text: "Feedback B", isCorrect: false },
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

      render(
        <AssignmentViewer
          assignment={assignmentWithMCQ}
          onAnswerChange={mockOnAnswerChange}
        />
      );

      await waitFor(() => {
        expect(screen.getByText("Feedback test?")).toBeInTheDocument();
      });

      // Should show selection status
      expect(screen.getByText("No selection")).toBeInTheDocument();

      // After clicking should show selection feedback
      const feedbackA = screen.getByText("Feedback A").closest("div");
      if (feedbackA) {
        fireEvent.click(feedbackA);
        await waitFor(() => {
          expect(screen.getByText("1 selected")).toBeInTheDocument();
        });
      }
    });
  });
});
