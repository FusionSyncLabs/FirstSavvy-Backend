#!/usr/bin/env node
/**
 * Validates environment, checks PostgreSQL connectivity, and applies pending migrations.
 * Run from server/: npm run script:bootstrap
 */
const { execSync } = require('node:child_process');
const { createDatabasePool } = require('../config/pgPool');
require('dotenv').config();

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl?.trim()) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
  process.exit(1);
}

async function waitForDatabase(maxAttempts = 10, delayMs = 3000) {
  const pool = createDatabasePool();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      await pool.end();
      console.log('PostgreSQL connection verified.');
      return;
    } catch (error) {
      const message = error.message || String(error);
      console.warn(`Attempt ${attempt}/${maxAttempts}: database not reachable yet (${message})`);

      if (message.includes('pg_hba.conf')) {
        console.warn(
          'Hint: PostgreSQL rejected this client IP. Add your IP to pg_hba.conf / provider firewall allowlist, then retry.'
        );
      }

      if (attempt === maxAttempts) {
        await pool.end().catch(() => {});
        throw new Error(
          'Could not connect to PostgreSQL. Verify DATABASE_URL, network access, firewall rules, and SSL settings.'
        );
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

async function main() {
  console.log('Validating Prisma schema...');
  execSync('npx prisma validate', { stdio: 'inherit' });

  console.log('Waiting for PostgreSQL...');
  await waitForDatabase();

  console.log('Generating Prisma client...');
  execSync('npx prisma generate', { stdio: 'inherit' });

  console.log('Applying migrations...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });

  console.log('Seeding initial master templates and institutions...');
  execSync('node prisma/seed.js', { stdio: 'inherit' });

  console.log('Migration status:');
  execSync('npx prisma migrate status', { stdio: 'inherit' });

  console.log('\nDatabase bootstrap complete.');
}

main().catch((error) => {
  console.error('\nDatabase bootstrap failed:', error.message);
  process.exit(1);
});
