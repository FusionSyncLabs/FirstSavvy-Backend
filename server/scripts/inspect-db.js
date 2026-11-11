require('dotenv').config();
const { createDatabasePool } = require('../config/pgPool');

async function main() {
  const pool = createDatabasePool();

  const tables = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );

  console.log(`Tables in public schema: ${tables.rows.length}`);
  tables.rows.forEach((row) => console.log(`  - ${row.tablename}`));

  const migrations = await pool.query(
    'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at'
  ).catch(() => null);

  if (migrations) {
    console.log(`\nPrisma migrations: ${migrations.rows.length}`);
    migrations.rows.forEach((row) => console.log(`  - ${row.migration_name}`));
  } else {
    console.log('\nNo _prisma_migrations table found.');
  }

  await pool.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
