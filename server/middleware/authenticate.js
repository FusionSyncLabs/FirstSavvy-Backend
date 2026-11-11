const { ApiError } = require('./errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { env } = require('../config/env');
const { verifyAccessToken, refreshSession } = require('../services/auth.service');
const { getCookie, setRefreshCookie } = require('../utils/cookies');

async function authenticate(req, res, next) {
  const authorization = req.headers.authorization;

  if (!authorization || !authorization.startsWith('Bearer ')) {
    return next(new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Authentication required', {
      code: ERROR_CODES.UNAUTHORIZED
    }));
  }

  try {
    req.auth = verifyAccessToken(authorization.slice('Bearer '.length));
    return next();
  } catch (error) {
    if (error.code !== ERROR_CODES.TOKEN_EXPIRED) {
      return next(error);
    }

    try {
      const refreshed = await refreshSession(getCookie(req, env.refreshCookieName));
      setRefreshCookie(res, refreshed.session.refreshToken);
      res.set('X-Access-Token', refreshed.session.accessToken);
      res.set('X-Token-Type', refreshed.session.tokenType);
      res.set('X-Token-Expires-In', String(refreshed.session.expiresIn));
      req.auth = verifyAccessToken(refreshed.session.accessToken);

      return next();
    } catch {
      return next(error);
    }
  }
}

module.exports = { authenticate };
