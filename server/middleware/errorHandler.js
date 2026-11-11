const { fail } = require('../utils/apiResponse');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { logServerError } = require('../utils/safeLogger');
const { sanitizeValue } = require('../utils/sanitize');

class ApiError extends Error {
  constructor(statusCode, message, detailsOrOptions = null) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;

    if (
      detailsOrOptions &&
      typeof detailsOrOptions === 'object' &&
      !Array.isArray(detailsOrOptions) &&
      (Object.prototype.hasOwnProperty.call(detailsOrOptions, 'code') ||
        Object.prototype.hasOwnProperty.call(detailsOrOptions, 'details') ||
        Object.prototype.hasOwnProperty.call(detailsOrOptions, 'data'))
    ) {
      this.code = detailsOrOptions.code ?? null;
      this.details = detailsOrOptions.details ?? null;
      this.data = detailsOrOptions.data ?? null;
    } else {
      this.code = null;
      this.details = detailsOrOptions;
      this.data = null;
    }
  }

  static badRequest(message, options = {}) {
    return new ApiError(HTTP_STATUS.BAD_REQUEST, message, {
      code: options.code ?? ERROR_CODES.BAD_REQUEST,
      details: options.details ?? null
    });
  }

  static notFound(message, options = {}) {
    return new ApiError(HTTP_STATUS.NOT_FOUND, message, {
      code: options.code ?? ERROR_CODES.NOT_FOUND,
      details: options.details ?? null
    });
  }

  static conflict(message, options = {}) {
    return new ApiError(HTTP_STATUS.CONFLICT, message, {
      code: options.code ?? ERROR_CODES.CONFLICT,
      details: options.details ?? null
    });
  }

  static unauthorized(message, options = {}) {
    return new ApiError(HTTP_STATUS.UNAUTHORIZED, message, {
      code: options.code ?? ERROR_CODES.UNAUTHORIZED,
      details: options.details ?? null
    });
  }

  static internal(message, options = {}) {
    return new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, message, {
      code: options.code ?? ERROR_CODES.INTERNAL_ERROR,
      details: options.details ?? null
    });
  }
}

function defaultCodeForStatus(statusCode) {
  switch (statusCode) {
    case HTTP_STATUS.BAD_REQUEST:
      return ERROR_CODES.BAD_REQUEST;
    case HTTP_STATUS.UNAUTHORIZED:
      return ERROR_CODES.UNAUTHORIZED;
    case HTTP_STATUS.FORBIDDEN:
      return ERROR_CODES.FORBIDDEN;
    case HTTP_STATUS.NOT_FOUND:
      return ERROR_CODES.NOT_FOUND;
    case HTTP_STATUS.CONFLICT:
      return ERROR_CODES.CONFLICT;
    case HTTP_STATUS.TOO_MANY_REQUESTS:
      return ERROR_CODES.RATE_LIMITED;
    case HTTP_STATUS.SERVICE_UNAVAILABLE:
      return ERROR_CODES.SERVICE_UNAVAILABLE;
    default:
      return ERROR_CODES.INTERNAL_ERROR;
  }
}

function mapPrismaError(error) {
  if (!error || error.name !== 'PrismaClientKnownRequestError') {
    return null;
  }

  switch (error.code) {
    case 'P2002':
      return new ApiError(HTTP_STATUS.CONFLICT, 'A record with the same unique value already exists', {
        code: ERROR_CODES.CONFLICT,
        details: [{ field: error.meta?.target, message: 'Unique constraint violation' }]
      });
    case 'P2025':
      return new ApiError(HTTP_STATUS.NOT_FOUND, 'Record not found', {
        code: ERROR_CODES.NOT_FOUND
      });
    default:
      return new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Database operation failed', {
        code: ERROR_CODES.DATABASE_ERROR
      });
  }
}

function mapKnownError(error) {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    return new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invalid JSON request body', {
      code: ERROR_CODES.INVALID_JSON
    });
  }

  // Handle Plaid Axios errors
  if (error?.response?.data?.error_code || error?.response?.data?.error_type) {
    const plaidData = error.response.data;
    const isLoginRequired = [
      'ITEM_LOGIN_REQUIRED',
      'INVALID_CREDENTIALS',
      'INVALID_UPDATED_USERNAME',
      'ITEM_LOCKED',
      'ACCESS_NOT_GRANTED'
    ].includes(plaidData.error_code);

    return new ApiError(
      isLoginRequired ? HTTP_STATUS.BAD_REQUEST : HTTP_STATUS.BAD_GATEWAY,
      plaidData.display_message || plaidData.error_message || 'Bank connection error. Please reconnect your account.',
      {
        code: plaidData.error_code || ERROR_CODES.SERVICE_UNAVAILABLE,
        details: [plaidData]
      }
    );
  }

  return mapPrismaError(error);
}

function errorHandler(err, req, res, _next) {
  const mappedError = mapKnownError(err) || err;
  const statusCode = mappedError.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const isServerError = statusCode >= 500;
  const message = statusCode === HTTP_STATUS.SERVICE_UNAVAILABLE
    ? (mappedError.message || 'Service unavailable')
    : (isServerError ? 'Internal server error' : mappedError.message);
  const code = mappedError.code || defaultCodeForStatus(statusCode);

  if (isServerError) {
    logServerError(req.requestId, mappedError);
  }

  const safeDetails = mappedError.details == null
    ? null
    : sanitizeValue(mappedError.details);

  return fail(res, statusCode, {
    code,
    message,
    details: safeDetails,
    requestId: req.requestId ?? null,
    data: mappedError.data ?? null
  });
}

module.exports = { ApiError, errorHandler };
