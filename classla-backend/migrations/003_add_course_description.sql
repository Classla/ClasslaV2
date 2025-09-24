-- Migration: Add description column to courses table
-- This migration adds a description field to distinguish between course description and summary content

-- Add description column to courses table
ALTER TABLE courses ADD COLUMN description TEXT;

-- Add comment to clarify the difference between description and summary_content
COMMENT ON COLUMN courses.description IS 'Short text description of the course';
COMMENT ON COLUMN courses.summary_content IS 'Rich content for course overview, objectives, and detailed information';