import { describe, it, expect } from "vitest";
import {
  validateMCQData,
  sanitizeMCQData,
  MCQBlockData,
} from "../extensions/MCQBlock";

describe("MCQ Validation and Sanitization", () => {
  describe("validateMCQData", () => {
    it("validates correct MCQ data", () => {
      const validData: MCQBlockData = {
        id: "mcq-1",
        question: "What is 2+2?",
        options: [
          { id: "opt-1", text: "3", isCorrect: false },
          { id: "opt-2", text: "4", isCorrect: true },
        ],
        allowMultiple: false,
        points: 1,
        explanation: "Basic math",
      };

      const result = validateMCQData(validData);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("detects missing required fields", () => {
      const invalidData = {
        question: "What is 2+2?",
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

    it("detects invalid option data", () => {
      const invalidData = {
        id: "mcq-1",
        question: "What is 2+2?",
        options: [
          { id: "opt-1", text: "3" }, // Missing isCorrect
          { text: "4", isCorrect: true }, // Missing id
        ],
        allowMultiple: false,
        points: 1,
      };

      const result = validateMCQData(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "Option 1 must have a valid isCorrect boolean"
      );
      expect(result.errors).toContain("Option 2 must have a valid ID");
    });

    it("detects when no correct answers are provided", () => {
      const invalidData = {
        id: "mcq-1",
        question: "What is 2+2?",
        options: [
          { id: "opt-1", text: "3", isCorrect: false },
          { id: "opt-2", text: "4", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const result = validateMCQData(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "MCQ must have at least one correct answer"
      );
    });

    it("detects insufficient options", () => {
      const invalidData = {
        id: "mcq-1",
        question: "What is 2+2?",
        options: [{ id: "opt-1", text: "4", isCorrect: true }],
        allowMultiple: false,
        points: 1,
      };

      const result = validateMCQData(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain("MCQ must have at least 2 options");
    });

    it("detects negative points", () => {
      const invalidData = {
        id: "mcq-1",
        question: "What is 2+2?",
        options: [
          { id: "opt-1", text: "3", isCorrect: false },
          { id: "opt-2", text: "4", isCorrect: true },
        ],
        allowMultiple: false,
        points: -1,
      };

      const result = validateMCQData(invalidData);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        "MCQ must have a valid points value (>= 0)"
      );
    });
  });

  describe("sanitizeMCQData", () => {
    it("sanitizes null/undefined data", () => {
      const result = sanitizeMCQData(null);
      expect(result.id).toBeTruthy();
      expect(result.question).toBe("");
      expect(result.options).toHaveLength(2);
      expect(result.allowMultiple).toBe(false);
      expect(result.points).toBe(1);
      expect(result.options[0].isCorrect).toBe(true); // Ensures at least one correct answer
    });

    it("sanitizes incomplete data", () => {
      const incompleteData = {
        question: "What is 2+2?",
        options: [
          { text: "4" }, // Missing id and isCorrect
        ],
      };

      const result = sanitizeMCQData(incompleteData);
      expect(result.id).toBeTruthy();
      expect(result.question).toBe("What is 2+2?");
      expect(result.options).toHaveLength(2); // Should add second option
      expect(result.options[0].id).toBeTruthy();
      expect(result.options[0].isCorrect).toBe(true); // Should set first as correct
      expect(result.allowMultiple).toBe(false);
      expect(result.points).toBe(1);
    });

    it("preserves valid data", () => {
      const validData: MCQBlockData = {
        id: "mcq-1",
        question: "What is 2+2?",
        options: [
          { id: "opt-1", text: "3", isCorrect: false },
          { id: "opt-2", text: "4", isCorrect: true },
        ],
        allowMultiple: false,
        points: 2,
        explanation: "Basic math",
      };

      const result = sanitizeMCQData(validData);
      expect(result).toEqual(validData);
    });

    it("filters out invalid options", () => {
      const dataWithInvalidOptions = {
        id: "mcq-1",
        question: "What is 2+2?",
        options: [
          null, // Invalid option
          { id: "opt-1", text: "3", isCorrect: false },
          "invalid", // Invalid option
          { id: "opt-2", text: "4", isCorrect: true },
        ],
        allowMultiple: false,
        points: 1,
      };

      const result = sanitizeMCQData(dataWithInvalidOptions);
      expect(result.options).toHaveLength(2);
      expect(result.options[0].text).toBe("3");
      expect(result.options[1].text).toBe("4");
    });

    it("ensures at least one correct answer", () => {
      const dataWithNoCorrectAnswers = {
        id: "mcq-1",
        question: "What is 2+2?",
        options: [
          { id: "opt-1", text: "3", isCorrect: false },
          { id: "opt-2", text: "5", isCorrect: false },
        ],
        allowMultiple: false,
        points: 1,
      };

      const result = sanitizeMCQData(dataWithNoCorrectAnswers);
      expect(result.options[0].isCorrect).toBe(true); // Should set first as correct
    });

    it("handles invalid points values", () => {
      const dataWithInvalidPoints = {
        id: "mcq-1",
        question: "What is 2+2?",
        options: [
          { id: "opt-1", text: "3", isCorrect: false },
          { id: "opt-2", text: "4", isCorrect: true },
        ],
        allowMultiple: false,
        points: "invalid",
      };

      const result = sanitizeMCQData(dataWithInvalidPoints);
      expect(result.points).toBe(1); // Should default to 1
    });
  });
});
