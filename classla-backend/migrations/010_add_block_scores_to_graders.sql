-- Add block_scores column to graders table for autograding system
-- This column stores per-block scoring information for MCQ questions

-- Add block_scores JSONB column to graders table
ALTER TABLE graders
ADD COLUMN block_scores JSONB;

-- Add comment explaining the JSON structure
COMMENT ON COLUMN graders.block_scores IS 'JSON object storing per-block scores: { [blockId]: { awarded: number, possible: number } }. Used by autograding system to track individual question scores.';

-- Create GIN index on block_scores for future analytics queries
-- GIN indexes are optimized for JSONB data and allow efficient querying of JSON content
CREATE INDEX idx_graders_block_scores ON graders USING GIN (block_scores);
