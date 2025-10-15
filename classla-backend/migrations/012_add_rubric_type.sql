-- Migration: Add type column to rubric_schemas table
-- Description: Adds a type column to support checkbox (all-or-nothing) and numerical (scale-based) rubrics
--              Also adds support for isExtraCredit flag in rubric items (stored in JSONB items field)
-- Date: 2025-01-13

-- Add type column to rubric_schemas table
ALTER TABLE rubric_schemas
ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'checkbox'
CHECK (type IN ('checkbox', 'numerical'));

-- Add comment to explain the column
COMMENT ON COLUMN rubric_schemas.type IS 'Type of rubric: checkbox (all-or-nothing) or numerical (scale-based)';

-- Add comment to explain items structure
COMMENT ON COLUMN rubric_schemas.items IS 'Array of rubric items. Each item has: title (string), points (number), isExtraCredit (boolean, optional)';

-- Update existing rubric schemas to have the default type
UPDATE rubric_schemas SET type = 'checkbox' WHERE type IS NULL;
