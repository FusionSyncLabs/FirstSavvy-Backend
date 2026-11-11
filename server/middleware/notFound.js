const { ApiError } = require('./errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

function notFound(req, _res, next) {
  next(new ApiError(HTTP_STATUS.NOT_FOUND, `Route not found: ${req.method} ${req.originalUrl}`, {
    code: ERROR_CODES.ROUTE_NOT_FOUND,
    details: {
      method: req.method,
      path: req.originalUrl
    }
  }));
}

module.exports = { notFound };
