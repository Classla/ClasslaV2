import { UserRole, SubmissionStatus, OrganizationRole } from "./enums";

// Re-export enums for convenience
export { UserRole, SubmissionStatus, OrganizationRole };

// Course entity
export interface Course {
  id: string;
  name: string;
  description?: string; // Short text description of the course
  settings: Record<string, any>; // Generic settings object
  thumbnail_url: string;
  summary_content: string; // editor string
  slug: string; // course join code, and how it will be shown in URL
  created_by_id: string; // user_id of creator
  created_at: Date;
  deleted_at?: Date;
  is_official?: boolean;
}

// System setting entity
export interface SystemSetting {
  key: string;
  value: any;
  updated_at: Date;
  updated_by_id?: string;
}

// Section entity
export interface Section {
  id: string;
  course_id: string;
  name: string;
  description?: string;
  slug: string; // sections are joined with code `${course_slug}-${section_slug}`
}

// User entity
export interface User {
  id: string;
  workos_user_id?: string; // WorkOS user identifier for authentication
  name?: string; // Kept for backward compatibility
  first_name?: string; // User first name from WorkOS profile
  last_name?: string; // User last name from WorkOS profile
  is_admin: boolean;
  email: string;
  settings: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

// Folder entity - represents empty folders in the module tree
export interface Folder {
  id: string;
  course_id: string;
  path: string[]; // e.g., ["unit 1", "module 1"] for "unit 1/module 1"
  name: string; // The display name of the folder (last element of path)
  order_index: number; // For ordering folders within their parent
  created_at: Date;
}

// Assignment entity
export interface Assignment {
  id: string;
  name: string;
  course_id: string;
  settings: Record<string, any>;
  content: string; // tiptap editor content, stores all blocks, questions, and autograder data.
  publish_times: Record<string, string>; // user_id to ISO date string. Past = immediately visible, Future = scheduled
  due_dates_map: Record<string, Date>; // user_id to Date
  due_date_config: { courseDueDate?: string; sectionDueDates?: Record<string, string> }; // UI config for course-wide and section-level dates
  module_path: string[]; // e.g., ["unit 1", "module 1"] for "unit 1/module 1"
  is_lockdown: boolean;
  lockdown_time_map: Record<string, number>; // user_id to number in seconds
  order_index: number; // For ordering assignments within their module
  created_at: Date;
  updated_at: Date;
}

// Submission entity
export interface Submission {
  id: string;
  assignment_id: string;
  timestamp: Date;
  values: Record<string, any>; // block_id, value
  course_id: string;
  student_id: string;
  grader_id?: string;
  grade?: number;
  status: SubmissionStatus;
  is_late?: boolean;
}

/**
 * Block Score - represents the score for a single MCQ block
 */
export interface BlockScore {
  awarded: number; // Points awarded for this block
  possible: number; // Total possible points for this block
}

// Grader entity (feedback and grading info)
export interface Grader {
  id: string;
  feedback: string;
  rubric_id?: string;
  raw_assignment_score: number;
  raw_rubric_score: number;
  score_modifier: string;
  reviewed_at?: Date;
  submission_id: string;
  block_scores?: Record<string, BlockScore>; // Block ID (UUID) -> score details
}

// Rubric instance (actual scores for a submission)
export interface Rubric {
  id: string;
  submission_id: string;
  rubric_schema_id: string; // Reference to RubricSchema
  values: number[]; // Scores for each rubric item
}

// Rubric type enum
export enum RubricType {
  CHECKBOX = "checkbox", // All or nothing - checkbox for each criterion
  NUMERICAL = "numerical", // Scale-based - numerical input for each criterion
}

// Rubric schema (template/definition)
export interface RubricSchema {
  id: string;
  assignment_id: string;
  title: string;
  type: RubricType; // Type of rubric (checkbox or numerical)
  use_for_grading: boolean;
  items: RubricItem[];
}

// Individual rubric item
export interface RubricItem {
  title: string;
  points: number; // Can be negative for checkbox rubrics
  isExtraCredit?: boolean; // If true, not counted towards total assignment points
}

// Course enrollment entity (many-to-many relationship)
export interface CourseEnrollment {
  id: string;
  user_id: string;
  course_id: string;
  role: UserRole;
  enrolled_at: Date;
}

// TA Permissions interface
export interface TAPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canViewStudents: boolean;
  canViewGrades: boolean;
}

// Organization entity
export interface Organization {
  id: string;
  name: string;
  slug: string; // Join code (similar to course slugs)
  created_by_id: string;
  created_at: Date;
  updated_at: Date;
}

// Organization membership entity
export interface OrganizationMembership {
  id: string;
  organization_id: string;
  user_id: string;
  role: OrganizationRole;
  joined_at: Date;
}

// Course template entity
export interface CourseTemplate {
  id: string;
  name: string;
  organization_id: string;
  created_by_id: string;
  settings: Record<string, any>;
  thumbnail_url?: string;
  summary_content?: string;
  slug?: string;
  created_at: Date;
  updated_at: Date;
  deleted_at?: Date;
}
