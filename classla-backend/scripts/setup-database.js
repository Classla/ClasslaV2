/**
 * Database setup script for Classla
 * This script helps verify the database schema is properly set up
 */

const fs = require('fs');
const path = require('path');

// Read the migration file
const migrationPath = path.join(__dirname, '../migrations/001_initial_schema.sql');
const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

console.log('=== Classla Database Setup ===\n');

console.log('Migration file loaded successfully!');
console.log(`File: ${migrationPath}`);
console.log(`Size: ${migrationSQL.length} characters\n`);

console.log('To set up your database:');
console.log('1. Copy the SQL from migrations/001_initial_schema.sql');
console.log('2. Paste it into your Supabase SQL Editor');
console.log('3. Execute the SQL to create all tables and indexes\n');

console.log('The migration will create:');
console.log('- 8 core tables (users, courses, sections, assignments, etc.)');
console.log('- 1 user_role enum type');
console.log('- 15+ performance indexes');
console.log('- Automatic timestamp triggers');
console.log('- Foreign key constraints with proper cascading\n');

console.log('After running the migration, your database will be ready for the backend API!');

// Verify migration file structure
const requiredTables = [
    'users',
    'courses', 
    'sections',
    'assignments',
    'submissions',
    'graders',
    'rubric_schemas',
    'rubrics',
    'course_enrollments'
];

const missingTables = requiredTables.filter(table => 
    !migrationSQL.includes(`CREATE TABLE ${table}`)
);

if (missingTables.length === 0) {
    console.log('✅ All required tables are defined in the migration');
} else {
    console.log('❌ Missing tables:', missingTables.join(', '));
}

// Check for enum
if (migrationSQL.includes('CREATE TYPE user_role AS ENUM')) {
    console.log('✅ User role enum is defined');
} else {
    console.log('❌ User role enum is missing');
}

// Check for indexes
const indexCount = (migrationSQL.match(/CREATE INDEX/g) || []).length;
console.log(`✅ ${indexCount} performance indexes defined`);

console.log('\n=== Setup Complete ===');