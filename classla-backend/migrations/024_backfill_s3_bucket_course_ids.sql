-- Migration: Backfill course_id for existing template buckets
-- Template buckets need course_id so enrolled students can clone them

-- Update template buckets by finding the course_id from the assignment that references them
-- This covers IDE blocks in the template, modelSolution, and autoGrading tabs

UPDATE s3_buckets
SET course_id = (
  SELECT a.course_id
  FROM assignments a
  WHERE
    s3_buckets.is_template = true
    AND s3_buckets.course_id IS NULL
    AND (
      -- Check if this bucket is referenced in any IDE block's template tab
      a.content::text LIKE '%"s3_bucket_id":"' || s3_buckets.id || '"%'
    )
  LIMIT 1
)
WHERE
  s3_buckets.is_template = true
  AND s3_buckets.course_id IS NULL
  AND EXISTS (
    SELECT 1
    FROM assignments a
    WHERE a.content::text LIKE '%"s3_bucket_id":"' || s3_buckets.id || '"%'
  );

-- Add index on is_template for performance
CREATE INDEX IF NOT EXISTS idx_s3_buckets_is_template ON s3_buckets(is_template) WHERE is_template = true;
