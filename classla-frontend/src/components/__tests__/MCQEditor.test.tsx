import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import MCQEditor from "../MCQEditor";
import { MCQBlockData } from "../extensions/MCQBlock";

import { vi } from "vitest";

// Mock TipTap React components and hooks
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
    { id: "opt-3", text: "5", isCorrect: false },
  ],
  allowMultiple: false,
  points: 1,
  explanation: "Basic arithmetic",
};

const mockNode = {
  attrs: {
    mcqData: mockMCQData,
  },
};

const mockUpdateAttributes = vi.fn();
const mockDeleteNode = vi.fn();

describe("MCQEditor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders MCQ editor with question and options", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    // Check for the presence of form elements
    expect(screen.getByText("Question")).toBeInTheDocument();
    expect(screen.getByText("Answer Options")).toBeInTheDocument();
    expect(screen.getByText("Add Option")).toBeInTheDocument();

    // Check that question textarea is rendered
    expect(screen.getByLabelText("Question text")).toBeInTheDocument();

    // Check that option inputs are rendered
    expect(screen.getByLabelText("Option 1 text")).toBeInTheDocument();
    expect(screen.getByLabelText("Option 2 text")).toBeInTheDocument();
    expect(screen.getByLabelText("Option 3 text")).toBeInTheDocument();
  });

  it("renders question and option inputs", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    // Check that the component structure is correct
    expect(screen.getByText("Question")).toBeInTheDocument();
    expect(screen.getByText("Answer Options")).toBeInTheDocument();

    // Check that form inputs are rendered (1 question textarea + 3 option inputs)
    expect(screen.getByLabelText("Question text")).toBeInTheDocument();
    expect(screen.getByLabelText("Option 1 text")).toBeInTheDocument();
    expect(screen.getByLabelText("Option 2 text")).toBeInTheDocument();
    expect(screen.getByLabelText("Option 3 text")).toBeInTheDocument();
  });

  it("adds new option when add button is clicked", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    const addButton = screen.getByText("Add Option");
    fireEvent.click(addButton);

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

  it("toggles correct answer when button is clicked", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    // Find the correct answer toggle for the first option (currently incorrect)
    const correctButtons = screen.getAllByTitle(
      /Mark as correct.*Ctrl\+Space|Correct answer.*Ctrl\+Space/
    );
    fireEvent.click(correctButtons[0]); // Click first option's toggle

    expect(mockUpdateAttributes).toHaveBeenCalledWith({
      mcqData: {
        ...mockMCQData,
        options: [
          { id: "opt-1", text: "3", isCorrect: true },
          { id: "opt-2", text: "4", isCorrect: false },
          { id: "opt-3", text: "5", isCorrect: false },
        ],
      },
    });
  });

  it("calls deleteNode when delete button is clicked", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    // Get the button that contains the trash icon (has red styling and is in the header)
    const deleteButtons = screen
      .getAllByRole("button")
      .filter(
        (button) =>
          button.className.includes("text-red-600") &&
          button.querySelector("svg.lucide-trash2")
      );
    fireEvent.click(deleteButtons[0]);

    expect(mockDeleteNode).toHaveBeenCalled();
  });

  it("displays correct answer count and points", () => {
    render(
      <MCQEditor
        node={mockNode}
        updateAttributes={mockUpdateAttributes}
        deleteNode={mockDeleteNode}
      />
    );

    expect(screen.getByText("1 correct answer")).toBeInTheDocument();
    expect(screen.getByText("1 points")).toBeInTheDocument();
  });
});
