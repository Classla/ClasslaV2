// User roles enum
export enum UserRole {
  INSTRUCTOR = "instructor",
  ADMIN = "admin",
  TEACHING_ASSISTANT = "teaching_assistant",
  STUDENT = "student",
  AUDIT = "audit",
}

// Submission status enum
export enum SubmissionStatus {
  SUBMITTED = "submitted",
  GRADED = "graded",
  RETURNED = "returned",
  IN_PROGRESS = "in-progress",
  NOT_STARTED = "not-started",
}

// Organization role enum
export enum OrganizationRole {
  ADMIN = "admin",
  MEMBER = "member",
}
