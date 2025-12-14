-- Migration: Add organizations and course templates support
-- This migration adds support for organizations with join codes, organization memberships,
-- and course templates as specified in issue #37
-- Run this in Supabase SQL Editor or via migration tool

-- Create organization role enum
CREATE TYPE organization_role AS ENUM ('admin', 'member');

-- Organizations table
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL, -- Join code (similar to course slugs)
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Organization memberships table
CREATE TABLE organization_memberships (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role organization_role NOT NULL,
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- Course templates table
CREATE TABLE course_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    created_by_id UUID REFERENCES users(id),
    settings JSONB DEFAULT '{}',
    thumbnail_url TEXT,
    summary_content TEXT,
    slug TEXT, -- For internal reference/URLs
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Performance optimization indexes
CREATE INDEX idx_organizations_slug ON organizations(slug);
CREATE INDEX idx_organizations_created_by ON organizations(created_by_id);
CREATE INDEX idx_organization_memberships_organization ON organization_memberships(organization_id);
CREATE INDEX idx_organization_memberships_user ON organization_memberships(user_id);
CREATE INDEX idx_organization_memberships_role ON organization_memberships(role);
CREATE INDEX idx_course_templates_organization ON course_templates(organization_id);
CREATE INDEX idx_course_templates_created_by ON course_templates(created_by_id);
CREATE INDEX idx_course_templates_slug ON course_templates(slug) WHERE slug IS NOT NULL;
CREATE INDEX idx_course_templates_deleted_at ON course_templates(deleted_at);

-- Add updated_at triggers for organizations and course_templates
CREATE TRIGGER update_organizations_updated_at BEFORE UPDATE ON organizations
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_course_templates_updated_at BEFORE UPDATE ON course_templates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE organizations IS 'Organizations that house course templates and manage instructor accounts';
COMMENT ON COLUMN organizations.slug IS 'Unique join code for the organization (similar to course slugs)';
COMMENT ON TABLE organization_memberships IS 'Many-to-many relationship between users and organizations with admin/member roles';
COMMENT ON COLUMN organization_memberships.role IS 'Role in the organization: admin (can manage members and delete any templates) or member (can create/clone templates, delete own templates)';
COMMENT ON TABLE course_templates IS 'Course templates that belong to organizations and can be cloned into new courses';
COMMENT ON COLUMN course_templates.organization_id IS 'Organization that owns this template';
COMMENT ON COLUMN course_templates.created_by_id IS 'User who created this template (for permission checks)';
COMMENT ON COLUMN course_templates.deleted_at IS 'Soft delete timestamp for templates';
