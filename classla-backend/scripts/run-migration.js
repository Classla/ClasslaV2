/**
 * Migration display script for Classla
 * This script displays migration SQL for manual execution in Supabase
 */

const fs = require('fs');
const path = require('path');

function displayMigration(migrationFile) {
  try {
    const migrationPath = path.join(__dirname, '../migrations', migrationFile);
    
    if (!fs.existsSync(migrationPath)) {
      console.error(`Migration file not found: ${migrationFile}`);
      process.exit(1);
    }

    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('='.repeat(60));
    console.log(`MIGRATION: ${migrationFile}`);
    console.log('='.repeat(60));
    console.log();
    console.log('Copy the SQL below and paste it into your Supabase SQL Editor:');
    console.log();
    console.log('-'.repeat(60));
    console.log(migrationSQL);
    console.log('-'.repeat(60));
    console.log();
    console.log('After executing the SQL in Supabase, the migration will be complete.');
    console.log();
    
  } catch (error) {
    console.error('Error reading migration file:', error);
    process.exit(1);
  }
}

// Get migration file from command line argument
const migrationFile = process.argv[2];

if (!migrationFile) {
  console.log('Usage: node run-migration.js <migration-file>');
  console.log('Example: node run-migration.js 004_add_join_links.sql');
  console.log();
  console.log('Available migrations:');
  const migrationsDir = path.join(__dirname, '../migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql'));
  files.forEach(file => console.log(`  - ${file}`));
  process.exit(1);
}

displayMigration(migrationFile);