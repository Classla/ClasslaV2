# Database Migrations

This directory contains SQL migration files for the Classla database schema.

## Files

- `001_initial_schema.sql` - Initial database schema with all core tables, enums, and indexes
- `002_add_workos_user_id.sql` - Add WorkOS user ID field for authentication
- `003_add_course_description.sql` - Add description field to courses
- `004_add_join_links.sql` - Add join links table for course enrollment
- `005_remove_user_roles.sql` - Remove deprecated user roles array
- `006_add_section_id_to_enrollments.sql` - Add section assignment to enrollments
- `007_replace_name_with_first_last_name.sql` - Split user name into first and last name
- `008_add_folders_and_assignment_ordering.sql` - Add folder support and assignment ordering
- `009_add_grading_performance_indexes.sql` - Add performance indexes for grading and gradebook features
- `010_add_block_scores_to_graders.sql` - Add block_scores JSONB column for autograding system

## Setup Instructions

### Using Supabase Dashboard

1. Log into your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the contents of `001_initial_schema.sql`
4. Execute the SQL to create all tables, indexes, and triggers

### Using Supabase CLI (Alternative)

If you have the Supabase CLI installed:

```bash
# Initialize Supabase in your project (if not already done)
supabase init

# Link to your remote project
supabase link --project-ref YOUR_PROJECT_REF

# Apply the migration
supabase db push
```

## Schema Overview

The migration creates the following tables:

- **users** - User accounts with roles and settings
- **courses** - Course definitions with metadata
- **sections** - Course sections for organization
- **assignments** - Assignment content and configuration
- **submissions** - Student assignment submissions
- **graders** - Grading feedback and scores
- **rubric_schemas** - Reusable rubric templates
- **rubrics** - Applied rubric instances
- **course_enrollments** - Many-to-many user-course relationships

## Key Features

- **UUID Primary Keys** - All tables use UUID for better scalability
- **JSONB Columns** - Flexible storage for settings and content
- **Performance Indexes** - Optimized for common query patterns
- **Automatic Timestamps** - Updated_at triggers for audit trails
- **Referential Integrity** - Foreign key constraints with cascade deletes
- **Role-Based Access** - User role enum for permission management

## Notes

- The schema is designed to work without Row Level Security (RLS) since all access goes through the backend API
- Soft deletion is implemented for courses using the `deleted_at` timestamp
- The `course_enrollments` table handles the many-to-many relationship between users and courses with role assignments
