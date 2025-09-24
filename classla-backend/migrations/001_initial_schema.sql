-- Classla LMS Initial Database Schema Migration
-- This migration creates all the core tables, enums, and indexes for the LMS system

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create user roles enum
CREATE TYPE user_role AS ENUM ('instructor', 'admin', 'teaching_assistant', 'student', 'audit');

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT,
    is_admin BOOLEAN DEFAULT FALSE,
    roles user_role[] DEFAULT '{}',
    email TEXT UNIQUE NOT NULL,
    settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Courses table
CREATE TABLE courses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    settings JSONB DEFAULT '{}',
    thumbnail_url TEXT,
    summary_content TEXT,
    slug TEXT UNIQUE NOT NULL,
    created_by_id UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deleted_at TIMESTAMP WITH TIME ZONE
);

-- Sections table
CREATE TABLE sections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    slug TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(course_id, slug)
);

-- Assignments table
CREATE TABLE assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    settings JSONB DEFAULT '{}',
    content TEXT, -- TipTap editor content
    published_to TEXT[] DEFAULT '{}',
    due_dates_map JSONB DEFAULT '{}',
    module_path TEXT[] DEFAULT '{}',
    is_lockdown BOOLEAN DEFAULT FALSE,
    lockdown_time_map JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Submissions table
CREATE TABLE submissions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    values JSONB DEFAULT '{}',
    course_id UUID REFERENCES courses(id),
    student_id UUID REFERENCES users(id),
    grader_id UUID REFERENCES users(id),
    grade NUMERIC,
    status TEXT CHECK (status IN ('submitted', 'graded', 'returned', 'in-progress')) DEFAULT 'in-progress',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Graders table
CREATE TABLE graders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    feedback TEXT,
    rubric_id UUID,
    raw_assignment_score NUMERIC NOT NULL,
    raw_rubric_score NUMERIC NOT NULL,
    score_modifier TEXT,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Rubric schemas table
CREATE TABLE rubric_schemas (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assignment_id UUID REFERENCES assignments(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    use_for_grading BOOLEAN DEFAULT FALSE,
    items JSONB NOT NULL, -- Array of RubricItem objects
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Rubrics table (instances)
CREATE TABLE rubrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    submission_id UUID REFERENCES submissions(id) ON DELETE CASCADE,
    rubric_schema_id UUID REFERENCES rubric_schemas(id),
    values NUMERIC[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Course enrollments table (many-to-many relationship between users and courses)
CREATE TABLE course_enrollments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    role user_role NOT NULL,
    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, course_id)
);

-- Performance optimization indexes
CREATE INDEX idx_courses_slug ON courses(slug);
CREATE INDEX idx_courses_created_by ON courses(created_by_id);
CREATE INDEX idx_courses_deleted_at ON courses(deleted_at);
CREATE INDEX idx_sections_course ON sections(course_id);
CREATE INDEX idx_sections_slug ON sections(course_id, slug);
CREATE INDEX idx_assignments_course ON assignments(course_id);
CREATE INDEX idx_assignments_published ON assignments USING GIN(published_to);
CREATE INDEX idx_submissions_assignment ON submissions(assignment_id);
CREATE INDEX idx_submissions_student ON submissions(student_id);
CREATE INDEX idx_submissions_course ON submissions(course_id);
CREATE INDEX idx_submissions_status ON submissions(status);
CREATE INDEX idx_graders_submission ON graders(submission_id);
CREATE INDEX idx_rubric_schemas_assignment ON rubric_schemas(assignment_id);
CREATE INDEX idx_rubrics_submission ON rubrics(submission_id);
CREATE INDEX idx_rubrics_schema ON rubrics(rubric_schema_id);
CREATE INDEX idx_enrollments_user ON course_enrollments(user_id);
CREATE INDEX idx_enrollments_course ON course_enrollments(course_id);
CREATE INDEX idx_enrollments_role ON course_enrollments(role);

-- Add updated_at trigger function for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers to relevant tables
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assignments_updated_at BEFORE UPDATE ON assignments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_submissions_updated_at BEFORE UPDATE ON submissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rubrics_updated_at BEFORE UPDATE ON rubrics
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();