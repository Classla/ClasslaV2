declare enum UserRole {
  INSTRUCTOR = "instructor",
  ADMIN = "admin",
  TEACHING_ASSISTANT = "teaching_assistant",
  STUDENT = "student",
  AUDIT = "audit",
}
/**
 * User Roles System Documentation
 *
 * The system uses a simple, clean approach for role management:
 *
 * 1. SYSTEM ADMIN: User.is_admin boolean flag
 *    - Simple true/false for system-wide admin privileges
 *    - Used for platform administration, not course management
 *
 * 2. COURSE-SPECIFIC ROLES: Handled via course_enrollments table
 *    - Each enrollment record has: user_id, course_id, role
 *    - Examples: user can be 'instructor' in Course A, 'student' in Course B
 *    - Query: SELECT role FROM course_enrollments WHERE user_id=? AND course_id=?
 *
 * Benefits:
 * - Simple and clean data model
 * - No redundant role storage
 * - Efficient queries for course access control
 * - Easy to manage enrollments and role changes
 * - Single source of truth for course permissions
 */
interface Course {
  id: string;
  name: string;
  description?: string;
  settings: Record<string, any>;
  thumbnail_url: string;
  summary_content: string;
  slug: string;
  created_by_id: string;
  created_at: Date;
  deleted_at?: Date;
}
interface Section {
  id: string;
  course_id: string;
  name: string;
  description?: string;
  slug: string;
}
interface User {
  id: string;
  first_name?: string;
  last_name?: string;
  is_admin: boolean;
  email: string;
  settings: Record<string, any>;
}
interface Folder {
  id: string;
  course_id: string;
  path: string[];
  name: string;
  order_index: number;
  created_at: Date;
}
/**
 * Assignment Settings stored in the settings JSONB field
 */
interface AssignmentSettings {
  allowLateSubmissions?: boolean;
  allowResubmissions?: boolean;
  showResponsesAfterSubmission?: boolean;
  [key: string]: any;
}
interface Assignment {
  id: string;
  name: string;
  course_id: string;
  settings: AssignmentSettings;
  content: string;
  published_to: string[];
  due_dates_map: Record<string, Date>;
  module_path: string[];
  is_lockdown: boolean;
  lockdown_time_map: Record<string, number>;
  order_index: number;
}
/**
 * Submission represents a student's work on an assignment
 *
 * The values field stores answers keyed by block ID (UUID):
 * - For MCQ blocks: values[blockId] = string[] (array of selected option IDs)
 * - For future block types: values[blockId] = any (type-specific data)
 *
 * Example:
 * {
 *   "550e8400-e29b-41d4-a716-446655440000": ["opt-uuid-1", "opt-uuid-2"],
 *   "6ba7b810-9dad-11d1-80b4-00c04fd430c8": ["opt-uuid-3"]
 * }
 *
 * Status values:
 * - "in-progress": Student has started but not submitted (or auto-created for grading)
 * - "submitted": Student has submitted their work
 * - "graded": Teacher has graded the submission
 * - "returned": Graded submission has been returned to student
 */
interface Submission {
  id: string;
  assignment_id: string;
  timestamp: Date;
  values: Record<string, any>;
  course_id: string;
  student_id: string;
  grader_id?: string;
  grade?: number;
  status: "submitted" | "graded" | "returned" | "in-progress";
  created_at: Date;
  updated_at: Date;
}
interface Grader {
  id: string;
  feedback: string;
  rubric_id?: string;
  raw_assignment_score: number;
  raw_rubric_score: number;
  score_modifier: string;
  reviewed_at?: Date;
  submission_id: string;
}
interface Rubric {
  id: string;
  submission_id: string;
  rubric_schema_id: string;
  values: number[];
}
interface RubricSchema {
  id: string;
  assignment_id: string;
  title: string;
  use_for_grading: boolean;
  items: RubricItem[];
}
interface RubricItem {
  title: string;
  points: number;
}
interface CourseEnrollment {
  id: string;
  user_id: string;
  course_id: string;
  section_id?: string;
  role: UserRole;
  enrolled_at: Date;
}
interface JoinLink {
  id: string;
  course_slug: string;
  section_slug?: string;
  expiry_date: Date;
  created_by_id: string;
  created_at: Date;
}
export {
  UserRole,
  Course,
  Section,
  User,
  CourseEnrollment,
  Folder,
  Assignment,
  AssignmentSettings,
  Submission,
  Grader,
  Rubric,
  RubricSchema,
  RubricItem,
  JoinLink,
};
