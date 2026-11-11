const crypto = require('crypto');
const { env } = require('../config/env');
const { signJwt, verifyJwt } = require('./tokens');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

const CHALLENGE_TYPE = 'two_factor_challenge';
const COMPLETION_TYPE = 'two_factor_verified';
const CHALLENGE_TTL_SECONDS = 10 * 60;
const COMPLETION_TTL_SECONDS = 2 * 60;

// Single-use enforcement for completion tokens (jti -> expiry ms).
const usedCompletionTokens = new Map();

function purgeUsed() {
  const now = Date.now();
  for (const [jti, expiresAt] of usedCompletionTokens) {
    if (expiresAt <= now) usedCompletionTokens.delete(jti);
  }
}

function unauthorized(message) {
  return new ApiError(HTTP_STATUS.UNAUTHORIZED, message, { code: ERROR_CODES.UNAUTHORIZED });
}

/** Issued after the first factor (password / Google) succeeds and 2FA is required. */
function issueChallengeToken(userId) {
  return signJwt({ sub: userId, type: CHALLENGE_TYPE }, env.jwtAccessSecret, CHALLENGE_TTL_SECONDS);
}

/** Returns the user id the challenge was issued for, or throws 401. */
function resolveChallengeUserId(token) {
  if (!token) throw unauthorized('Two-factor challenge required. Please sign in again.');
  try {
    return verifyJwt(token, env.jwtAccessSecret, CHALLENGE_TYPE).sub;
  } catch {
    throw unauthorized('Two-factor session expired. Please sign in again.');
  }
}

/** Issued only after a 2FA code / backup code has been verified server-side. */
function issueCompletionToken(userId) {
  return signJwt(
    { sub: userId, type: COMPLETION_TYPE, jti: crypto.randomUUID() },
    env.jwtAccessSecret,
    COMPLETION_TTL_SECONDS
  );
}

/** Validates and burns a completion token. Returns the user id. */
function consumeCompletionToken(token) {
  if (!token) throw unauthorized('Two-factor verification required.');
  let payload;
  try {
    payload = verifyJwt(token, env.jwtAccessSecret, COMPLETION_TYPE);
  } catch {
    throw unauthorized('Two-factor verification expired. Please sign in again.');
  }

  purgeUsed();
  if (usedCompletionTokens.has(payload.jti)) {
    throw unauthorized('Two-factor verification already used. Please sign in again.');
  }
  usedCompletionTokens.set(payload.jti, payload.exp * 1000);
  return payload.sub;
}

module.exports = {
  issueChallengeToken,
  resolveChallengeUserId,
  issueCompletionToken,
  consumeCompletionToken
};

