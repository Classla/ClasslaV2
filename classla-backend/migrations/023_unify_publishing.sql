-- Migration: Unify publishing into single timestamp-based system
-- Merges published_to array into scheduled_publish_map, then renames to publish_times
-- Instant publishing = past timestamp, scheduled = future timestamp

-- Step 1: Migrate data from published_to into scheduled_publish_map
-- For immediate publishes, set timestamp to the current time (they're already visible)
UPDATE assignments
SET scheduled_publish_map = (
  COALESCE(scheduled_publish_map, '{}'::jsonb) ||
  (
    SELECT COALESCE(jsonb_object_agg(user_id, NOW()::text), '{}'::jsonb)
    FROM unnest(published_to) AS user_id
    WHERE user_id IS NOT NULL
  )
)
WHERE published_to IS NOT NULL AND array_length(published_to, 1) > 0;

-- Step 2: Rename scheduled_publish_map to publish_times
ALTER TABLE assignments RENAME COLUMN scheduled_publish_map TO publish_times;

-- Step 3: Drop the old published_to column
ALTER TABLE assignments DROP COLUMN published_to;

-- Step 4: Drop old index and create new one for publish_times
DROP INDEX IF EXISTS idx_assignments_published;
CREATE INDEX idx_assignments_publish_times ON assignments USING GIN(publish_times);

-- Step 5: Update column comment
COMMENT ON COLUMN assignments.publish_times IS 'Maps user IDs to ISO 8601 timestamps. Past timestamps = immediately visible. Future timestamps = scheduled visibility.';
