// User roles enum
export enum UserRole {
  INSTRUCTOR = "instructor",
  ADMIN = "admin",
  TEACHING_ASSISTANT = "teaching_assistant",
  STUDENT = "student",
  AUDIT = "audit",
}

// Organization role enum
export enum OrganizationRole {
  ADMIN = "admin",
  MEMBER = "member",
}

// TA Permissions interface
export interface TAPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canViewStudents: boolean;
  canViewGrades: boolean;
}

// Course entity
export interface Course {
  id: string;
  name: string;
  description?: string; // Short text description of the course
  settings: Record<string, any> & {
    ta_permissions_default?: TAPermissions;
    ta_permissions?: Record<string, TAPermissions>;
  };
  thumbnail_url: string;
  summary_content: string; // Rich content for course overview, objectives, and detailed information
  slug: string; // course join code, and how it will be shown in URL
  created_by_id: string; // user_id of creator
  created_at: Date;
  deleted_at?: Date;
  student_count?: number; // Number of students enrolled (role = 'student')
  is_template?: boolean; // Whether this course is a template
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

// Folder entity - represents empty folders in the module tree
export interface Folder {
  id: string;
  course_id: string;
  path: string[]; // e.g., ["unit 1", "module 1"] for "unit 1/module 1"
  name: string; // The display name of the folder (last element of path)
  order_index: number; // For ordering folders within their parent
  created_at: Date;
}

// Assignment Settings
export interface AssignmentSettings {
  allowLateSubmissions?: boolean;
  allowResubmissions?: boolean;
  showResponsesAfterSubmission?: boolean;
  showScoreAfterSubmission?: boolean; // Show autograded score to students after submission
  [key: string]: any;
}

// Assignment entity
export interface Assignment {
  id: string;
  name: string;
  course_id: string;
  settings: AssignmentSettings;
  content: string; // tiptap editor content, stores all blocks, questions, and autograder data.
  published_to: string[]; // Array of user IDs for immediate publishing
  due_dates_map: Record<string, Date>; // user_id to Date
  scheduled_publish_map?: Record<string, string>; // user_id to ISO date string for scheduled publishing
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
  status: "submitted" | "graded" | "returned" | "in-progress";
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

// Module tree structure for organizing assignments
export interface ModuleTreeNode {
  path: string[]; // e.g., ["unit 1", "module 1"]
  name: string; // The display name (last element of path)
  assignments: Assignment[];
  children: ModuleTreeNode[];
}

// Grading and Gradebook Types

// Student submission info for grading panel
// Note: latestSubmission and grader can be null for students who haven't submitted yet
export interface StudentSubmissionInfo {
  userId: string;
  firstName: string;
  lastName: string;
  sectionId: string | null;
  sectionName: string | null;
  submissions: Submission[];
  latestSubmission: Submission | null;
  grader: Grader | null;
}

// Submission with student information (API response)
// Note: submission can be null for students who haven't submitted yet
export interface SubmissionWithStudent {
  submission: Submission | null;
  student: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  grader: Grader | null;
  sectionId: string | null;
  sectionName: string | null;
}

// Student info for gradebook
export interface StudentGradebookInfo {
  userId: string;
  firstName: string;
  lastName: string;
  sectionId: string | null;
}

// Gradebook data (API response)
export interface GradebookData {
  students: StudentGradebookInfo[];
  assignments: Assignment[];
  submissions: Submission[];
  graders: Grader[];
}

// Student grades data (API response)
export interface StudentGradesData {
  assignments: Assignment[];
  submissions: Submission[];
  graders: Grader[];
}

// Create grader with submission request
export interface CreateGraderWithSubmissionRequest {
  assignmentId: string;
  studentId: string;
  courseId: string;
}

// Create grader with submission response
export interface CreateGraderWithSubmissionResponse {
  submission: Submission;
  grader: Grader;
  created: {
    submission: boolean;
    grader: boolean;
  };
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
  users?: {
    id: string;
    first_name?: string;
    last_name?: string;
    email: string;
  };
  organizations?: Organization;
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

// Autograding API types

/**
 * Autograding API Response
 *
 * Response format varies based on score visibility settings:
 * - If showScoreAfterSubmission is enabled (or requester is instructor/TA):
 *   Returns full grader object with scores
 * - If showScoreAfterSubmission is disabled (and requester is student):
 *   Returns only success status without score data
 */
export interface AutogradeResponse {
  success: boolean;
  grader?: Grader; // Present when scores are visible
  totalPossiblePoints?: number; // Present when scores are visible
  message?: string; // Present when scores are hidden
}

// Managed Student Types

/**
 * Managed Student - A student account created and managed by a teacher
 * These accounts use local username/password authentication instead of WorkOS
 */
export interface ManagedStudent {
  id: string;
  username: string;
  email: string; // Generated placeholder email
  first_name?: string;
  last_name?: string;
  is_managed: boolean;
  managed_by_id: string; // Teacher who manages this account
  last_password_reset?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Managed Student with their course enrollments
 */
export interface ManagedStudentWithEnrollments extends ManagedStudent {
  enrollments: ManagedStudentEnrollment[];
}

/**
 * Enrollment info for a managed student
 */
export interface ManagedStudentEnrollment {
  id: string;
  course_id: string;
  course_name: string;
  role: string;
  enrolled_at: string;
}

/**
 * Request to create a managed student
 */
export interface CreateManagedStudentRequest {
  username: string;
  password: string;
  firstName?: string;
  lastName?: string;
  courseId?: string; // Optional: immediately enroll in a course
}

/**
 * Request to update a managed student
 */
export interface UpdateManagedStudentRequest {
  firstName?: string;
  lastName?: string;
}

/**
 * Response from password reset
 */
export interface ResetPasswordResponse {
  success: boolean;
  temporaryPassword: string;
}
