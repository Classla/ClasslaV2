-- Migration: Add S3 buckets table for IDE container workspace storage
-- This table tracks S3 buckets created for student IDE containers
-- Run this in Supabase SQL Editor or via migration tool

CREATE TABLE IF NOT EXISTS s3_buckets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_name TEXT NOT NULL UNIQUE,
  region TEXT NOT NULL DEFAULT 'us-east-1',
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID REFERENCES courses(id) ON DELETE SET NULL,
  assignment_id UUID REFERENCES assignments(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'creating' CHECK (status IN ('creating', 'active', 'deleting', 'deleted', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  
  CONSTRAINT valid_status CHECK (status IN ('creating', 'active', 'deleting', 'deleted', 'error'))
);

-- Index for looking up buckets by user
CREATE INDEX IF NOT EXISTS idx_s3_buckets_user_id ON s3_buckets(user_id);

-- Index for looking up buckets by course
CREATE INDEX IF NOT EXISTS idx_s3_buckets_course_id ON s3_buckets(course_id) WHERE course_id IS NOT NULL;

-- Index for looking up buckets by assignment
CREATE INDEX IF NOT EXISTS idx_s3_buckets_assignment_id ON s3_buckets(assignment_id) WHERE assignment_id IS NOT NULL;

-- Index for looking up active buckets
CREATE INDEX IF NOT EXISTS idx_s3_buckets_status ON s3_buckets(status) WHERE status = 'active';

-- Index for bucket name lookups
CREATE INDEX IF NOT EXISTS idx_s3_buckets_bucket_name ON s3_buckets(bucket_name);

-- Enable Row Level Security
ALTER TABLE s3_buckets ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own buckets
CREATE POLICY "Users can view their own buckets"
  ON s3_buckets FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can create their own buckets
CREATE POLICY "Users can create their own buckets"
  ON s3_buckets FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own buckets
CREATE POLICY "Users can update their own buckets"
  ON s3_buckets FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy: Users can delete their own buckets
CREATE POLICY "Users can delete their own buckets"
  ON s3_buckets FOR DELETE
  USING (auth.uid() = user_id);

-- Comment on table
COMMENT ON TABLE s3_buckets IS 'Tracks S3 buckets created for IDE container workspaces';
COMMENT ON COLUMN s3_buckets.bucket_name IS 'Unique S3 bucket name in AWS';
COMMENT ON COLUMN s3_buckets.status IS 'Current status of the bucket lifecycle';
COMMENT ON COLUMN s3_buckets.deleted_at IS 'Timestamp when bucket deletion was initiated';
