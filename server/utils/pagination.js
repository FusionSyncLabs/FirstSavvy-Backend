const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePaginationQuery(query, options = {}) {
  const defaultPage = options.defaultPage ?? DEFAULT_PAGE;
  const defaultLimit = options.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = options.maxLimit ?? MAX_LIMIT;

  const pageRaw = query.page ?? query.pageNumber;
  const limitRaw = query.limit ?? query.pageSize;

  const page = pageRaw === undefined ? defaultPage : Number(pageRaw);
  const limit = limitRaw === undefined ? defaultLimit : Number(limitRaw);

  if (!Number.isInteger(page) || page < 1) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Page must be a positive integer', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{
        location: 'query',
        field: 'page',
        message: 'Page must be a positive integer'
      }]
    });
  }

  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Limit must be a positive integer within allowed bounds', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{
        location: 'query',
        field: 'limit',
        message: `Limit must be between 1 and ${maxLimit}`
      }]
    });
  }

  const skip = (page - 1) * limit;

  return { page, limit, skip, take: limit };
}

function buildPaginationMeta({ page, limit, total }) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1
  };
}

module.exports = {
  DEFAULT_PAGE,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  parsePaginationQuery,
  buildPaginationMeta
};
