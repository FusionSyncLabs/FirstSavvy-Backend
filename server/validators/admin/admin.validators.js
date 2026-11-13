const { validateRequest } = require('../../middleware/validateRequest');
const { ApiError } = require('../../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../../constants/errorCodes');

const PAGINATION_QUERY_FIELDS = new Set(['page', 'limit']);

function validateStrictAdminBody(rules) {
  const validateKnownFields = validateRequest({ body: rules });
  const allowedFields = new Set(Object.keys(rules));

  return (req, res, next) => {
    const body = req.body;

    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const unknownFields = Object.keys(body).filter((field) => !allowedFields.has(field));
      if (unknownFields.length > 0) {
        const details = unknownFields.map((field) => ({
          location: 'body',
          field,
          message: 'Unexpected field is not allowed.'
        }));

        return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'Request body contains unsupported fields.', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details
        }));
      }
    }

    return validateKnownFields(req, res, next);
  };
}

function validateAdminPaginationQuery(req, _res, next) {
  const query = req.query || {};
  const unknownFields = Object.keys(query).filter((field) => !PAGINATION_QUERY_FIELDS.has(field));
  const errors = unknownFields.map((field) => ({
    location: 'query',
    field,
    message: 'Unexpected query parameter is not allowed.'
  }));

  for (const [field, maximum] of [['page', Number.MAX_SAFE_INTEGER], ['limit', 100]]) {
    const value = query[field];
    if (value === undefined) {
      continue;
    }

    if (
      typeof value !== 'string' ||
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < 1 ||
      Number(value) > maximum
    ) {
      errors.push({
        location: 'query',
        field,
        message: field === 'limit'
          ? 'Limit must be an integer between 1 and 100.'
          : 'Page must be a positive integer.'
      });
    }
  }

  if (errors.length > 0) {
    return next(new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invalid admin query parameters.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: errors
    }));
  }

  return next();
}

module.exports = {
  validateStrictAdminBody,
  validateAdminPaginationQuery
};
