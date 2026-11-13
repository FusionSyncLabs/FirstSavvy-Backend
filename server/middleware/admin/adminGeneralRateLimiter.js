const { ApiError } = require('../errorHandler');

const ADMIN_GENERAL_WINDOW_MS = 60 * 1000;
const ADMIN_GENERAL_LIMIT = 100;
const requestsByClient = new Map();

const cleanupTimer = setInterval(() => {
  const expiredBefore = Date.now() - ADMIN_GENERAL_WINDOW_MS;

  for (const [key, timestamps] of requestsByClient) {
    const activeTimestamps = timestamps.filter((timestamp) => timestamp > expiredBefore);
    if (activeTimestamps.length === 0) {
      requestsByClient.delete(key);
    } else {
      requestsByClient.set(key, activeTimestamps);
    }
  }
}, ADMIN_GENERAL_WINDOW_MS);
cleanupTimer.unref();

function getClientKey(req) {
  if (req.admin?.id != null) {
    return `admin:${req.admin.id}`;
  }

  return `ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
}

function adminGeneralRateLimiter(req, res, next) {
  const now = Date.now();
  const windowStart = now - ADMIN_GENERAL_WINDOW_MS;
  const key = getClientKey(req);
  const activeTimestamps = (requestsByClient.get(key) || [])
    .filter((timestamp) => timestamp > windowStart);

  res.set('RateLimit-Limit', String(ADMIN_GENERAL_LIMIT));

  if (activeTimestamps.length >= ADMIN_GENERAL_LIMIT) {
    const retryAfter = Math.max(
      1,
      Math.ceil((activeTimestamps[0] + ADMIN_GENERAL_WINDOW_MS - now) / 1000)
    );
    res.set('RateLimit-Remaining', '0');
    res.set('Retry-After', String(retryAfter));

    return next(new ApiError(429, 'Too many admin requests. Please try again later.', {
      code: 'RATE_LIMITED'
    }));
  }

  activeTimestamps.push(now);
  requestsByClient.set(key, activeTimestamps);
  res.set('RateLimit-Remaining', String(ADMIN_GENERAL_LIMIT - activeTimestamps.length));

  return next();
}

module.exports = { adminGeneralRateLimiter };
