const rateLimit = require('express-rate-limit');
const { ApiError } = require('./errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { env } = require('../config/env');

const GLOBAL_SKIP_PATH_PREFIXES = [
  '/api/v1/health',
  '/api/docs',
  '/api/v1/auth/google',
  '/api/v1/auth/google/callback'
];

function shouldSkipGlobalRateLimit(req) {
  const path = req.originalUrl.split('?')[0];
  return GLOBAL_SKIP_PATH_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

// Strict rate limiter applied ONLY to authentication endpoints
const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes window
  max: 10, // 10 attempts per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => !env.rateLimitEnabled,
  handler: (_req, _res, next) => {
    next(new ApiError(HTTP_STATUS.TOO_MANY_REQUESTS, 'Too many attempts. Please try again in 15 minutes.', {
      code: ERROR_CODES.RATE_LIMITED
    }));
  }
});

// Single globalRateLimiter declaration (passthrough so dashboard & profile switching never get throttled)
const globalRateLimiter = (_req, _res, next) => next();

module.exports = {
  authRateLimiter,
  globalRateLimiter,
  shouldSkipGlobalRateLimit
};
