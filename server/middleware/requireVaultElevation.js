const { env } = require('../config/env');
const { signJwt, verifyJwt } = require('../utils/tokens');
const { ApiError } = require('./errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

const VAULT_TOKEN_TYPE = 'vault_access';
const VAULT_TOKEN_TTL_SECONDS = 5 * 60;
const VAULT_TOKEN_HEADER = 'x-vault-token';

// Fields that can change without re-authentication (organisation only, no secrets).
const NON_SENSITIVE_UPDATE_FIELDS = new Set(['is_favorite', 'folder_id', 'sort_order']);

function issueVaultAccessToken(userId) {
  return signJwt({ sub: userId, type: VAULT_TOKEN_TYPE }, env.jwtAccessSecret, VAULT_TOKEN_TTL_SECONDS);
}

function denied(message) {
  return new ApiError(HTTP_STATUS.FORBIDDEN, message, { code: ERROR_CODES.FORBIDDEN });
}

/**
 * Requires a fresh vault elevation token (obtained via POST /auth/verify-identity)
 * for destructive or secret-changing vault operations. Must run after `authenticate`.
 * Pass `{ onlyIfSensitiveBody: true }` for PATCH so organisational changes
 * (favourite / folder moves) don't prompt for re-authentication.
 */
function requireVaultElevation({ onlyIfSensitiveBody = false } = {}) {
  return (req, _res, next) => {
    if (onlyIfSensitiveBody) {
      const keys = Object.keys(req.body || {});
      if (keys.length > 0 && keys.every((key) => NON_SENSITIVE_UPDATE_FIELDS.has(key))) {
        return next();
      }
    }

    const token = req.headers[VAULT_TOKEN_HEADER];
    if (!token) {
      return next(denied('Identity verification required for this vault action'));
    }

    try {
      const payload = verifyJwt(token, env.jwtAccessSecret, VAULT_TOKEN_TYPE);
      if (!req.auth || payload.sub !== req.auth.sub) {
        return next(denied('Identity verification does not match the current user'));
      }
      return next();
    } catch {
      return next(denied('Identity verification expired. Please verify again.'));
    }
  };
}

module.exports = { requireVaultElevation, issueVaultAccessToken };

