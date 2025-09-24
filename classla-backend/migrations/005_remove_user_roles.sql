-- Migration: Remove roles column from users table
-- Description: Remove the roles column since we're using course_enrollments for all role management

-- Remove the roles column from users table
ALTER TABLE users DROP COLUMN IF EXISTS roles;

-- The course_enrollments table already handles all course-specific roles
-- The is_admin column in users table handles system-wide admin privileges
-- This simplifies the data model and eliminates redundancy