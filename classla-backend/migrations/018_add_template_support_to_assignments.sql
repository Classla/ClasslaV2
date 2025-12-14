-- Migration: Add template support to assignments table
-- This allows assignments to be associated with either courses or templates

-- Make course_id nullable (assignments can belong to templates instead)
ALTER TABLE assignments
  ALTER COLUMN course_id DROP NOT NULL;

-- Add template_id column
ALTER TABLE assignments
  ADD COLUMN template_id UUID REFERENCES course_templates(id) ON DELETE CASCADE;

-- Add check constraint to ensure either course_id or template_id is set (but not both)
ALTER TABLE assignments
  ADD CONSTRAINT assignments_course_or_template_check
  CHECK (
    (course_id IS NOT NULL AND template_id IS NULL) OR
    (course_id IS NULL AND template_id IS NOT NULL)
  );

-- Create index on template_id for performance
CREATE INDEX IF NOT EXISTS idx_assignments_template_id ON assignments(template_id);

-- Add comment
COMMENT ON COLUMN assignments.template_id IS 'References course_templates(id) when assignment belongs to a template instead of a course';
