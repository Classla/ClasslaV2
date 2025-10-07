import { describe, it, expect } from "vitest";
import {
  getSubmissionStatus,
  getSubmissionStatusBgColor,
  getSubmissionStatusBorderColor,
} from "../submissionStatus";
import { Submission } from "../../types";

describe("submissionStatus utilities", () => {
  describe("getSubmissionStatus", () => {
    it("should return 'Not Started' for null submission", () => {
      const result = getSubmissionStatus(null);
      expect(result).toEqual({
        label: "Not Started",
        color: "text-red-600",
        variant: "not-started",
      });
    });

    it("should return 'In Progress' for in-progress submission", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "in-progress",
      };

      const result = getSubmissionStatus(submission);
      expect(result).toEqual({
        label: "In Progress",
        color: "text-yellow-600",
        variant: "in-progress",
      });
    });

    it("should return 'Submitted' (blue) for submitted submission without grader", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "submitted",
      };

      const result = getSubmissionStatus(submission, false);
      expect(result).toEqual({
        label: "Submitted",
        color: "text-blue-600",
        variant: "submitted",
      });
    });

    it("should return 'Submitted' (green) for submitted submission with grader", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "submitted",
      };

      const result = getSubmissionStatus(submission, true);
      expect(result).toEqual({
        label: "Submitted",
        color: "text-green-600",
        variant: "graded",
      });
    });

    it("should return 'Submitted' (green) for graded submission", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "graded",
      };

      const result = getSubmissionStatus(submission);
      expect(result).toEqual({
        label: "Submitted",
        color: "text-green-600",
        variant: "graded",
      });
    });

    it("should return 'Submitted' (green) for returned submission", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "returned",
      };

      const result = getSubmissionStatus(submission);
      expect(result).toEqual({
        label: "Submitted",
        color: "text-green-600",
        variant: "graded",
      });
    });

    it("should handle unknown status as 'Not Started'", () => {
      const submission: any = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "unknown-status",
      };

      const result = getSubmissionStatus(submission);
      expect(result).toEqual({
        label: "Not Started",
        color: "text-red-600",
        variant: "not-started",
      });
    });
  });

  describe("getSubmissionStatusBgColor", () => {
    it("should return red background for null submission", () => {
      const result = getSubmissionStatusBgColor(null);
      expect(result).toBe("bg-red-50");
    });

    it("should return yellow background for in-progress submission", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "in-progress",
      };

      const result = getSubmissionStatusBgColor(submission);
      expect(result).toBe("bg-yellow-50");
    });

    it("should return blue background for submitted submission without grader", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "submitted",
      };

      const result = getSubmissionStatusBgColor(submission, false);
      expect(result).toBe("bg-blue-50");
    });

    it("should return green background for graded submission", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "graded",
      };

      const result = getSubmissionStatusBgColor(submission);
      expect(result).toBe("bg-green-50");
    });
  });

  describe("getSubmissionStatusBorderColor", () => {
    it("should return red border for null submission", () => {
      const result = getSubmissionStatusBorderColor(null);
      expect(result).toBe("border-red-300");
    });

    it("should return yellow border for in-progress submission", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "in-progress",
      };

      const result = getSubmissionStatusBorderColor(submission);
      expect(result).toBe("border-yellow-300");
    });

    it("should return blue border for submitted submission without grader", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "submitted",
      };

      const result = getSubmissionStatusBorderColor(submission, false);
      expect(result).toBe("border-blue-300");
    });

    it("should return green border for graded submission", () => {
      const submission: Submission = {
        id: "1",
        assignment_id: "a1",
        timestamp: new Date(),
        values: {},
        course_id: "c1",
        student_id: "s1",
        status: "graded",
      };

      const result = getSubmissionStatusBorderColor(submission);
      expect(result).toBe("border-green-300");
    });
  });
});
