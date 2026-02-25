-- Migration 029: Fix folder soft-delete and unique constraint
--
-- Problem: When a folder is soft-deleted (deleted_at set), the unconditional
-- unique index on (course_id, path) still blocks creating a new folder with
-- the same path. This causes "FOLDER_ALREADY_EXISTS" errors when recreating
-- a deleted folder.
--
-- Fix:
-- 1. Add deleted_at column to folders table (if not exists)
-- 2. Replace unconditional unique index with partial unique indexes
--    that only enforce uniqueness for non-deleted folders

-- Step 1: Add deleted_at column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'folders' AND column_name = 'deleted_at'
    ) THEN
        ALTER TABLE folders ADD COLUMN deleted_at TIMESTAMP WITH TIME ZONE;
    END IF;
END $$;

-- Step 2: Drop the old unconditional unique index
DROP INDEX IF EXISTS idx_folders_unique_path_per_course;

-- Step 3: Create partial unique index for course folders (only enforced for non-deleted rows)
CREATE UNIQUE INDEX idx_folders_unique_path_per_course
    ON folders(course_id, path)
    WHERE deleted_at IS NULL AND course_id IS NOT NULL;

-- Step 4: Create partial unique index for template folders (only enforced for non-deleted rows)
CREATE UNIQUE INDEX idx_folders_unique_path_per_template
    ON folders(template_id, path)
    WHERE deleted_at IS NULL AND template_id IS NOT NULL;

-- Step 5: Add index on deleted_at for query performance
CREATE INDEX IF NOT EXISTS idx_folders_deleted_at ON folders(deleted_at);

COMMENT ON COLUMN folders.deleted_at IS 'Soft delete timestamp — NULL means active, non-NULL means deleted';
