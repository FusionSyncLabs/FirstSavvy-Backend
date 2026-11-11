const crypto = require('crypto');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

function base64UrlEncode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(value) {
  const padded = value.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function signJwt(payload, secret, expiresInSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedBody = base64UrlEncode(JSON.stringify(body));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedBody}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedBody}.${signature}`;
}

function verifyJwt(token, secret, expectedType = null) {
  const parts = String(token || '').split('.');

  if (parts.length !== 3) {
    throw invalidToken();
  }

  const [encodedHeader, encodedBody, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${encodedHeader}.${encodedBody}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw invalidToken();
  }

  let payload;

  try {
    payload = JSON.parse(base64UrlDecode(encodedBody));
  } catch (_error) {
    throw invalidToken();
  }

  const now = Math.floor(Date.now() / 1000);

  if (!payload.exp || payload.exp <= now) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Token expired', {
      code: ERROR_CODES.TOKEN_EXPIRED
    });
  }

  if (expectedType && payload.type !== expectedType) {
    throw invalidToken();
  }

  return payload;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function compareTokenHash(token, expectedHash) {
  if (!expectedHash) {
    return false;
  }

  const actualHash = hashToken(token);
  const actualBuffer = Buffer.from(actualHash);
  const expectedBuffer = Buffer.from(expectedHash);

  return actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function invalidToken() {
  return new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Invalid token', {
    code: ERROR_CODES.INVALID_TOKEN
  });
}

module.exports = {
  signJwt,
  verifyJwt,
  hashToken,
  compareTokenHash
};
