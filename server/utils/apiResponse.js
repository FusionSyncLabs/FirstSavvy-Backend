function ok(res, data = {}, statusCode = 200) {
  return res.status(statusCode).json({
    success: true,
    data,
    error: null
  });
}

function created(res, data = {}) {
  return ok(res, data, 201);
}

function fail(res, statusCode, { code, message, details = null, requestId = null, data = null }) {
  const error = {
    code,
    message,
    details
  };

  if (requestId) {
    error.requestId = requestId;
  }

  return res.status(statusCode).json({
    success: false,
    data,
    error
  });
}

function paginated(res, items, pagination, statusCode = 200) {
  return ok(res, { items, pagination }, statusCode);
}

module.exports = { ok, created, fail, paginated };
