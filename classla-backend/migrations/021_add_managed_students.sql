-- Migration: Add managed student support
-- This migration adds columns to support teacher-managed student accounts
-- that use local username/password authentication instead of WorkOS

-- Add columns for managed student authentication
ALTER TABLE users
ADD COLUMN is_managed BOOLEAN DEFAULT FALSE,
ADD COLUMN username TEXT UNIQUE,
ADD COLUMN password_hash TEXT,
ADD COLUMN managed_by_id UUID REFERENCES users(id) ON DELETE SET NULL,
ADD COLUMN last_password_reset TIMESTAMP WITH TIME ZONE;

-- Add index for username lookups (login performance)
CREATE INDEX idx_users_username ON users(username) WHERE username IS NOT NULL;

-- Add index for finding students managed by a teacher
CREATE INDEX idx_users_managed_by ON users(managed_by_id) WHERE managed_by_id IS NOT NULL;

-- Add constraint: managed users must have username, password_hash, and managed_by_id
ALTER TABLE users ADD CONSTRAINT managed_user_credentials_check
CHECK (
  (is_managed = FALSE OR is_managed IS NULL) OR
  (is_managed = TRUE AND username IS NOT NULL AND password_hash IS NOT NULL AND managed_by_id IS NOT NULL)
);

-- Add comments to document the columns
COMMENT ON COLUMN users.is_managed IS 'True if this is a managed student account (local auth, not WorkOS)';
COMMENT ON COLUMN users.username IS 'Username for managed student login (must be unique)';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt password hash for managed students';
COMMENT ON COLUMN users.managed_by_id IS 'User ID of the teacher who created/manages this student';
COMMENT ON COLUMN users.last_password_reset IS 'Timestamp of last password reset by teacher';
