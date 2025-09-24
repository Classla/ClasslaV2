-- Migration: Add join_links table
-- Description: Create table for temporary join links with expiry dates

CREATE TABLE join_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_slug VARCHAR(255) NOT NULL,
    section_slug VARCHAR(255), -- Optional, for section-specific links
    expiry_date TIMESTAMP WITH TIME ZONE NOT NULL,
    created_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient lookups by course_slug
CREATE INDEX idx_join_links_course_slug ON join_links(course_slug);

-- Index for efficient lookups by expiry_date (for cleanup)
CREATE INDEX idx_join_links_expiry_date ON join_links(expiry_date);

-- Index for section-specific links
CREATE INDEX idx_join_links_section_slug ON join_links(section_slug) WHERE section_slug IS NOT NULL;