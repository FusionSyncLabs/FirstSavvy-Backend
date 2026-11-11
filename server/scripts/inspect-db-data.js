require('dotenv').config();
const { createDatabasePool } = require('../config/pgPool');

async function main() {
  const pool = createDatabasePool();

  const counts = await pool.query(`
    SELECT relname AS table_name, n_live_tup::bigint AS row_estimate
    FROM pg_stat_user_tables
    WHERE schemaname = 'public'
    ORDER BY n_live_tup DESC, relname
  `);

  console.log('Row estimates (pg_stat_user_tables):');
  counts.rows.forEach((row) => {
    if (Number(row.row_estimate) > 0) {
      console.log(`  ${row.table_name}: ${row.row_estimate}`);
    }
  });

  const nonEmpty = counts.rows.filter((row) => Number(row.row_estimate) > 0);
  console.log(`\nTables with data: ${nonEmpty.length}`);

  await pool.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
