-- Migration: Add scheduled_publish_map to assignments
-- Allows teachers to schedule when assignments become visible to specific students

ALTER TABLE assignments
ADD COLUMN scheduled_publish_map JSONB DEFAULT '{}';

-- Structure: { "user_id": "2025-02-14T09:00:00Z", ... }
-- Empty map means no scheduled publishing (use published_to for immediate visibility)
-- A student can see an assignment if:
--   1. They are in published_to (immediate), OR
--   2. They are in scheduled_publish_map AND the scheduled time has passed

COMMENT ON COLUMN assignments.scheduled_publish_map IS 'Maps user IDs to ISO 8601 timestamps for scheduled publishing. Student sees assignment when their scheduled time passes.';
