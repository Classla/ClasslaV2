declare enum UserRole {
  INSTRUCTOR = "instructor",
  ADMIN = "admin",
  TEACHING_ASSISTANT = "teaching_assistant",
  STUDENT = "student",
  AUDIT = "audit",
}
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
  name?: string;
  is_admin: boolean;
  email: string;
  settings: Record<string, any>;
}
interface Assignment {
  id: string;
  name: string;
  course_id: string;
  settings: Record<string, any>;
  content: string;
  published_to: string[];
  due_dates_map: Record<string, Date>;
  module_path: string[];
  is_lockdown: boolean;
  lockdown_time_map: Record<string, number>;
}
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
  Assignment,
  Submission,
  Grader,
  Rubric,
  RubricSchema,
  RubricItem,
  JoinLink,
};
//# sourceMappingURL=data_models.d.ts.map
