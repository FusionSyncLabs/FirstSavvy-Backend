const { env } = require('../config/env');
const { sanitizeErrorForLog, sanitizeValue } = require('./sanitize');

function logServerError(requestId, error) {
  console.error(`[${requestId || 'no-request-id'}]`, sanitizeErrorForLog(error));
}

function logDevRequest(req) {
  if (env.isProduction || !env.logDevRequests) {
    return;
  }

  const entry = {
    method: req.method,
    path: req.originalUrl,
    requestId: req.requestId
  };

  if (env.logDevRequestBody && req.body && Object.keys(req.body).length > 0 && !req.redactRequestBody) {
    entry.body = sanitizeValue(req.body);
  }

  console.log('[dev-request]', entry);
}

module.exports = {
  logServerError,
  logDevRequest
};
