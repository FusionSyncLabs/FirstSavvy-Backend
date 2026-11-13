process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/database_ssl_test';

const assert = require('node:assert/strict');
const { afterEach, test } = require('node:test');
const { resolveSslConfig, sanitizeConnectionString } = require('../config/pgPool');

const originalEnvironment = {
  nodeEnv: process.env.NODE_ENV,
  databaseSsl: process.env.DATABASE_SSL,
  databaseSslCa: process.env.DATABASE_SSL_CA
};

afterEach(() => {
  if (originalEnvironment.nodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalEnvironment.nodeEnv;
  }

  if (originalEnvironment.databaseSsl === undefined) {
    delete process.env.DATABASE_SSL;
  } else {
    process.env.DATABASE_SSL = originalEnvironment.databaseSsl;
  }

  if (originalEnvironment.databaseSslCa === undefined) {
    delete process.env.DATABASE_SSL_CA;
  } else {
    process.env.DATABASE_SSL_CA = originalEnvironment.databaseSslCa;
  }
});

test('production defaults to verified TLS even when the URL says require', () => {
  process.env.NODE_ENV = 'production';
  delete process.env.DATABASE_SSL;
  delete process.env.DATABASE_SSL_CA;

  assert.deepEqual(resolveSslConfig(), { rejectUnauthorized: true });

  const connectionString = sanitizeConnectionString(
    'postgresql://user:password@db.example.com:5432/app?sslmode=require&application_name=api'
  );
  const sanitizedUrl = new URL(connectionString);
  assert.equal(sanitizedUrl.searchParams.has('sslmode'), false);
  assert.equal(sanitizedUrl.searchParams.get('application_name'), 'api');
});

test('development and test disable TLS by default; explicit false overrides production', () => {
  delete process.env.DATABASE_SSL;
  delete process.env.DATABASE_SSL_CA;

  for (const nodeEnv of ['development', 'test']) {
    process.env.NODE_ENV = nodeEnv;
    assert.equal(resolveSslConfig(), false);
  }

  process.env.NODE_ENV = 'production';
  process.env.DATABASE_SSL = 'false';
  assert.equal(resolveSslConfig(), false);
});

test('explicit TLS supports a custom CA and rejects invalid override values', () => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_SSL = 'true';
  process.env.DATABASE_SSL_CA = '-----BEGIN CERTIFICATE-----\\nexample\\n-----END CERTIFICATE-----';
  assert.deepEqual(resolveSslConfig(), {
    rejectUnauthorized: true,
    ca: process.env.DATABASE_SSL_CA
  });

  process.env.DATABASE_SSL = 'sometimes';
  assert.throws(() => resolveSslConfig(), /DATABASE_SSL must be "true" or "false"/);
});
