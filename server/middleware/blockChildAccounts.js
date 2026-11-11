const { prisma } = require('../config/database');
const { ApiError } = require('./errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map();

async function isChildAuthUser(userId) {
  const cached = cache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const child = await prisma.childProfile.findFirst({
    where: { auth_user_id: userId, is_active: true, deleted_at: null },
    select: { id: true }
  });
  const value = Boolean(child);
  cache.set(userId, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  return value;
}

function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Rejects requests made with a child-account login token on routes that must
 * stay parent/adult-only (banking, budgeting, net worth, investments, vault...).
 *
 * The subject is read from the bearer token without verifying expiry so that
 * expired tokens cannot be used to dodge the check; the route's own
 * `authenticate` middleware still performs the real verification. A forged
 * subject can only cause a denial for the forger.
 */
async function blockChildAccounts(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) return next();

    const decoded = decodeJwtPayload(header.slice('Bearer '.length));
    const userId = decoded && decoded.sub;
    if (!userId) return next();

    if (await isChildAuthUser(userId)) {
      return next(new ApiError(HTTP_STATUS.FORBIDDEN, 'Access restricted for child accounts', {
        code: ERROR_CODES.FORBIDDEN
      }));
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = { blockChildAccounts };
