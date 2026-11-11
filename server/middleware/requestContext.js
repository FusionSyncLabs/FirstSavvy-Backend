const { randomUUID } = require('crypto');

function requestContext(req, res, next) {
  const incomingRequestId = req.headers['x-request-id'];

  req.requestId = typeof incomingRequestId === 'string' && incomingRequestId.trim()
    ? incomingRequestId.trim()
    : randomUUID();

  res.setHeader('X-Request-Id', req.requestId);
  next();
}

module.exports = { requestContext };
