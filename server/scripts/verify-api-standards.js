require('dotenv').config();

const baseUrl = process.env.API_BASE_URL || 'http://localhost:5000';

function assertEnvelope(body, { expectSuccess }) {
  if (typeof body.success !== 'boolean') {
    throw new Error('Response missing boolean success flag');
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'data')) {
    throw new Error('Response missing data property');
  }

  if (!Object.prototype.hasOwnProperty.call(body, 'error')) {
    throw new Error('Response missing error property');
  }

  if (expectSuccess) {
    if (body.success !== true || body.error !== null) {
      throw new Error(`Expected success envelope, received: ${JSON.stringify(body)}`);
    }
  } else if (body.success !== false || body.data !== null || !body.error?.code || !body.error?.message) {
    throw new Error(`Expected error envelope, received: ${JSON.stringify(body)}`);
  }
}

async function run() {
  console.log('Verifying API standards...\n');

  const health = await fetch(`${baseUrl}/api/v1/health`).then((r) => r.json());
  assertEnvelope(health, { expectSuccess: true });
  console.log('OK  GET /api/v1/health success envelope');

  const notFound = await fetch(`${baseUrl}/api/v1/does-not-exist`).then((r) => r.json());
  assertEnvelope(notFound, { expectSuccess: false });
  console.log('OK  404 route error envelope', notFound.error.code);

  const invalidJson = await fetch(`${baseUrl}/api/v1/dev/provision-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ invalid json'
  }).then((r) => r.json());
  assertEnvelope(invalidJson, { expectSuccess: false });
  console.log('OK  invalid JSON error envelope', invalidJson.error.code);

  const validation = await fetch(`${baseUrl}/api/v1/dev/provision-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' })
  }).then((r) => r.json());
  assertEnvelope(validation, { expectSuccess: false });
  console.log('OK  validation error envelope', validation.error.code);

  const requestIdResponse = await fetch(`${baseUrl}/api/v1/health`);
  const requestId = requestIdResponse.headers.get('x-request-id');
  if (!requestId) {
    throw new Error('Missing X-Request-Id response header');
  }
  console.log('OK  X-Request-Id header present');

  const secretPassword = 'SecretPassword123!';
  const provision = await fetch(`${baseUrl}/api/v1/dev/provision-user`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `security.check.${Date.now()}@firstsavvy.test`,
      fullName: 'Security Check',
      password: secretPassword
    })
  }).then((r) => r.json());

  const responseText = JSON.stringify(provision);
  if (responseText.includes(secretPassword) || responseText.includes('password_hash')) {
    throw new Error('Sensitive auth values leaked in API response');
  }
  console.log('OK  provision response excludes password and password_hash');

  console.log('\nAPI standards verification passed.');
}

run().catch((error) => {
  console.error('\nAPI standards verification failed:', error.message);
  process.exit(1);
});
