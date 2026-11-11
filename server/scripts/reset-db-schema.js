require('dotenv').config();
const { execSync } = require('node:child_process');
const { createDatabasePool } = require('../config/pgPool');

async function resetPublicSchema() {
  const pool = createDatabasePool();

  console.log('Resetting public schema (drops all existing tables)...');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query('GRANT ALL ON SCHEMA public TO CURRENT_USER');
  await pool.query('GRANT ALL ON SCHEMA public TO public');
  await pool.end();

  console.log('Public schema reset complete.');
}

async function main() {
  await resetPublicSchema();

  console.log('Applying Prisma migrations...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  console.log('Migration status:');
  execSync('npx prisma migrate status', { stdio: 'inherit' });
}

main().catch((error) => {
  console.error('\nSchema reset failed:', error.message);
  process.exit(1);
});
