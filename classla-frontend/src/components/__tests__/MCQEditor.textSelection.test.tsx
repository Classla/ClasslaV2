import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MCQEditor from "../MCQEditor";
import { MCQBlockData } from "../extensions/MCQBlock";
import { vi } from "vitest";

// Mock TipTap React components
vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="node-view-wrapper">{children}</div>
  ),
}));

const mockMCQData: MCQBlockData = {
  id: "test-mcq-1",
  question: "What is 2 + 2?",
  options: [
    { id: "opt-1", text: "3", isCorrect: false },
    { id: "opt-2", text: "4", isCorrect: true },
  ],
  allowMultiple: false,
  points: 1,
  explanation: "",
};

const mockNode = {
  attrs: {
    mcqData: mockMCQData,
  },
};

const mockUpdateAttributes = vi.fn();
const mockDeleteNode = vi.fn();

describe("MCQEditor Text Selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows text selection in question textarea", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    const questionTextarea = screen.getByLabelText(
      "Question text"
    ) as HTMLTextAreaElement;

    // Simulate typing in the textarea
    fireEvent.change(questionTextarea, {
      target: { value: "New question text" },
    });

    expect(mockUpdateAttributes).toHaveBeenCalledWith({
      mcqData: {
        ...mockMCQData,
        question: "<p>New question text</p>",
      },
    });
  });

  it("allows text selection in option inputs", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    const optionInput = screen.getByLabelText(
      "Option 1 text"
    ) as HTMLInputElement;

    // Simulate typing in the input
    fireEvent.change(optionInput, { target: { value: "New option text" } });

    expect(mockUpdateAttributes).toHaveBeenCalledWith({
      mcqData: {
        ...mockMCQData,
        options: [
          { id: "opt-1", text: "<p>New option text</p>", isCorrect: false },
          { id: "opt-2", text: "4", isCorrect: true },
        ],
      },
    });
  });

  it("handles focus events properly", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    const questionTextarea = screen.getByLabelText("Question text");
    const optionInput = screen.getByLabelText("Option 1 text");

    // Should be able to trigger focus events without errors
    expect(() => {
      fireEvent.focus(questionTextarea);
      fireEvent.focus(optionInput);
    }).not.toThrow();

    // Elements should be focusable (have tabIndex or be form elements)
    expect(questionTextarea.tagName).toBe("TEXTAREA");
    expect(optionInput.tagName).toBe("INPUT");
  });

  it("handles mouse events properly", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    const questionTextarea = screen.getByLabelText("Question text");

    // Should be able to click and interact with form elements
    fireEvent.mouseDown(questionTextarea);
    fireEvent.mouseUp(questionTextarea);
    fireEvent.click(questionTextarea);

    // These events should not cause any errors or prevent normal interaction
    expect(questionTextarea).toBeInTheDocument();
  });

  it("supports keyboard navigation", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    const questionTextarea = screen.getByLabelText("Question text");

    // Test keyboard shortcuts
    fireEvent.keyDown(questionTextarea, {
      key: "Enter",
      ctrlKey: true,
    });

    // Should add a new option
    expect(mockUpdateAttributes).toHaveBeenCalledWith({
      mcqData: {
        ...mockMCQData,
        options: [
          ...mockMCQData.options,
          expect.objectContaining({
            text: "",
            isCorrect: false,
          }),
        ],
      },
    });
  });
});
