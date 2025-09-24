-- Migration: Remove name field from users table
-- The first_name and last_name fields already exist, so we just need to drop the old name column

-- Migrate existing name data to first_name (if any exists)
-- This assumes existing names are stored as first names
UPDATE users 
SET first_name = name 
WHERE name IS NOT NULL AND name != '' AND (first_name IS NULL OR first_name = '');

-- Drop the old name column
ALTER TABLE users DROP COLUMN name;