-- 1. System-wide key-value settings table
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_by_id UUID REFERENCES users(id)
);

-- 2. Mark courses as official
ALTER TABLE courses ADD COLUMN is_official BOOLEAN DEFAULT FALSE;
CREATE INDEX idx_courses_is_official ON courses(is_official) WHERE is_official = TRUE;
