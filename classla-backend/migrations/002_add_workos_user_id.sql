-- Add WorkOS user ID column to users table for WorkOS integration
-- This migration adds the workos_user_id column to link WorkOS users with Supabase users

-- Add workos_user_id column to users table
ALTER TABLE users 
ADD COLUMN workos_user_id TEXT UNIQUE;

-- Add index for workos_user_id for faster lookups
CREATE INDEX idx_users_workos_user_id ON users(workos_user_id);

-- Add first_name and last_name columns to replace the generic name column
ALTER TABLE users 
ADD COLUMN first_name TEXT,
ADD COLUMN last_name TEXT;

-- Update the name column to be computed from first_name and last_name
-- Note: We keep the name column for backward compatibility but it can be deprecated later
-- For now, we'll update existing records to split name into first_name and last_name
UPDATE users 
SET 
    first_name = CASE 
        WHEN name IS NOT NULL AND position(' ' in name) > 0 
        THEN split_part(name, ' ', 1)
        ELSE name
    END,
    last_name = CASE 
        WHEN name IS NOT NULL AND position(' ' in name) > 0 
        THEN substring(name from position(' ' in name) + 1)
        ELSE NULL
    END
WHERE name IS NOT NULL;

-- Add comment to document the purpose of the workos_user_id column
COMMENT ON COLUMN users.workos_user_id IS 'WorkOS user identifier for linking WorkOS authentication with Supabase user records';
COMMENT ON COLUMN users.first_name IS 'User first name from WorkOS profile';
COMMENT ON COLUMN users.last_name IS 'User last name from WorkOS profile';