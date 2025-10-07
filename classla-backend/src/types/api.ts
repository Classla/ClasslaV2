import {
  UserRole,
  Course,
  Section,
  User,
  Assignment,
  Submission,
  Grader,
  Rubric,
  RubricSchema,
} from "./entities";

// Generic API response wrapper
export interface ApiResponse<T> {
  data: T;
  success: boolean;
  message?: string;
}

// Error response format
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
  path: string;
}

// Authentication context
export interface AuthContext {
  userId: string;
  userRoles: UserRole[];
  isAdmin: boolean;
}

// Course API types
export interface CreateCourseRequest {
  name: string;
  settings?: Record<string, any>;
  thumbnail_url?: string;
  summary_content?: string;
  slug: string;
}

export interface UpdateCourseRequest {
  name?: string;
  settings?: Record<string, any>;
  thumbnail_url?: string;
  summary_content?: string;
  slug?: string;
}

export interface CourseResponse extends Course {
  // Additional computed fields can be added here
}

// Section API types
export interface CreateSectionRequest {
  course_id: string;
  name: string;
  description?: string;
  slug: string;
}

export interface UpdateSectionRequest {
  name?: string;
  description?: string;
  slug?: string;
}

export interface SectionResponse extends Section {
  // Additional computed fields can be added here
}

// User API types
export interface UpdateUserRequest {
  first_name?: string;
  last_name?: string;
  settings?: Record<string, any>;
}

export interface UserResponse extends User {
  // Additional computed fields can be added here
}

export interface EnrollUserRequest {
  user_id: string;
  course_id: string;
  role: UserRole;
}

// Assignment API types
export interface CreateAssignmentRequest {
  name: string;
  course_id: string;
  settings?: Record<string, any>;
  content: string;
  published_to?: string[];
  due_dates_map?: Record<string, Date>;
  module_path?: string[];
  is_lockdown?: boolean;
  lockdown_time_map?: Record<string, number>;
}

export interface UpdateAssignmentRequest {
  name?: string;
  settings?: Record<string, any>;
  content?: string;
  published_to?: string[];
  due_dates_map?: Record<string, Date>;
  module_path?: string[];
  is_lockdown?: boolean;
  lockdown_time_map?: Record<string, number>;
}

export interface AssignmentResponse extends Assignment {
  // Additional computed fields can be added here
}

// Student view of assignment (filtered content)
export interface StudentAssignmentResponse {
  id: string;
  name: string;
  course_id: string;
  settings: Record<string, any>;
  content: string; // Filtered content without autograder data
  published_to: string[];
  due_dates_map: Record<string, Date>;
  module_path: string[];
  is_lockdown: boolean;
  lockdown_time_map: Record<string, number>;
}

// Submission API types
export interface CreateSubmissionRequest {
  assignment_id: string;
  values: Record<string, any>;
  course_id: string;
}

export interface UpdateSubmissionRequest {
  values?: Record<string, any>;
}

export interface GradeSubmissionRequest {
  grade: number;
  grader_id: string;
}

export interface SubmissionResponse extends Submission {
  // Additional computed fields can be added here
}

// Grader API types
export interface CreateGraderRequest {
  feedback: string;
  rubric_id?: string;
  raw_assignment_score: number;
  raw_rubric_score: number;
  score_modifier: string;
  submission_id: string;
}

export interface UpdateGraderRequest {
  feedback?: string;
  rubric_id?: string;
  raw_assignment_score?: number;
  raw_rubric_score?: number;
  score_modifier?: string;
}

export interface GraderResponse extends Grader {
  // Additional computed fields can be added here
}

// Auto-creation API types
export interface CreateGraderWithSubmissionRequest {
  assignmentId: string;
  studentId: string;
  courseId: string;
}

export interface CreateGraderWithSubmissionResponse {
  submission: Submission;
  grader: Grader;
  created: {
    submission: boolean;
    grader: boolean;
  };
}

// Rubric API types
export interface CreateRubricSchemaRequest {
  assignment_id: string;
  title: string;
  use_for_grading?: boolean;
  items: Array<{
    title: string;
    points: number;
  }>;
}

export interface RubricSchemaResponse extends RubricSchema {
  // Additional computed fields can be added here
}

export interface CreateRubricRequest {
  submission_id: string;
  rubric_schema_id: string;
  values: number[];
}

export interface UpdateRubricRequest {
  values?: number[];
}

export interface RubricResponse extends Rubric {
  // Additional computed fields can be added here
}

// Batch request types
export interface BatchGetRequest {
  ids: string[];
}

export interface BatchGetBySlugRequest {
  slugs: string[];
}

// Permission checking types
export interface CoursePermissions {
  canRead: boolean;
  canWrite: boolean;
  canGrade: boolean;
  canManage: boolean;
}

export interface UserRoleInCourseResponse {
  user_id: string;
  course_id: string;
  role: UserRole;
  permissions: CoursePermissions;
}

// Grading and Gradebook API types

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
