const { Pool } = require('pg');
const { env } = require('./env');

function resolveSslConfig(connectionString) {
  try {
    const url = new URL(connectionString);
    const sslMode = url.searchParams.get('sslmode');
    const isLocalHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    if (sslMode === 'disable') {
      return undefined;
    }

    if (sslMode === 'verify-full' || sslMode === 'verify-ca') {
      return { rejectUnauthorized: true };
    }

    if (sslMode === 'require' || sslMode === 'prefer' || sslMode === 'allow') {
      return { rejectUnauthorized: false };
    }

    // Remote PostgreSQL servers should always use TLS unless explicitly disabled.
    if (!isLocalHost) {
      return { rejectUnauthorized: false };
    }

    return undefined;
  } catch {
    return env.isProduction ? { rejectUnauthorized: false } : undefined;
  }
}

function createDatabasePool(connectionString = env.databaseUrl) {
  const ssl = resolveSslConfig(connectionString);

  return new Pool({
    connectionString,
    max: env.databasePoolMax,
    idleTimeoutMillis: env.databasePoolIdleMs,
    connectionTimeoutMillis: env.databaseConnectTimeoutMs,
    statement_timeout: env.databaseStatementTimeoutMs,
    allowExitOnIdle: false,
    ssl
  });
}

module.exports = {
  createDatabasePool,
  resolveSslConfig
};
