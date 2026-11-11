const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { env } = require('./env');
const { createDatabasePool } = require('./pgPool');

let pool;
let prisma;

function getPool() {
  if (!pool) {
    pool = createDatabasePool();

    pool.on('error', (error) => {
      console.error('Unexpected PostgreSQL pool error:', error);
    });
  }

  return pool;
}

function getPrisma() {
  if (!prisma) {
    const adapter = new PrismaPg(getPool());

    prisma = new PrismaClient({
      adapter,
      log: ['warn', 'error']
    });
  }

  return prisma;
}

async function connectDatabase() {
  const client = getPool();
  await client.query('SELECT 1');
  await getPrisma().$connect();
}

async function disconnectDatabase() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = undefined;
  }

  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

async function checkDatabaseHealth() {
  const client = getPool();
  const result = await client.query('SELECT 1 AS ok');
  return result.rows[0]?.ok === 1;
}

module.exports = {
  get prisma() {
    return getPrisma();
  },
  getPool,
  connectDatabase,
  disconnectDatabase,
  checkDatabaseHealth
};
