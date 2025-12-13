-- Migration: Add TA permissions system to courses.settings
-- This migration adds support for configurable TA permissions with defaults and individual overrides
-- Run this in Supabase SQL Editor or via migration tool

-- No schema changes needed - permissions are stored in courses.settings JSONB field
-- The structure will be:
-- {
--   "ta_permissions_default": {
--     "canCreate": false,
--     "canEdit": false,
--     "canDelete": false,
--     "canViewStudents": false,
--     "canViewGrades": false
--   },
--   "ta_permissions": {
--     "user_id": {
--       "canCreate": bool,
--       "canEdit": bool,
--       "canDelete": bool,
--       "canViewStudents": bool,
--       "canViewGrades": bool
--     }
--   }
-- }

-- This migration is informational - the JSONB structure will be created automatically
-- when instructors configure TA permissions through the UI. Existing courses will
-- have no TA permissions configured, which means all TAs will have restrictive
-- permissions (all false) by default, maintaining current behavior.

COMMENT ON COLUMN courses.settings IS 'Course settings including ta_permissions_default and ta_permissions for TA permission management';

