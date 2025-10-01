-- Migration: Add order field to assignments table
-- This allows assignments to be reordered within their module/folder

-- Add the order column to assignments table
ALTER TABLE assignments 
ADD COLUMN "order" INTEGER NOT NULL DEFAULT 0;

-- Create an index on the order column for better performance when sorting
CREATE INDEX idx_assignments_order ON assignments("order");

-- Create a composite index on course_id and order for efficient course-level sorting
CREATE INDEX idx_assignments_course_order ON assignments(course_id, "order");

-- Update existing assignments to have sequential global order values
-- This ensures existing assignments have proper order values across the entire course
WITH ordered_assignments AS (
  SELECT 
    id,
    ROW_NUMBER() OVER (
      PARTITION BY course_id 
      ORDER BY 
        CASE WHEN array_length(module_path, 1) IS NULL THEN 0 ELSE array_length(module_path, 1) END,
        module_path,
        created_at
    ) * 10 as new_order
  FROM assignments
)
UPDATE assignments 
SET "order" = ordered_assignments.new_order
FROM ordered_assignments
WHERE assignments.id = ordered_assignments.id;

-- Add a comment to document the column
COMMENT ON COLUMN assignments."order" IS 'Global order of assignment within the course for tree sorting. Higher numbers appear later in the tree structure.';