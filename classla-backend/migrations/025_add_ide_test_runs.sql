-- Migration: Add IDE test runs table for storing historical autograder results
-- This allows students to see their test run history and teachers to review attempts

-- Create the ide_test_runs table
CREATE TABLE IF NOT EXISTS ide_test_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Foreign keys
    assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL, -- References users table (text type for WorkOS user IDs)
    block_id TEXT NOT NULL, -- The IDE block ID within the assignment

    -- Optional context
    course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
    submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL,

    -- Test results
    results JSONB NOT NULL DEFAULT '[]', -- Array of individual test results
    total_points NUMERIC(10, 2) NOT NULL DEFAULT 0,
    points_earned NUMERIC(10, 2) NOT NULL DEFAULT 0,
    tests_passed INTEGER NOT NULL DEFAULT 0,
    tests_total INTEGER NOT NULL DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Container info (for debugging)
    container_id TEXT -- The container ID used for this test run
);

-- Create indexes for common query patterns
CREATE INDEX idx_ide_test_runs_assignment ON ide_test_runs(assignment_id);
CREATE INDEX idx_ide_test_runs_student ON ide_test_runs(student_id);
CREATE INDEX idx_ide_test_runs_block ON ide_test_runs(block_id);
CREATE INDEX idx_ide_test_runs_assignment_student ON ide_test_runs(assignment_id, student_id);
CREATE INDEX idx_ide_test_runs_assignment_block_student ON ide_test_runs(assignment_id, block_id, student_id);
CREATE INDEX idx_ide_test_runs_created_at ON ide_test_runs(created_at DESC);

-- Add GIN index for JSONB results field (for querying specific test outcomes)
CREATE INDEX idx_ide_test_runs_results ON ide_test_runs USING GIN(results);

-- Add comment for documentation
COMMENT ON TABLE ide_test_runs IS 'Stores historical IDE autograder test run results for students';
COMMENT ON COLUMN ide_test_runs.results IS 'JSONB array of test results: [{name, type, points, passed, output, expected, actual, error}]';
COMMENT ON COLUMN ide_test_runs.block_id IS 'The TipTap IDE block ID within the assignment content';
