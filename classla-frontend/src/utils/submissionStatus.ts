import { Submission } from "../types";

/**
 * Status display information for a submission
 */
export interface SubmissionStatusInfo {
  label: string;
  color: string;
  variant: "not-started" | "in-progress" | "submitted" | "graded";
}

/**
 * Determines the display status of a submission
 *
 * @param submission - The submission object (can be null for students who haven't started)
 * @param hasGrader - Optional flag indicating if a grader exists for the submission
 * @returns Status information including label, color class, and variant
 *
 * @example
 * // Student hasn't started
 * getSubmissionStatus(null) // { label: "Not Started", color: "text-red-600", variant: "not-started" }
 *
 * // Student is working on assignment
 * getSubmissionStatus({ status: "in-progress", ... }) // { label: "In Progress", color: "text-yellow-600", variant: "in-progress" }
 *
 * // Student has submitted
 * getSubmissionStatus({ status: "submitted", ... }) // { label: "Submitted", color: "text-blue-600", variant: "submitted" }
 *
 * // Student has been graded
 * getSubmissionStatus({ status: "graded", ... }, true) // { label: "Submitted", color: "text-green-600", variant: "graded" }
 */
export function getSubmissionStatus(
  submission: Submission | null,
  hasGrader: boolean = false
): SubmissionStatusInfo {
  // No submission - student hasn't started
  if (!submission) {
    return {
      label: "Not Started",
      color: "text-red-600",
      variant: "not-started",
    };
  }

  // Check submission status
  switch (submission.status) {
    case "in-progress":
      return {
        label: "In Progress",
        color: "text-yellow-600",
        variant: "in-progress",
      };

    case "submitted":
      // If grader exists, show as graded (green), otherwise submitted (blue)
      if (hasGrader) {
        return {
          label: "Submitted",
          color: "text-green-600",
          variant: "graded",
        };
      }
      return {
        label: "Submitted",
        color: "text-blue-600",
        variant: "submitted",
      };

    case "graded":
    case "returned":
      // Graded/returned submissions are shown as submitted (green)
      return {
        label: "Submitted",
        color: "text-green-600",
        variant: "graded",
      };

    default:
      // Fallback for unknown status
      return {
        label: "Not Started",
        color: "text-red-600",
        variant: "not-started",
      };
  }
}

/**
 * Gets a CSS class for background color based on submission status
 * Useful for cell backgrounds in tables
 *
 * @param submission - The submission object (can be null)
 * @param hasGrader - Optional flag indicating if a grader exists
 * @returns Tailwind CSS background color class
 */
export function getSubmissionStatusBgColor(
  submission: Submission | null,
  hasGrader: boolean = false
): string {
  const status = getSubmissionStatus(submission, hasGrader);

  switch (status.variant) {
    case "not-started":
      return "bg-red-50";
    case "in-progress":
      return "bg-yellow-50";
    case "submitted":
      return "bg-blue-50";
    case "graded":
      return "bg-green-50";
    default:
      return "bg-gray-50";
  }
}

/**
 * Gets a CSS class for border color based on submission status
 * Useful for highlighting cells or cards
 *
 * @param submission - The submission object (can be null)
 * @param hasGrader - Optional flag indicating if a grader exists
 * @returns Tailwind CSS border color class
 */
export function getSubmissionStatusBorderColor(
  submission: Submission | null,
  hasGrader: boolean = false
): string {
  const status = getSubmissionStatus(submission, hasGrader);

  switch (status.variant) {
    case "not-started":
      return "border-red-300";
    case "in-progress":
      return "border-yellow-300";
    case "submitted":
      return "border-blue-300";
    case "graded":
      return "border-green-300";
    default:
      return "border-gray-300";
  }
}
