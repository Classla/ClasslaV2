import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import "@testing-library/jest-dom";
import MCQViewer from "../MCQViewer";
import { MCQBlockData } from "../extensions/MCQBlock";

// Mock the NodeViewWrapper
vi.mock("@tiptap/react", () => ({
  NodeViewWrapper: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="node-view-wrapper">{children}</div>
  ),
}));

describe("MCQViewer", () => {
  const mockOnAnswerChange = vi.fn();
  const mockEditor = {
    storage: {},
  };

  const sampleMCQData: MCQBlockData = {
    id: "mcq-1",
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
      mcqData: sampleMCQData,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders MCQ viewer with question and options", () => {
    render(
      <MCQViewer
        node={mockNode}
        editor={mockEditor}
        onAnswerChange={mockOnAnswerChange}
      />
    );

    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("1 points")).toBeInTheDocument();
  });

  it("handles single choice selection", () => {
    render(
      <MCQViewer
        node={mockNode}
        editor={mockEditor}
        onAnswerChange={mockOnAnswerChange}
      />
    );

    const option2 = screen.getByText("4").closest("div");
    fireEvent.click(option2!);

    expect(mockOnAnswerChange).toHaveBeenCalledWith("mcq-1", ["opt-2"]);
  });

  it("handles multiple choice selection", () => {
    const multipleChoiceData = {
      ...sampleMCQData,
      allowMultiple: true,
    };
    const multipleChoiceNode = {
      attrs: {
        mcqData: multipleChoiceData,
      },
    };

    render(
      <MCQViewer
        node={multipleChoiceNode}
        editor={mockEditor}
        onAnswerChange={mockOnAnswerChange}
      />
    );

    expect(screen.getByText("Multiple answers allowed")).toBeInTheDocument();

    const option1 = screen.getByText("3").closest("div");
    const option2 = screen.getByText("4").closest("div");

    fireEvent.click(option1!);
    expect(mockOnAnswerChange).toHaveBeenCalledWith("mcq-1", ["opt-1"]);

    fireEvent.click(option2!);
    expect(mockOnAnswerChange).toHaveBeenCalledWith("mcq-1", [
      "opt-1",
      "opt-2",
    ]);
  });

  it("shows selection count in footer", () => {
    render(
      <MCQViewer
        node={mockNode}
        editor={mockEditor}
        onAnswerChange={mockOnAnswerChange}
      />
    );

    expect(screen.getByText("No selection")).toBeInTheDocument();

    const option2 = screen.getByText("4").closest("div");
    fireEvent.click(option2!);

    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("uses callback from editor storage when available", () => {
    const storageCallback = vi.fn();
    const editorWithStorage = {
      storage: {
        mcqAnswerCallback: storageCallback,
      },
    };

    render(
      <MCQViewer
        node={mockNode}
        editor={editorWithStorage}
        onAnswerChange={mockOnAnswerChange}
      />
    );

    const option2 = screen.getByText("4").closest("div");
    fireEvent.click(option2!);

    expect(storageCallback).toHaveBeenCalledWith("mcq-1", ["opt-2"]);
    expect(mockOnAnswerChange).not.toHaveBeenCalled();
  });

  it("loads initial state from editor storage", () => {
    const getBlockAnswerState = vi.fn().mockReturnValue({
      selectedOptions: ["opt-2"],
      timestamp: new Date(),
    });

    const editorWithState = {
      storage: {
        getBlockAnswerState,
      },
    };

    render(
      <MCQViewer
        node={mockNode}
        editor={editorWithState}
        onAnswerChange={mockOnAnswerChange}
      />
    );

    expect(getBlockAnswerState).toHaveBeenCalledWith("mcq-1");
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByText("Answered")).toBeInTheDocument();
  });

  it("shows visual feedback when answer changes", () => {
    render(
      <MCQViewer
        node={mockNode}
        editor={mockEditor}
        onAnswerChange={mockOnAnswerChange}
      />
    );

    const option2 = screen.getByText("4").closest("div");
    fireEvent.click(option2!);

    // Check for visual feedback elements
    expect(screen.getByText("Answered")).toBeInTheDocument();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("handles empty answer state gracefully", () => {
    const getBlockAnswerState = vi.fn().mockReturnValue({
      selectedOptions: [],
      timestamp: new Date(),
    });

    const editorWithEmptyState = {
      storage: {
        getBlockAnswerState,
      },
    };

    render(
      <MCQViewer
        node={mockNode}
        editor={editorWithEmptyState}
        onAnswerChange={mockOnAnswerChange}
      />
    );

    expect(screen.getByText("No selection")).toBeInTheDocument();
    expect(screen.queryByText("Answered")).not.toBeInTheDocument();
  });
});
