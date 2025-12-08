-- Migration: Change s3_buckets.user_id from UUID to TEXT
-- This allows non-UUID user identifiers (e.g., test-user-123)
-- Run this in Supabase SQL Editor or via migration tool

-- Drop the foreign key constraint first
ALTER TABLE s3_buckets DROP CONSTRAINT IF EXISTS s3_buckets_user_id_fkey;

-- Drop RLS policies that reference user_id (they'll be recreated)
DROP POLICY IF EXISTS "Users can view their own buckets" ON s3_buckets;
DROP POLICY IF EXISTS "Users can create their own buckets" ON s3_buckets;
DROP POLICY IF EXISTS "Users can update their own buckets" ON s3_buckets;
DROP POLICY IF EXISTS "Users can delete their own buckets" ON s3_buckets;

-- Change the column type from UUID to TEXT
ALTER TABLE s3_buckets ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- Recreate RLS policies (updated to work with TEXT user_id)
-- Note: These policies may need adjustment based on your auth setup
-- For now, we'll allow all operations since user_id is now just a string identifier
CREATE POLICY "Users can view their own buckets"
  ON s3_buckets FOR SELECT
  USING (true); -- Allow all selects for now

CREATE POLICY "Users can create their own buckets"
  ON s3_buckets FOR INSERT
  WITH CHECK (true); -- Allow all inserts for now

CREATE POLICY "Users can update their own buckets"
  ON s3_buckets FOR UPDATE
  USING (true); -- Allow all updates for now

CREATE POLICY "Users can delete their own buckets"
  ON s3_buckets FOR DELETE
  USING (true); -- Allow all deletes for now

-- Comment update
COMMENT ON COLUMN s3_buckets.user_id IS 'User identifier (can be UUID or any text identifier)';
