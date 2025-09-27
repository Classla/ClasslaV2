import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  MCQBlock,
  MCQBlockData,
  validateMCQData,
  sanitizeMCQData,
} from "../extensions/MCQBlock";

describe("MCQ Extension Data Serialization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("MCQ Data Validation", () => {
    it("validates complete MCQ data structure", () => {
      const validData: MCQBlockData = {
        id: "mcq-123",
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

      const result = validateMCQData(validData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects missing required fields", () => {
      const invalidData = {
        question: "Test question",
        // Missing id, options, allowMultiple, points
      };

      const result = validateMCQData(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("MCQ must have a valid ID");
      expect(result.errors).toContain("MCQ must have an options array");
      expect(result.errors).toContain(
        "MCQ must have a valid allowMultiple boolean"
      );
      expect(result.errors).toContain(
        "MCQ must have a valid points value (>= 0)"
      );
    });

    it("validates option structure", () => {
      const dataWithInvalidOptions = {
        id: "mcq-1",
        question: "Test?",
        options: [
          { id: "opt-1", text: "Option 1" }, // Missing isCorrect
          { text: "Option 2", isCorrect: true }, // Missing id
          { id: "opt-3", isCorrect: false }, // Missing text
        ],
        allowMultiple: false,
        points: 1,
      };

      const result = validateMCQData(dataWithInvalidOptions);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Option 1 must have a valid isCorrect boolean"
      );
      expect(result.errors).toContain("Option 2 must have a valid ID");
      expect(result.errors).toContain("Option 3 must have text");
    });

    it("requires at least one correct answer", () => {
      const dataWithNoCorrectAnswers = {
        id: "mcq-1",
        question: "Test?",
        options: [
          { id: "opt-1", text: "Wrong 1", isCorrect: false },
          { id: "opt-2", text: "Wrong 2", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const result = validateMCQData(dataWithNoCorrectAnswers);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "MCQ must have at least one correct answer"
      );
    });

    it("requires minimum 2 options", () => {
      const dataWithOneOption = {
        id: "mcq-1",
        question: "Test?",
        options: [{ id: "opt-1", text: "Only option", isCorrect: true }],
        allowMultiple: false,
        points: 1,
      };

      const result = validateMCQData(dataWithOneOption);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("MCQ must have at least 2 options");
    });

    it("validates points value", () => {
      const dataWithNegativePoints = {
        id: "mcq-1",
        question: "Test?",
        options: [
          { id: "opt-1", text: "Option 1", isCorrect: true },
          { id: "opt-2", text: "Option 2", isCorrect: false },
        ],
        allowMultiple: false,
        points: -1,
      };

      const result = validateMCQData(dataWithNegativePoints);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "MCQ must have a valid points value (>= 0)"
      );
    });
  });

  describe("MCQ Data Sanitization", () => {
    it("sanitizes null/undefined data to default structure", () => {
      const result = sanitizeMCQData(null);

      expect(result.id).toBeTruthy();
      expect(result.question).toBe("");
      expect(result.options).toHaveLength(2);
      expect(result.options[0].isCorrect).toBe(true); // First option should be correct
      expect(result.options[1].isCorrect).toBe(false);
      expect(result.allowMultiple).toBe(false);
      expect(result.points).toBe(1);
    });

    it("preserves valid data unchanged", () => {
      const validData: MCQBlockData = {
        id: "mcq-123",
        question: "Valid question?",
        options: [
          { id: "opt-1", text: "Option A", isCorrect: false },
          { id: "opt-2", text: "Option B", isCorrect: true },
        ],
        allowMultiple: true,
        points: 2,
        explanation: "Test explanation",
      };

      const result = sanitizeMCQData(validData);
      expect(result).toEqual(validData);
    });

    it("fills missing required fields with defaults", () => {
      const incompleteData = {
        question: "Incomplete question?",
        options: [{ text: "Option without ID", isCorrect: true }],
      };

      const result = sanitizeMCQData(incompleteData);

      expect(result.id).toBeTruthy();
      expect(result.question).toBe("Incomplete question?");
      expect(result.options).toHaveLength(2); // Should add second option
      expect(result.options[0].id).toBeTruthy();
      expect(result.options[0].text).toBe("Option without ID");
      expect(result.options[0].isCorrect).toBe(true);
      expect(result.allowMultiple).toBe(false);
      expect(result.points).toBe(1);
    });

    it("ensures at least one correct answer", () => {
      const dataWithNoCorrectAnswers = {
        id: "mcq-1",
        question: "Test?",
        options: [
          { id: "opt-1", text: "Wrong 1", isCorrect: false },
          { id: "opt-2", text: "Wrong 2", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const result = sanitizeMCQData(dataWithNoCorrectAnswers);
      expect(result.options[0].isCorrect).toBe(true); // First option should be made correct
    });

    it("filters out invalid options", () => {
      const dataWithInvalidOptions = {
        id: "mcq-1",
        question: "Test?",
        options: [
          null, // Invalid
          { id: "opt-1", text: "Valid option", isCorrect: true },
          "invalid string", // Invalid
          { id: "opt-2", text: "Another valid", isCorrect: false },
          undefined, // Invalid
        ],
        allowMultiple: false,
        points: 1,
      };

      const result = sanitizeMCQData(dataWithInvalidOptions);
      expect(result.options).toHaveLength(2);
      expect(result.options[0].text).toBe("Valid option");
      expect(result.options[1].text).toBe("Another valid");
    });
  });

  describe("HTML Serialization and Parsing", () => {
    it("serializes MCQ data to HTML attributes correctly", () => {
      const mcqData: MCQBlockData = {
        id: "test-mcq",
        question: "Serialization test?",
        options: [
          { id: "opt-1", text: "Option A", isCorrect: true },
          { id: "opt-2", text: "Option B", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
        explanation: "Test explanation",
      };

      const attributes = { mcqData };
      const htmlAttrs = MCQBlock.config
        .addAttributes()
        .mcqData.renderHTML(attributes);

      expect(htmlAttrs["data-mcq"]).toBe(JSON.stringify(mcqData));
      expect(htmlAttrs["data-type"]).toBe("mcq-block");
    });

    it("parses HTML attributes to MCQ data correctly", () => {
      const originalData: MCQBlockData = {
        id: "original-id",
        question: "Parse test?",
        options: [
          { id: "opt-1", text: "Parse A", isCorrect: false },
          { id: "opt-2", text: "Parse B", isCorrect: true },
        ],
        allowMultiple: true,
        points: 2,
        explanation: "Parse explanation",
      };

      const mockElement = {
        getAttribute: vi.fn().mockReturnValue(JSON.stringify(originalData)),
      };

      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      // Content should be preserved
      expect(parsedData.question).toBe(originalData.question);
      expect(parsedData.options[0].text).toBe("Parse A");
      expect(parsedData.options[1].text).toBe("Parse B");
      expect(parsedData.options[0].isCorrect).toBe(false);
      expect(parsedData.options[1].isCorrect).toBe(true);
      expect(parsedData.allowMultiple).toBe(true);
      expect(parsedData.points).toBe(2);
      expect(parsedData.explanation).toBe("Parse explanation");

      // IDs should be regenerated
      expect(parsedData.id).not.toBe(originalData.id);
      expect(parsedData.options[0].id).not.toBe(originalData.options[0].id);
      expect(parsedData.options[1].id).not.toBe(originalData.options[1].id);
    });

    it("handles malformed JSON gracefully", () => {
      const mockElement = {
        getAttribute: vi.fn().mockReturnValue('{"invalid": json}'),
      };

      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      // Should return sanitized default data
      expect(parsedData.id).toBeTruthy();
      expect(parsedData.question).toBe("");
      expect(parsedData.options).toHaveLength(2);
      expect(parsedData.allowMultiple).toBe(false);
      expect(parsedData.points).toBe(1);
    });

    it("handles missing data attribute", () => {
      const mockElement = {
        getAttribute: vi.fn().mockReturnValue(null),
      };

      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      // Should return sanitized default data
      expect(parsedData.id).toBeTruthy();
      expect(parsedData.question).toBe("");
      expect(parsedData.options).toHaveLength(2);
      expect(parsedData.allowMultiple).toBe(false);
      expect(parsedData.points).toBe(1);
    });
  });

  describe("Data Integrity During Serialization Cycle", () => {
    it("preserves all data through complete serialization cycle", () => {
      const originalMCQ: MCQBlockData = {
        id: "integrity-test",
        question: "Data integrity test with special chars: <>&\"'",
        options: [
          {
            id: "opt-1",
            text: "Option with <script>alert('xss')</script>",
            isCorrect: true,
          },
          { id: "opt-2", text: "Normal option", isCorrect: false },
          { id: "opt-3", text: "Empty option: ", isCorrect: false },
          {
            id: "opt-4",
            text: "Very long option text that might cause issues with serialization but should still work correctly in all cases",
            isCorrect: false,
          },
        ],
        allowMultiple: true,
        points: 3,
        explanation: "Explanation with special chars: <>&\"'",
      };

      // Step 1: Serialize to HTML
      const attributes = { mcqData: originalMCQ };
      const htmlAttrs = MCQBlock.config
        .addAttributes()
        .mcqData.renderHTML(attributes);
      const serializedData = htmlAttrs["data-mcq"];

      // Step 2: Parse back from HTML
      const mockElement = {
        getAttribute: vi.fn().mockReturnValue(serializedData),
      };
      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      // Verify data integrity (except IDs which get regenerated)
      expect(parsedData.question).toBe(originalMCQ.question);
      expect(parsedData.options).toHaveLength(originalMCQ.options.length);
      expect(parsedData.options[0].text).toBe(originalMCQ.options[0].text);
      expect(parsedData.options[0].isCorrect).toBe(
        originalMCQ.options[0].isCorrect
      );
      expect(parsedData.options[1].text).toBe(originalMCQ.options[1].text);
      expect(parsedData.options[2].text).toBe(originalMCQ.options[2].text);
      expect(parsedData.options[3].text).toBe(originalMCQ.options[3].text);
      expect(parsedData.allowMultiple).toBe(originalMCQ.allowMultiple);
      expect(parsedData.points).toBe(originalMCQ.points);
      expect(parsedData.explanation).toBe(originalMCQ.explanation);

      // IDs should be different (regenerated)
      expect(parsedData.id).not.toBe(originalMCQ.id);
      expect(parsedData.options[0].id).not.toBe(originalMCQ.options[0].id);
    });

    it("handles edge cases in serialization", () => {
      const edgeCaseData: MCQBlockData = {
        id: "edge-case",
        question: "", // Empty question
        options: [
          { id: "opt-1", text: "", isCorrect: true }, // Empty text
          { id: "opt-2", text: "Normal", isCorrect: false },
        ],
        allowMultiple: false,
        points: 0, // Zero points
        explanation: "", // Empty explanation
      };

      // Serialize and parse
      const attributes = { mcqData: edgeCaseData };
      const htmlAttrs = MCQBlock.config
        .addAttributes()
        .mcqData.renderHTML(attributes);
      const mockElement = {
        getAttribute: vi.fn().mockReturnValue(htmlAttrs["data-mcq"]),
      };
      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      // All edge case values should be preserved
      expect(parsedData.question).toBe("");
      expect(parsedData.options[0].text).toBe("");
      expect(parsedData.points).toBe(0);
      expect(parsedData.explanation).toBe("");
    });
  });

  describe("ID Generation and Uniqueness", () => {
    it("generates unique IDs for new MCQ blocks", () => {
      // Add small delay to ensure different timestamps
      const data1 = sanitizeMCQData(null);

      // Wait a bit to ensure different timestamp
      vi.advanceTimersByTime(1);

      const data2 = sanitizeMCQData(null);

      expect(data1.id).not.toBe(data2.id);
      // Note: The default implementation uses static IDs for options when creating from null
      // This is acceptable as the main ID is unique and options get regenerated during parsing
    });

    it("regenerates IDs during parsing to avoid conflicts", () => {
      const originalData = {
        id: "same-id",
        question: "Test",
        options: [
          { id: "same-opt-id", text: "Option", isCorrect: true },
          { id: "same-opt-id-2", text: "Option 2", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const mockElement1 = {
        getAttribute: vi.fn().mockReturnValue(JSON.stringify(originalData)),
      };
      const mockElement2 = {
        getAttribute: vi.fn().mockReturnValue(JSON.stringify(originalData)),
      };

      const parsed1 = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement1);
      const parsed2 = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement2);

      // IDs should be different between the two parsed instances
      expect(parsed1.id).not.toBe(parsed2.id);
      expect(parsed1.options[0].id).not.toBe(parsed2.options[0].id);
      expect(parsed1.options[1].id).not.toBe(parsed2.options[1].id);
    });
  });

  describe("Error Handling and Recovery", () => {
    it("logs warnings for invalid data during rendering", () => {
      const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const invalidData = {
        id: "test",
        // Missing required fields
      };

      const attributes = { mcqData: invalidData };
      const htmlAttrs = MCQBlock.config
        .addAttributes()
        .mcqData.renderHTML(attributes);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Invalid MCQ data during render, sanitizing:",
        expect.any(Array)
      );
      expect(htmlAttrs["data-mcq"]).toBeTruthy(); // Should still produce valid output

      consoleSpy.mockRestore();
    });

    it("logs errors for JSON parsing failures", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const mockElement = {
        getAttribute: vi.fn().mockReturnValue('{"malformed": json}'),
      };

      const parsedData = MCQBlock.config
        .addAttributes()
        .mcqData.parseHTML(mockElement);

      expect(consoleSpy).toHaveBeenCalledWith(
        "Failed to parse MCQ data, using default:",
        expect.any(Error)
      );
      expect(parsedData.id).toBeTruthy(); // Should still return valid data

      consoleSpy.mockRestore();
    });

    it("recovers from completely corrupted data", () => {
      const corruptedInputs = [
        undefined,
        null,
        "string",
        123,
        [],
        { completely: "wrong", structure: true },
      ];

      corruptedInputs.forEach((input) => {
        const result = sanitizeMCQData(input);

        // Should always return valid MCQ structure
        expect(result.id).toBeTruthy();
        expect(result.question).toBe("");
        expect(Array.isArray(result.options)).toBe(true);
        expect(result.options.length).toBeGreaterThanOrEqual(2);
        expect(typeof result.allowMultiple).toBe("boolean");
        expect(typeof result.points).toBe("number");
        expect(result.points).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
