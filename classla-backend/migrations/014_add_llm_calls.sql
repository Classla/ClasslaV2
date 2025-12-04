-- Migration: Add llm_calls table for observability
-- This table tracks all LLM API calls for monitoring and debugging
-- Run this in Supabase SQL Editor or via migration tool

CREATE TABLE IF NOT EXISTS llm_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL,
  llm_response TEXT,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error TEXT,
  request_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for looking up calls by assignment
CREATE INDEX IF NOT EXISTS idx_llm_calls_assignment_id ON llm_calls(assignment_id);

-- Index for looking up calls by user
CREATE INDEX IF NOT EXISTS idx_llm_calls_user_id ON llm_calls(user_id);

-- Index for looking up calls by course
CREATE INDEX IF NOT EXISTS idx_llm_calls_course_id ON llm_calls(course_id);

-- Index for looking up calls by request_id
CREATE INDEX IF NOT EXISTS idx_llm_calls_request_id ON llm_calls(request_id) WHERE request_id IS NOT NULL;

-- Index for looking up failed calls
CREATE INDEX IF NOT EXISTS idx_llm_calls_success ON llm_calls(success) WHERE success = FALSE;

-- Index for looking up calls by creation time
CREATE INDEX IF NOT EXISTS idx_llm_calls_created_at ON llm_calls(created_at DESC);

-- Enable Row Level Security
ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own LLM calls
CREATE POLICY "Users can view their own LLM calls"
  ON llm_calls FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Service role can insert LLM calls (for backend logging)
CREATE POLICY "Service role can insert LLM calls"
  ON llm_calls FOR INSERT
  WITH CHECK (true);

-- Policy: Service role can update LLM calls (for updating response/error)
CREATE POLICY "Service role can update LLM calls"
  ON llm_calls FOR UPDATE
  USING (true);

-- Comment on table
COMMENT ON TABLE llm_calls IS 'Tracks all LLM API calls for observability and debugging';
COMMENT ON COLUMN llm_calls.prompt IS 'The user prompt sent to the LLM';
COMMENT ON COLUMN llm_calls.llm_response IS 'The full response from the LLM (may be truncated for large responses)';
COMMENT ON COLUMN llm_calls.success IS 'Whether the LLM call completed successfully';
COMMENT ON COLUMN llm_calls.error IS 'Error message if the call failed';
COMMENT ON COLUMN llm_calls.request_id IS 'Unique request identifier for tracking streaming requests';

