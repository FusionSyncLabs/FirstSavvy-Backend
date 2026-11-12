const crypto = require('crypto');
const { prisma } = require('../../config/database');
const { ApiError } = require('../errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../../constants/errorCodes');

const ADMIN_AUTH_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_AUTH_LIMIT = 5;

function getLimiterKey(req) {
  const ipAddress = req.ip || req.socket?.remoteAddress || 'unknown';
  const ipHash = crypto.createHash('sha256').update(ipAddress).digest('hex');
  return `admin-auth:${ipHash}`;
}

async function getAttemptState(limiterKey) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${limiterKey}, 0)) IS NULL AS locked
    `;

    await transaction.$executeRaw`
      DELETE FROM admin_rate_limit_logs
      WHERE created_at < statement_timestamp() - INTERVAL '15 minutes'
    `;

    const [usage] = await transaction.$queryRaw`
      WITH request_clock AS (
        SELECT statement_timestamp() AS checked_at
      )
      SELECT
        COUNT(log.id)::integer AS count,
        MIN(log.created_at) AS oldest_timestamp,
        MAX(request_clock.checked_at) AS checked_at
      FROM admin_rate_limit_logs AS log
      CROSS JOIN request_clock
      WHERE log.limiter_key = ${limiterKey}
        AND log.created_at >= request_clock.checked_at - INTERVAL '15 minutes'
    `;

    if (usage.count >= ADMIN_AUTH_LIMIT) {
      const oldestTimestamp = new Date(usage.oldest_timestamp).getTime();
      const checkedAt = new Date(usage.checked_at).getTime();
      const retryAfter = Math.max(
        1,
        Math.ceil((oldestTimestamp + ADMIN_AUTH_WINDOW_MS - checkedAt) / 1000)
      );

      return { limited: true, retryAfter };
    }

    return {
      limited: false,
      remaining: Math.max(0, ADMIN_AUTH_LIMIT - usage.count)
    };
  });
}

async function finalizeAttempt(limiterKey, statusCode) {
  if (statusCode < 400 && (statusCode < 200 || statusCode >= 300)) {
    return;
  }

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${limiterKey}, 0)) IS NULL AS locked
    `;

    if (statusCode >= 200 && statusCode < 300) {
      await transaction.$executeRaw`
        DELETE FROM admin_rate_limit_logs
        WHERE limiter_key = ${limiterKey}
      `;
      return;
    }

    await transaction.$executeRaw`
      DELETE FROM admin_rate_limit_logs
      WHERE created_at < statement_timestamp() - INTERVAL '15 minutes'
    `;

    const [usage] = await transaction.$queryRaw`
      WITH request_clock AS (
        SELECT statement_timestamp() AS checked_at
      )
      SELECT COUNT(log.id)::integer AS count
      FROM admin_rate_limit_logs AS log
      CROSS JOIN request_clock
      WHERE log.limiter_key = ${limiterKey}
        AND log.created_at >= request_clock.checked_at - INTERVAL '15 minutes'
    `;

    if (usage.count < ADMIN_AUTH_LIMIT) {
      await transaction.$executeRaw`
        INSERT INTO admin_rate_limit_logs (limiter_key, created_at)
        VALUES (${limiterKey}, clock_timestamp())
      `;
    }
  });
}

async function adminAuthRateLimiter(req, res, next) {
  try {
    const limiterKey = getLimiterKey(req);
    const result = await getAttemptState(limiterKey);
    res.set('RateLimit-Limit', String(ADMIN_AUTH_LIMIT));

    if (result.limited) {
      res.set('RateLimit-Remaining', '0');
      res.set('Retry-After', String(result.retryAfter));
      return next(new ApiError(HTTP_STATUS.TOO_MANY_REQUESTS, 'Too many admin authentication attempts. Please try again later.', {
        code: ERROR_CODES.RATE_LIMITED
      }));
    }

    res.set('RateLimit-Remaining', String(result.remaining));
    res.on('finish', () => {
      finalizeAttempt(limiterKey, res.statusCode).catch((error) => {
        console.error('Admin auth rate-limit post-response update failed:', error);
      });
    });

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { adminAuthRateLimiter };