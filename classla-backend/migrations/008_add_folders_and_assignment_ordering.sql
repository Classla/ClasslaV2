-- Migration 008: Add folders table and assignment ordering
-- This migration adds support for empty folders in the module tree
-- and ordering for both folders and assignments

-- Create folders table
CREATE TABLE folders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    path TEXT[] NOT NULL, -- Array of path segments, e.g., ['unit 1', 'module 1']
    name TEXT NOT NULL, -- Display name (should match last element of path)
    order_index INTEGER NOT NULL DEFAULT 0, -- For ordering within parent
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add order_index to assignments table
ALTER TABLE assignments 
ADD COLUMN order_index INTEGER NOT NULL DEFAULT 0;

-- Create indexes for performance
CREATE INDEX idx_folders_course_id ON folders(course_id);
CREATE INDEX idx_folders_path ON folders USING GIN(path);
CREATE INDEX idx_folders_order ON folders(course_id, order_index);
CREATE INDEX idx_assignments_order ON assignments(course_id, order_index);

-- Create a unique constraint to prevent duplicate folder paths within a course
CREATE UNIQUE INDEX idx_folders_unique_path_per_course ON folders(course_id, path);

-- Add comments for documentation
COMMENT ON TABLE folders IS 'Represents empty folders in the module tree structure';
COMMENT ON COLUMN folders.path IS 'Array of path segments representing the folder hierarchy';
COMMENT ON COLUMN folders.name IS 'Display name of the folder (should match last element of path)';
COMMENT ON COLUMN folders.order_index IS 'Used for ordering folders within their parent directory';
COMMENT ON COLUMN assignments.order_index IS 'Used for ordering assignments within their module';