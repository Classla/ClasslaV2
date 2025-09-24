// User roles enum
export enum UserRole {
  INSTRUCTOR = "instructor",
  ADMIN = "admin",
  TEACHING_ASSISTANT = "teaching_assistant",
  STUDENT = "student",
  AUDIT = "audit",
}

// Course entity
export interface Course {
  id: string;
  name: string;
  description?: string; // Short text description of the course
  settings: Record<string, any>; // Generic settings object
  thumbnail_url: string;
  summary_content: string; // Rich content for course overview, objectives, and detailed information
  slug: string; // course join code, and how it will be shown in URL
  created_by_id: string; // user_id of creator
  created_at: Date;
  deleted_at?: Date;
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
  first_name?: string;
  last_name?: string;
  is_admin: boolean; // System-wide admin flag
  email: string;
  settings: Record<string, any>;
}

// Assignment entity
export interface Assignment {
  id: string;
  name: string;
  course_id: string;
  settings: Record<string, any>;
  content: string; // tiptap editor content, stores all blocks, questions, and autograder data.
  published_to: string[]; // Array of course/section IDs
  due_dates_map: Record<string, Date>; // user_id to Date
  module_path: string[]; // e.g., ["unit 1", "module 1"] for "unit 1/module 1"
  is_lockdown: boolean;
  lockdown_time_map: Record<string, number>; // user_id to number in seconds
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
  status: "submitted" | "graded" | "returned" | "in-progress";
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
}

// Rubric instance (actual scores for a submission)
export interface Rubric {
  id: string;
  submission_id: string;
  rubric_schema_id: string; // Reference to RubricSchema
  values: number[]; // Scores for each rubric item
}

// Rubric schema (template/definition)
export interface RubricSchema {
  id: string;
  assignment_id: string;
  title: string;
  use_for_grading: boolean;
  items: RubricItem[];
}

// Individual rubric item
export interface RubricItem {
  title: string;
  points: number;
}

// Course Enrollment entity (handles course-specific roles)
export interface CourseEnrollment {
  id: string;
  user_id: string;
  course_id: string;
  section_id?: string; // Optional - if provided, user is enrolled in specific section
  role: UserRole; // User's role in this specific course
  enrolled_at: Date;
}

// Join Link entity
export interface JoinLink {
  id: string;
  course_slug: string;
  section_slug?: string; // Optional - if provided, joins to specific section
  expiry_date: Date;
  created_by_id: string;
  created_at: Date;
}
