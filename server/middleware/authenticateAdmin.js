const { ApiError } = require('./errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { env } = require('../config/env');
const { verifyJwt } = require('../utils/tokens');
const { getActiveAdminById } = require('../services/admin.service');

async function authenticateAdmin(req, _res, next) {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Admin authentication required.', {
      code: ERROR_CODES.UNAUTHORIZED
    }));
  }

  let payload;
  try {
    payload = verifyJwt(authorization.slice('Bearer '.length), env.jwtAccessSecret, 'admin_access');
  } catch (error) {
    return next(error);
  }

  try {
    const admin = await getActiveAdminById(payload.sub);
    if (payload.tokenVersion !== admin.refresh_token_version) {
      return next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Admin session has expired. Please sign in again.', {
        code: ERROR_CODES.INVALID_TOKEN
      }));
    }

    req.admin = admin;
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireAdminRole(...roles) {
  return (req, _res, next) => {
    if (!req.admin || !roles.includes(req.admin.role)) {
      return next(new ApiError(HTTP_STATUS.FORBIDDEN, 'You do not have permission to perform this action.', {
        code: ERROR_CODES.FORBIDDEN
      }));
    }

    return next();
  };
}

module.exports = { authenticateAdmin, requireAdminRole };
