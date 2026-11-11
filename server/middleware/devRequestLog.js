const { env } = require('../config/env');
const { logDevRequest } = require('../utils/safeLogger');
const { sanitizeValue } = require('../utils/sanitize');

function devRequestLog(req, res, next) {
  logDevRequest(req);

  if (env.logDevResponseBody) {
    const originalJson = res.json.bind(res);

    res.json = (body) => {
      console.log('[dev-response]', {
        requestId: req.requestId,
        statusCode: res.statusCode,
        body: sanitizeValue(body)
      });

      return originalJson(body);
    };
  }

  next();
}

module.exports = { devRequestLog };
