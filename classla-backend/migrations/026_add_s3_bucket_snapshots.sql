-- Add snapshot support to s3_buckets
-- Snapshot buckets are read-only copies created when a student submits an assignment,
-- preserving the exact state of their code at submission time.

ALTER TABLE s3_buckets ADD COLUMN IF NOT EXISTS submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL;
ALTER TABLE s3_buckets ADD COLUMN IF NOT EXISTS is_snapshot BOOLEAN DEFAULT false;

-- Index for efficiently looking up snapshot buckets by submission
CREATE INDEX IF NOT EXISTS idx_s3_buckets_submission ON s3_buckets(submission_id) WHERE submission_id IS NOT NULL;
