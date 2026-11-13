const { Pool } = require('pg');
const { env } = require('./env');

function resolveSslConfig() {
  const override = process.env.DATABASE_SSL?.trim().toLowerCase();

  if (override && override !== 'true' && override !== 'false') {
    throw new Error('DATABASE_SSL must be "true" or "false"');
  }

  const enabled = override
    ? override === 'true'
    : process.env.NODE_ENV === 'production';

  if (!enabled) {
    return false;
  }

  const ssl = { rejectUnauthorized: true };
  const ca = process.env.DATABASE_SSL_CA;

  if (ca && ca.trim()) {
    ssl.ca = ca;
  }

  return ssl;
}

function sanitizeConnectionString(connectionString) {
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    return connectionString;
  }

  const url = new URL(connectionString);

  for (const parameter of [
    'ssl',
    'sslmode',
    'sslcert',
    'sslkey',
    'sslrootcert',
    'uselibpqcompat'
  ]) {
    url.searchParams.delete(parameter);
  }

  return url.toString();
}

function createDatabasePool(connectionString = env.databaseUrl) {
  return new Pool({
    connectionString: sanitizeConnectionString(connectionString),
    max: env.databasePoolMax,
    idleTimeoutMillis: env.databasePoolIdleMs,
    connectionTimeoutMillis: env.databaseConnectTimeoutMs,
    statement_timeout: env.databaseStatementTimeoutMs,
    allowExitOnIdle: false,
    ssl: resolveSslConfig()
  });
}

module.exports = {
  createDatabasePool,
  resolveSslConfig,
  sanitizeConnectionString
};
