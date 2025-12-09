-- Migration: Create container_stats table for observability
-- This table tracks container lifecycle metrics for performance monitoring and debugging

CREATE TABLE IF NOT EXISTS container_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id TEXT NOT NULL,
  user_id TEXT,
  s3_bucket TEXT NOT NULL,
  request_received_at TIMESTAMPTZ NOT NULL,
  code_server_available_at TIMESTAMPTZ,
  container_stopped_at TIMESTAMPTZ,
  startup_time_ms INTEGER, -- Time from request to code-server being available (milliseconds)
  active_duration_ms INTEGER, -- Time container was active/online (milliseconds)
  shutdown_reason TEXT, -- 'manual', 'inactivity', 'error', 'resource_limit'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_container_stats_container_id ON container_stats(container_id);
CREATE INDEX IF NOT EXISTS idx_container_stats_user_id ON container_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_container_stats_request_received_at ON container_stats(request_received_at);
CREATE INDEX IF NOT EXISTS idx_container_stats_s3_bucket ON container_stats(s3_bucket);

-- Create index for querying by date range
CREATE INDEX IF NOT EXISTS idx_container_stats_created_at ON container_stats(created_at);

-- Add comment to table
COMMENT ON TABLE container_stats IS 'Tracks container lifecycle metrics: startup time, active duration, and related metadata for observability';

-- Add comments to columns
COMMENT ON COLUMN container_stats.container_id IS 'Unique container identifier';
COMMENT ON COLUMN container_stats.user_id IS 'User who requested the container (optional)';
COMMENT ON COLUMN container_stats.s3_bucket IS 'S3 bucket used to create the container';
COMMENT ON COLUMN container_stats.request_received_at IS 'Timestamp when start request was received';
COMMENT ON COLUMN container_stats.code_server_available_at IS 'Timestamp when code-server became accessible';
COMMENT ON COLUMN container_stats.container_stopped_at IS 'Timestamp when container was stopped';
COMMENT ON COLUMN container_stats.startup_time_ms IS 'Time in milliseconds from request to code-server being available';
COMMENT ON COLUMN container_stats.active_duration_ms IS 'Time in milliseconds the container was active/online';
COMMENT ON COLUMN container_stats.shutdown_reason IS 'Reason for container shutdown: manual, inactivity, error, or resource_limit';
