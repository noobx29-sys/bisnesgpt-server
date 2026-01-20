/**
 * Simple migration runner script
 * Usage: node scripts/run-migration.js migrations/add_meta_direct_fields.sql
 */

const { pool } = require('../src/config/database');
const fs = require('fs');
const path = require('path');

async function runMigration(migrationFile) {
  try {
    console.log(`Running migration: ${migrationFile}`);

    const sqlPath = path.join(__dirname, '..', migrationFile);
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Executing SQL...');
    await pool.query(sql);

    console.log('Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

const migrationFile = process.argv[2];
if (!migrationFile) {
  console.error('Usage: node scripts/run-migration.js <migration-file>');
  process.exit(1);
}

runMigration(migrationFile);
