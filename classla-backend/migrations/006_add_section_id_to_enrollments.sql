-- Migration: Add section_id to course_enrollments table
-- This allows students to be enrolled in specific sections within a course

-- Add section_id column to course_enrollments table
ALTER TABLE course_enrollments 
ADD COLUMN section_id UUID REFERENCES sections(id) ON DELETE SET NULL;

-- Add index for efficient queries by section
CREATE INDEX idx_course_enrollments_section_id ON course_enrollments(section_id);

-- Add composite index for course and section queries
CREATE INDEX idx_course_enrollments_course_section ON course_enrollments(course_id, section_id);