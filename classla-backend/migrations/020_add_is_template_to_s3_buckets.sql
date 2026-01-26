-- Migration: Add is_template flag to s3_buckets table
-- This flag indicates if a bucket is a template that can be cloned by enrolled users
-- Run this in Supabase SQL Editor or via migration tool

-- Add is_template column
ALTER TABLE s3_buckets 
ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE;

-- Add index for looking up template buckets
CREATE INDEX IF NOT EXISTS idx_s3_buckets_is_template ON s3_buckets(is_template) WHERE is_template = TRUE;

-- Add index for looking up template buckets by course
CREATE INDEX IF NOT EXISTS idx_s3_buckets_template_course ON s3_buckets(course_id, is_template) WHERE is_template = TRUE AND course_id IS NOT NULL;

-- Comment on column
COMMENT ON COLUMN s3_buckets.is_template IS 'Indicates if this bucket is a template that can be cloned by enrolled users';

