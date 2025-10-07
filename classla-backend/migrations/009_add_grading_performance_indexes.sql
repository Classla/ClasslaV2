-- Add performance indexes for grading and gradebook queries
-- These indexes optimize the grading panel and gradebook features

-- Note: Most of these indexes already exist from the initial schema (001_initial_schema.sql)
-- This migration ensures they exist and documents their importance for grading features

-- Index on submissions.assignment_id for fetching all submissions for an assignment
-- Used by: GET /api/submissions/by-assignment/:assignmentId/with-students
CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON submissions(assignment_id);

-- Index on submissions.student_id for fetching all submissions by a student
-- Used by: GET /api/courses/:courseId/grades/student
CREATE INDEX IF NOT EXISTS idx_submissions_student ON submissions(student_id);

-- Index on submissions.course_id for fetching all submissions in a course
-- Used by: GET /api/courses/:courseId/gradebook
CREATE INDEX IF NOT EXISTS idx_submissions_course ON submissions(course_id);

-- Index on graders.submission_id for joining grader data with submissions
-- Used by: All grading endpoints that need to fetch feedback and scores
CREATE INDEX IF NOT EXISTS idx_graders_submission ON graders(submission_id);

-- Composite index for common query pattern: fetching submissions by assignment and student
-- This optimizes queries that filter by both assignment and student
CREATE INDEX IF NOT EXISTS idx_submissions_assignment_student ON submissions(assignment_id, student_id);

-- Composite index for fetching submissions by course and status
-- This optimizes gradebook queries that need to filter by submission status
CREATE INDEX IF NOT EXISTS idx_submissions_course_status ON submissions(course_id, status);
