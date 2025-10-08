-- Migration: Add unique constraint on submission_id in graders table
-- This prevents duplicate grader records for the same submission
-- Addresses race condition when autograding is triggered multiple times

-- First, clean up any duplicate graders (keep the most recent one for each submission)
DELETE FROM graders
WHERE id NOT IN (
    SELECT DISTINCT ON (submission_id) id
    FROM graders
    ORDER BY submission_id, created_at DESC
);

-- Add unique constraint to prevent future duplicates
ALTER TABLE graders
ADD CONSTRAINT graders_submission_id_unique UNIQUE (submission_id);

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT graders_submission_id_unique ON graders IS 
'Ensures only one grader record exists per submission to prevent race conditions during autograding';
