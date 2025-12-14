-- Migration: Add template support to folders table
-- This allows folders to be associated with either courses or templates

-- Make course_id nullable (folders can belong to templates instead)
ALTER TABLE folders
  ALTER COLUMN course_id DROP NOT NULL;

-- Add template_id column
ALTER TABLE folders
  ADD COLUMN template_id UUID REFERENCES course_templates(id) ON DELETE CASCADE;

-- Add check constraint to ensure either course_id or template_id is set (but not both)
ALTER TABLE folders
  ADD CONSTRAINT folders_course_or_template_check
  CHECK (
    (course_id IS NOT NULL AND template_id IS NULL) OR
    (course_id IS NULL AND template_id IS NOT NULL)
  );

-- Create index on template_id for performance
CREATE INDEX IF NOT EXISTS idx_folders_template_id ON folders(template_id);

-- Add comment
COMMENT ON COLUMN folders.template_id IS 'References course_templates(id) when folder belongs to a template instead of a course';
