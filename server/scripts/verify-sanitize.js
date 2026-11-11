const { sanitizeValue, sanitizeErrorForLog, pickPublicUser, REDACTED } = require('../utils/sanitize');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const sanitizedBody = sanitizeValue({
    email: 'user@test.com',
    password: 'SuperSecret123!',
    nested: { refreshToken: 'abc', note: 'safe' }
  });

  assert(sanitizedBody.password === REDACTED, 'password should be redacted');
  assert(sanitizedBody.nested.refreshToken === REDACTED, 'refreshToken should be redacted');
  assert(sanitizedBody.nested.note === 'safe', 'non-sensitive values should remain');

  const sanitizedError = sanitizeErrorForLog(new ApiErrorLike());
  assert(sanitizedError.details.token === REDACTED, 'error details token should be redacted');

  const publicUser = pickPublicUser({
    id: '1',
    email: 'user@test.com',
    full_name: 'User',
    password_hash: 'hash',
    created_at: '2026-01-01T00:00:00.000Z'
  });

  assert(publicUser.password_hash === undefined, 'password_hash must not be returned');
  assert(publicUser.email === 'user@test.com', 'public user fields should remain');

  console.log('Sanitize utilities verification passed.');
}

function ApiErrorLike() {
  this.name = 'ApiError';
  this.message = 'Validation failed';
  this.details = { token: 'secret-token', field: 'email' };
}

run();
