-- Add block_id column to s3_buckets for per-IDE-block bucket isolation
-- When a lesson has multiple IDE blocks, each needs its own S3 bucket per student
ALTER TABLE s3_buckets ADD COLUMN IF NOT EXISTS block_id TEXT;

-- Index for efficient lookups by (assignment_id, user_id, block_id)
CREATE INDEX IF NOT EXISTS idx_s3_buckets_block ON s3_buckets(assignment_id, user_id, block_id);
