const { ok } = require('../utils/apiResponse');
const { env } = require('../config/env');
const { checkDatabaseHealth } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

function getHealth(_req, res) {
  return ok(res, {
    status: 'ok',
    service: 'firstsavvy-api',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString()
  });
}

async function getDatabaseHealth(_req, res, next) {
  try {
    const isHealthy = await checkDatabaseHealth();

    if (!isHealthy) {
      throw new ApiError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'Database health check failed', {
        code: ERROR_CODES.SERVICE_UNAVAILABLE
      });
    }

    return ok(res, {
      status: 'ok',
      service: 'firstsavvy-api',
      database: 'connected',
      environment: env.nodeEnv,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { getHealth, getDatabaseHealth };
