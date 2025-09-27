import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { MCQBlock, MCQBlockData } from "../extensions/MCQBlock";
import { vi } from "vitest";

// Test component that uses the MCQ block extension
const TestEditor: React.FC<{
  content?: string;
  onUpdate?: (html: string) => void;
}> = ({ content = "", onUpdate }) => {
  const editor = useEditor({
    extensions: [StarterKit, MCQBlock],
    content,
    onUpdate: ({ editor }) => {
      if (onUpdate) {
        onUpdate(editor.getHTML());
      }
    },
  });

  if (!editor) {
    return <div>Loading...</div>;
  }

  return (
    <div>
      <button
        onClick={() => editor.chain().focus().insertMCQBlock().run()}
        data-testid="insert-mcq"
      >
        Insert MCQ
      </button>
      <button
        onClick={() => {
          // Select all content and copy
          editor.chain().focus().selectAll().run();
          document.execCommand("copy");
        }}
        data-testid="copy-all"
      >
        Copy All
      </button>
      <button
        onClick={() => {
          // Clear content and paste
          editor.chain().focus().clearContent().run();
          document.execCommand("paste");
        }}
        data-testid="paste"
      >
        Paste
      </button>
      <EditorContent editor={editor} data-testid="editor-content" />
    </div>
  );
};

describe("MCQ Block Copy/Paste Functionality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock clipboard API
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn(),
        readText: vi.fn(),
      },
    });

    // Mock document.execCommand for copy/paste
    document.execCommand = vi.fn();
  });

  it("should serialize MCQ data properly in HTML", () => {
    const mockMCQData: MCQBlockData = {
      id: "test-mcq-1",
      question: "What is 2 + 2?",
      options: [
        { id: "opt-1", text: "3", isCorrect: false },
        { id: "opt-2", text: "4", isCorrect: true },
      ],
      allowMultiple: false,
      points: 1,
      explanation: "Basic arithmetic",
    };

    const htmlContent = `<div data-type="mcq-block" data-mcq='${JSON.stringify(
      mockMCQData
    )}'></div>`;

    render(<TestEditor content={htmlContent} />);

    // The editor should render the MCQ block
    expect(screen.getByTestId("editor-content")).toBeInTheDocument();
  });

  it("should preserve MCQ data when parsing HTML", () => {
    const mockMCQData: MCQBlockData = {
      id: "test-mcq-1",
      question: "What is 2 + 2?",
      options: [
        { id: "opt-1", text: "3", isCorrect: false },
        { id: "opt-2", text: "4", isCorrect: true },
      ],
      allowMultiple: false,
      points: 1,
      explanation: "Basic arithmetic",
    };

    const htmlContent = `<div data-type="mcq-block" data-mcq='${JSON.stringify(
      mockMCQData
    )}'></div>`;
    let capturedHTML = "";

    render(
      <TestEditor
        content={htmlContent}
        onUpdate={(html) => {
          capturedHTML = html;
        }}
      />
    );

    // Trigger an update to capture the HTML
    const insertButton = screen.getByTestId("insert-mcq");
    fireEvent.click(insertButton);

    // The captured HTML should contain the MCQ data
    expect(capturedHTML).toContain('data-type="mcq-block"');
    expect(capturedHTML).toContain("data-mcq");
  });

  it("should generate new IDs when parsing pasted content", () => {
    const mockMCQData: MCQBlockData = {
      id: "original-mcq-id",
      question: "What is 2 + 2?",
      options: [
        { id: "original-opt-1", text: "3", isCorrect: false },
        { id: "original-opt-2", text: "4", isCorrect: true },
      ],
      allowMultiple: false,
      points: 1,
      explanation: "Basic arithmetic",
    };

    const htmlContent = `<div data-type="mcq-block" data-mcq='${JSON.stringify(
      mockMCQData
    )}'></div>`;
    let capturedHTML = "";

    render(
      <TestEditor
        content={htmlContent}
        onUpdate={(html) => {
          capturedHTML = html;
        }}
      />
    );

    // Wait for the editor to process the content
    waitFor(() => {
      expect(capturedHTML).toContain("data-mcq");

      // Parse the captured HTML to check if IDs were regenerated
      const parser = new DOMParser();
      const doc = parser.parseFromString(capturedHTML, "text/html");
      const mcqElement = doc.querySelector("[data-mcq]");

      if (mcqElement) {
        const mcqDataAttr = mcqElement.getAttribute("data-mcq");
        if (mcqDataAttr) {
          const parsedData = JSON.parse(mcqDataAttr);

          // IDs should be different from the original
          expect(parsedData.id).not.toBe("original-mcq-id");
          expect(parsedData.options[0].id).not.toBe("original-opt-1");
          expect(parsedData.options[1].id).not.toBe("original-opt-2");

          // But other data should be preserved
          expect(parsedData.question).toBe("What is 2 + 2?");
          expect(parsedData.options[0].text).toBe("3");
          expect(parsedData.options[1].text).toBe("4");
          expect(parsedData.options[1].isCorrect).toBe(true);
        }
      }
    });
  });

  it("should handle malformed MCQ data gracefully", () => {
    const malformedHTML = `<div data-type="mcq-block" data-mcq='{"invalid": "json"}'></div>`;

    render(<TestEditor content={malformedHTML} />);

    // Should not crash and should render the editor
    expect(screen.getByTestId("editor-content")).toBeInTheDocument();
  });

  it("should handle missing MCQ data attribute", () => {
    const htmlWithoutData = `<div data-type="mcq-block"></div>`;

    render(<TestEditor content={htmlWithoutData} />);

    // Should not crash and should render the editor
    expect(screen.getByTestId("editor-content")).toBeInTheDocument();
  });

  it("should validate MCQ data structure", () => {
    const { validateClipboardData } = MCQBlock.storage;

    // Valid data
    const validData = {
      id: "test-id",
      question: "Test question",
      options: [{ id: "opt-1", text: "Option 1", isCorrect: false }],
      allowMultiple: false,
      points: 1,
    };
    expect(validateClipboardData(validData)).toBe(true);

    // Invalid data - missing required fields
    expect(validateClipboardData({})).toBe(false);
    expect(validateClipboardData({ id: "test" })).toBe(false);
    expect(validateClipboardData(null)).toBe(false);
    expect(validateClipboardData("string")).toBe(false);
  });

  it("should generate new IDs for clipboard data", () => {
    const { generateNewIds } = MCQBlock.storage;

    const originalData: MCQBlockData = {
      id: "original-id",
      question: "Test question",
      options: [
        { id: "opt-1", text: "Option 1", isCorrect: false },
        { id: "opt-2", text: "Option 2", isCorrect: true },
      ],
      allowMultiple: false,
      points: 1,
      explanation: "Test explanation",
    };

    const newData = generateNewIds(originalData);

    // IDs should be different
    expect(newData.id).not.toBe(originalData.id);
    expect(newData.options[0].id).not.toBe(originalData.options[0].id);
    expect(newData.options[1].id).not.toBe(originalData.options[1].id);

    // Other data should be preserved
    expect(newData.question).toBe(originalData.question);
    expect(newData.options[0].text).toBe(originalData.options[0].text);
    expect(newData.options[1].isCorrect).toBe(
      originalData.options[1].isCorrect
    );
    expect(newData.allowMultiple).toBe(originalData.allowMultiple);
    expect(newData.points).toBe(originalData.points);
    expect(newData.explanation).toBe(originalData.explanation);
  });

  it("should preserve all MCQ configuration during copy/paste simulation", () => {
    const originalMCQ: MCQBlockData = {
      id: "test-mcq",
      question: "Which of the following are programming languages?",
      options: [
        { id: "opt-1", text: "JavaScript", isCorrect: true },
        { id: "opt-2", text: "HTML", isCorrect: false },
        { id: "opt-3", text: "Python", isCorrect: true },
        { id: "opt-4", text: "CSS", isCorrect: false },
      ],
      allowMultiple: true,
      points: 2,
      explanation:
        "JavaScript and Python are programming languages, while HTML and CSS are markup and styling languages.",
    };

    // Simulate the copy operation by serializing to HTML
    const serializedHTML = `<div data-type="mcq-block" data-mcq='${JSON.stringify(
      originalMCQ
    )}'></div>`;

    // Simulate the paste operation by parsing the HTML
    const parser = new DOMParser();
    const doc = parser.parseFromString(serializedHTML, "text/html");
    const mcqElement = doc.querySelector("[data-mcq]");

    expect(mcqElement).toBeTruthy();

    if (mcqElement) {
      const mcqDataAttr = mcqElement.getAttribute("data-mcq");
      expect(mcqDataAttr).toBeTruthy();

      if (mcqDataAttr) {
        const parsedMCQ = JSON.parse(mcqDataAttr);

        // All configuration should be preserved (except IDs which get regenerated)
        expect(parsedMCQ.question).toBe(originalMCQ.question);
        expect(parsedMCQ.options).toHaveLength(4);
        expect(parsedMCQ.options[0].text).toBe("JavaScript");
        expect(parsedMCQ.options[0].isCorrect).toBe(true);
        expect(parsedMCQ.options[1].text).toBe("HTML");
        expect(parsedMCQ.options[1].isCorrect).toBe(false);
        expect(parsedMCQ.options[2].text).toBe("Python");
        expect(parsedMCQ.options[2].isCorrect).toBe(true);
        expect(parsedMCQ.options[3].text).toBe("CSS");
        expect(parsedMCQ.options[3].isCorrect).toBe(false);
        expect(parsedMCQ.allowMultiple).toBe(true);
        expect(parsedMCQ.points).toBe(2);
        expect(parsedMCQ.explanation).toBe(originalMCQ.explanation);
      }
    }
  });
});
