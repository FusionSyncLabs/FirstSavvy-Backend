const { ApiError } = require('../errorHandler');
const { ERROR_CODES } = require('../../constants/errorCodes');
const { env } = require('../../config/env');

function requireSuperAdminSetupEnabled(_req, _res, next) {
  if (!env.enableSuperAdminSetup) {
    return next(ApiError.notFound('Not found.', { code: ERROR_CODES.NOT_FOUND }));
  }

  return next();
}

module.exports = { requireSuperAdminSetupEnabled };