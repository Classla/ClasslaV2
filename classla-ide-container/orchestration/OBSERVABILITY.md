# Container Observability

This document describes the observability features added to track container lifecycle metrics.

## Overview

The system now tracks detailed metrics about container lifecycle events:
- **Request received**: When a start request is received
- **Code-server available**: When code-server becomes accessible (startup time)
- **Container stopped**: When container is stopped (active duration)
- **User tracking**: Optional user ID who requested the container
- **S3 bucket**: Which S3 bucket was used

## Database Schema

A new `container_stats` table has been created in Supabase with the following schema:

```sql
CREATE TABLE container_stats (
  id UUID PRIMARY KEY,
  container_id TEXT NOT NULL,
  user_id TEXT,
  s3_bucket TEXT NOT NULL,
  request_received_at TIMESTAMPTZ NOT NULL,
  code_server_available_at TIMESTAMPTZ,
  container_stopped_at TIMESTAMPTZ,
  startup_time_ms INTEGER, -- Time from request to code-server available
  active_duration_ms INTEGER, -- Time container was active
  shutdown_reason TEXT, -- 'manual', 'inactivity', 'error', 'resource_limit'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

## Setup

### 1. Run the Migration

Execute the SQL migration in Supabase:

```bash
# The migration file is located at:
migrations/001_create_container_stats.sql
```

### 2. Configure Environment Variables

Add the following environment variables to your `.env` file:

```bash
# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

**Note**: Use the service role key (not the anon key) as this needs to write to the database without RLS restrictions.

### 3. Optional: User ID in Requests

When starting a container, you can optionally include a `userId` in the request body:

```json
{
  "s3Bucket": "my-bucket",
  "userId": "user-123"  // Optional
}
```

## Metrics Tracked

### Startup Time (`startup_time_ms`)

The time from when the start request is received until code-server becomes accessible. This is calculated automatically when the first successful health check occurs.

### Active Duration (`active_duration_ms`)

The time the container was active/online, calculated from when code-server became available until the container was stopped.

### Shutdown Reasons

- `manual`: Container was stopped via DELETE request
- `inactivity`: Container shut down due to inactivity timeout
- `error`: Container failed (future use)
- `resource_limit`: Container stopped due to resource limits (future use)

## Implementation Details

### ContainerStatsService

The `ContainerStatsService` handles all database writes to Supabase. It:
- Gracefully handles missing Supabase credentials (logs warning, continues without tracking)
- Records request received immediately when container is created
- Records code-server availability on first successful health check
- Records container stopped with calculated duration

### Integration Points

1. **Container Start** (`routes/containers.ts`):
   - Records request received with user ID and S3 bucket

2. **Health Monitor** (`services/healthMonitor.ts`):
   - Records code-server availability on first successful health check
   - Tracks which containers have already been recorded to avoid duplicates

3. **Container Stop** (`routes/containers.ts`):
   - Records container stopped with shutdown reason
   - Calculates active duration automatically

## Querying Stats

Example queries you can run in Supabase:

### Average Startup Time
```sql
SELECT AVG(startup_time_ms) as avg_startup_ms
FROM container_stats
WHERE startup_time_ms IS NOT NULL;
```

### Containers by User
```sql
SELECT user_id, COUNT(*) as container_count, AVG(startup_time_ms) as avg_startup
FROM container_stats
WHERE user_id IS NOT NULL
GROUP BY user_id;
```

### Recent Container Activity
```sql
SELECT 
  container_id,
  s3_bucket,
  startup_time_ms,
  active_duration_ms,
  shutdown_reason,
  request_received_at
FROM container_stats
ORDER BY request_received_at DESC
LIMIT 100;
```

### Failed Startups (no code-server available)
```sql
SELECT 
  container_id,
  s3_bucket,
  request_received_at,
  code_server_available_at
FROM container_stats
WHERE code_server_available_at IS NULL
ORDER BY request_received_at DESC;
```

## Troubleshooting

### Stats Not Being Recorded

1. Check that Supabase credentials are set in environment variables
2. Verify the migration has been run in Supabase
3. Check application logs for errors from `ContainerStatsService`
4. Ensure the service role key has write permissions

### Missing Code-Server Availability Times

If `code_server_available_at` is NULL, it means:
- The container never passed a health check
- The container was stopped before code-server became available
- There was an error recording the availability

Check the health monitor logs to see if health checks are passing.
