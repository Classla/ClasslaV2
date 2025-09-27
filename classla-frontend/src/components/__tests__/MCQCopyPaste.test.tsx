import { MCQBlock, MCQBlockData } from "../extensions/MCQBlock";
import { vi } from "vitest";

describe("MCQ Copy/Paste Functionality", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Data Validation", () => {
    it("should validate correct MCQ data structure", () => {
      const { validateClipboardData } = MCQBlock.storage;

      const validData = {
        id: "test-id",
        question: "Test question",
        options: [{ id: "opt-1", text: "Option 1", isCorrect: false }],
        allowMultiple: false,
        points: 1,
      };

      expect(validateClipboardData(validData)).toBe(true);
    });

    it("should reject invalid MCQ data structures", () => {
      const { validateClipboardData } = MCQBlock.storage;

      // Missing required fields
      expect(validateClipboardData({})).toBe(false);
      expect(validateClipboardData({ id: "test" })).toBe(false);
      expect(validateClipboardData(null)).toBe(false);
      expect(validateClipboardData("string")).toBe(false);

      // Wrong types
      expect(
        validateClipboardData({
          id: 123, // should be string
          question: "Test",
          options: [],
          allowMultiple: false,
          points: 1,
        })
      ).toBe(false);

      expect(
        validateClipboardData({
          id: "test",
          question: "Test",
          options: "not-array", // should be array
          allowMultiple: false,
          points: 1,
        })
      ).toBe(false);
    });
  });

  describe("ID Generation", () => {
    it("should generate new IDs for pasted MCQ data", () => {
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

    it("should generate unique IDs on each call", () => {
      const { generateNewIds } = MCQBlock.storage;

      const originalData: MCQBlockData = {
        id: "test-id",
        question: "Test",
        options: [{ id: "opt-1", text: "Option", isCorrect: false }],
        allowMultiple: false,
        points: 1,
      };

      const newData1 = generateNewIds(originalData);
      const newData2 = generateNewIds(originalData);

      // Each call should generate different IDs
      expect(newData1.id).not.toBe(newData2.id);
      expect(newData1.options[0].id).not.toBe(newData2.options[0].id);
    });
  });

  describe("HTML Serialization", () => {
    it("should serialize MCQ data to HTML correctly", () => {
      const mcqData: MCQBlockData = {
        id: "test-mcq",
        question: "What is 2 + 2?",
        options: [
          { id: "opt-1", text: "3", isCorrect: false },
          { id: "opt-2", text: "4", isCorrect: true },
        ],
        allowMultiple: false,
        points: 1,
        explanation: "Basic math",
      };

      // Simulate the renderHTML process
      const attributes = { mcqData };
      const htmlAttrs = MCQBlock.config
        .addAttributes()
        .mcqData.renderHTML(attributes);

      expect(htmlAttrs["data-mcq"]).toBe(JSON.stringify(mcqData));
      expect(htmlAttrs["data-type"]).toBe("mcq-block");
    });

    it("should deserialize HTML to MCQ data correctly", () => {
      const originalData: MCQBlockData = {
        id: "test-mcq",
        question: "What is the answer?",
        options: [
          { id: "opt-1", text: "Option A", isCorrect: true },
          { id: "opt-2", text: "Option B", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
        explanation: "This is the explanation",
      };

      // Create a mock DOM element
      const mockElement = {
        getAttribute: vi.fn().mockReturnValue(JSON.stringify(originalData)),
      };

      // Simulate the parseHTML process
      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      // Data should be preserved but IDs should be regenerated
      expect(parsedData.question).toBe(originalData.question);
      expect(parsedData.options).toHaveLength(2);
      expect(parsedData.options[0].text).toBe("Option A");
      expect(parsedData.options[0].isCorrect).toBe(true);
      expect(parsedData.options[1].text).toBe("Option B");
      expect(parsedData.options[1].isCorrect).toBe(false);
      expect(parsedData.allowMultiple).toBe(false);
      expect(parsedData.points).toBe(1);
      expect(parsedData.explanation).toBe("This is the explanation");

      // IDs should be different (regenerated)
      expect(parsedData.id).not.toBe(originalData.id);
      expect(parsedData.options[0].id).not.toBe(originalData.options[0].id);
      expect(parsedData.options[1].id).not.toBe(originalData.options[1].id);
    });

    it("should handle malformed JSON gracefully", () => {
      const mockElement = {
        getAttribute: vi.fn().mockReturnValue('{"invalid": json}'),
      };

      // Should not throw and should return default data
      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      expect(parsedData).toBeDefined();
      expect(parsedData.id).toBeDefined();
      expect(parsedData.question).toBe("");
      expect(parsedData.options).toHaveLength(2);
      expect(parsedData.allowMultiple).toBe(false);
      expect(parsedData.points).toBe(1);
    });

    it("should handle missing data attribute gracefully", () => {
      const mockElement = {
        getAttribute: vi.fn().mockReturnValue(null),
      };

      // Should return default data
      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      expect(parsedData).toBeDefined();
      expect(parsedData.id).toBeDefined();
      expect(parsedData.question).toBe("");
      expect(parsedData.options).toHaveLength(2);
      expect(parsedData.allowMultiple).toBe(false);
      expect(parsedData.points).toBe(1);
    });
  });

  describe("Complex MCQ Configuration Preservation", () => {
    it("should preserve all MCQ configuration during copy/paste simulation", () => {
      const complexMCQ: MCQBlockData = {
        id: "complex-mcq",
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

      // Simulate copy operation (serialize to JSON)
      const serialized = JSON.stringify(complexMCQ);

      // Simulate paste operation (deserialize from JSON)
      const mockElement = {
        getAttribute: vi.fn().mockReturnValue(serialized),
      };

      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      // All configuration should be preserved (except IDs which get regenerated)
      expect(parsedData.question).toBe(complexMCQ.question);
      expect(parsedData.options).toHaveLength(4);
      expect(parsedData.options[0].text).toBe("JavaScript");
      expect(parsedData.options[0].isCorrect).toBe(true);
      expect(parsedData.options[1].text).toBe("HTML");
      expect(parsedData.options[1].isCorrect).toBe(false);
      expect(parsedData.options[2].text).toBe("Python");
      expect(parsedData.options[2].isCorrect).toBe(true);
      expect(parsedData.options[3].text).toBe("CSS");
      expect(parsedData.options[3].isCorrect).toBe(false);
      expect(parsedData.allowMultiple).toBe(true);
      expect(parsedData.points).toBe(2);
      expect(parsedData.explanation).toBe(complexMCQ.explanation);

      // IDs should be regenerated
      expect(parsedData.id).not.toBe(complexMCQ.id);
      expect(parsedData.options[0].id).not.toBe(complexMCQ.options[0].id);
      expect(parsedData.options[1].id).not.toBe(complexMCQ.options[1].id);
      expect(parsedData.options[2].id).not.toBe(complexMCQ.options[2].id);
      expect(parsedData.options[3].id).not.toBe(complexMCQ.options[3].id);
    });

    it("should handle edge cases in option data", () => {
      const edgeCaseMCQ = {
        id: "edge-case",
        question: "Edge case question with special characters: <>&\"'",
        options: [
          {
            id: "opt-1",
            text: "Option with <script>alert('xss')</script>",
            isCorrect: true,
          },
          { id: "opt-2", text: "", isCorrect: false }, // Empty text
          {
            id: "opt-3",
            text: "Very long option text that goes on and on and on and might cause issues with serialization or display but should still work correctly",
            isCorrect: false,
          },
        ],
        allowMultiple: true,
        points: 0, // Zero points
        explanation: "Explanation with special chars: <>&\"'",
      };

      const serialized = JSON.stringify(edgeCaseMCQ);
      const mockElement = {
        getAttribute: vi.fn().mockReturnValue(serialized),
      };

      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      // All data should be preserved correctly
      expect(parsedData.question).toBe(edgeCaseMCQ.question);
      expect(parsedData.options[0].text).toBe(edgeCaseMCQ.options[0].text);
      expect(parsedData.options[1].text).toBe(""); // Empty text preserved
      expect(parsedData.options[2].text).toBe(edgeCaseMCQ.options[2].text);
      expect(parsedData.points).toBe(0); // Zero points preserved
      expect(parsedData.explanation).toBe(edgeCaseMCQ.explanation);
    });
  });

  describe("Data Integrity Validation", () => {
    it("should ensure data integrity during copy/paste operations", () => {
      const originalMCQ: MCQBlockData = {
        id: "integrity-test",
        question: "Test question",
        options: [
          { id: "opt-1", text: "Correct answer", isCorrect: true },
          { id: "opt-2", text: "Wrong answer", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
        explanation: "Test explanation",
      };

      // Simulate the full copy/paste cycle
      // 1. Serialize to HTML (copy)
      const attributes = { mcqData: originalMCQ };
      const htmlAttrs = MCQBlock.config
        .addAttributes()
        .mcqData.renderHTML(attributes);
      const serializedData = htmlAttrs["data-mcq"];

      // 2. Deserialize from HTML (paste)
      const mockElement = {
        getAttribute: vi.fn().mockReturnValue(serializedData),
      };
      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      // 3. Validate data integrity
      expect(parsedData.question).toBe(originalMCQ.question);
      expect(parsedData.options).toHaveLength(originalMCQ.options.length);
      expect(parsedData.options[0].text).toBe(originalMCQ.options[0].text);
      expect(parsedData.options[0].isCorrect).toBe(
        originalMCQ.options[0].isCorrect
      );
      expect(parsedData.options[1].text).toBe(originalMCQ.options[1].text);
      expect(parsedData.options[1].isCorrect).toBe(
        originalMCQ.options[1].isCorrect
      );
      expect(parsedData.allowMultiple).toBe(originalMCQ.allowMultiple);
      expect(parsedData.points).toBe(originalMCQ.points);
      expect(parsedData.explanation).toBe(originalMCQ.explanation);

      // IDs should be different (regenerated for paste)
      expect(parsedData.id).not.toBe(originalMCQ.id);
      expect(parsedData.options[0].id).not.toBe(originalMCQ.options[0].id);
      expect(parsedData.options[1].id).not.toBe(originalMCQ.options[1].id);
    });
  });
});
