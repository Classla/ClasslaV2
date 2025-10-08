// User roles enum - defines the possible roles a user can have in a course
enum UserRole {
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

// Course entity
interface Course {
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
interface Section {
  id: string;
  course_id: string;
  name: string;
  description?: string;
  slug: string; // sections are joined with code `${course_slug}-${section_slug}`
}

// User entity
interface User {
  id: string;
  first_name?: string;
  last_name?: string;
  is_admin: boolean; // System-wide admin flag
  email: string;
  settings: Record<string, any>;
}

// Folder entity - represents empty folders in the module tree
interface Folder {
  id: string;
  course_id: string;
  path: string[]; // e.g., ["unit 1", "module 1"] for "unit 1/module 1"
  name: string; // The display name of the folder (last element of path)
  order_index: number; // For ordering folders within their parent
  created_at: Date;
}

/**
 * Assignment Settings stored in the settings JSONB field
 */
interface AssignmentSettings {
  allowLateSubmissions?: boolean; // Allow submissions after due date
  allowResubmissions?: boolean; // Allow students to resubmit (creates new submission)
  showResponsesAfterSubmission?: boolean; // Show student their answers after submitting
  showScoreAfterSubmission?: boolean; // Show autograded score to students after submission
  [key: string]: any; // Allow other settings
}

// Assignment entity
interface Assignment {
  id: string;
  name: string;
  course_id: string;
  settings: AssignmentSettings;
  content: string; // tiptap editor content, stores all blocks, questions, and autograder data.
  published_to: string[]; // Array of course/section IDs
  due_dates_map: Record<string, Date>; // user_id to Date
  module_path: string[]; // e.g., ["unit 1", "module 1"] for "unit 1/module 1"
  is_lockdown: boolean;
  lockdown_time_map: Record<string, number>; // user_id to number in seconds
  order_index: number; // For ordering assignments within their module
}

// Submission entity
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
  values: Record<string, any>; // block_id (UUID) -> answer value
  course_id: string;
  student_id: string;
  grader_id?: string;
  grade?: number;
  status: "submitted" | "graded" | "returned" | "in-progress";
  created_at: Date;
  updated_at: Date;
}

/**
 * Block Score - represents the score for a single MCQ block
 */
interface BlockScore {
  awarded: number; // Points awarded for this block
  possible: number; // Total possible points for this block
}

// Grader entity (feedback and grading info)
interface Grader {
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
interface Rubric {
  id: string;
  submission_id: string;
  rubric_schema_id: string; // Reference to RubricSchema
  values: number[]; // Scores for each rubric item
}

// Rubric schema (template/definition)
interface RubricSchema {
  id: string;
  assignment_id: string;
  title: string;
  use_for_grading: boolean;
  items: RubricItem[];
}

// Individual rubric item
interface RubricItem {
  title: string;
  points: number;
}

// Course Enrollment entity (handles course-specific roles)
interface CourseEnrollment {
  id: string;
  user_id: string;
  course_id: string;
  section_id?: string; // Optional - if provided, user is enrolled in specific section
  role: UserRole; // User's role in this specific course
  enrolled_at: Date;
}

// Join Link entity
interface JoinLink {
  id: string;
  course_slug: string;
  section_slug?: string; // Optional - if provided, joins to specific section
  expiry_date: Date;
  created_by_id: string;
  created_at: Date;
}

/**
 * Autograding API Response
 *
 * Response format varies based on score visibility settings:
 * - If showScoreAfterSubmission is enabled (or requester is instructor/TA):
 *   Returns full grader object with scores
 * - If showScoreAfterSubmission is disabled (and requester is student):
 *   Returns only success status without score data
 */
interface AutogradeResponse {
  success: boolean;
  grader?: Grader; // Present when scores are visible
  totalPossiblePoints?: number; // Present when scores are visible
  message?: string; // Present when scores are hidden
}

// Export all types
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
  BlockScore,
  Rubric,
  RubricSchema,
  RubricItem,
  JoinLink,
  AutogradeResponse,
};
