const { env } = require('../config/env');

function getCookie(req, name) {
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader) {
    return null;
  }

  const cookies = cookieHeader.split(';').map((cookie) => cookie.trim());
  const match = cookies.find((cookie) => cookie.startsWith(`${name}=`));

  if (!match) {
    return null;
  }

  return decodeURIComponent(match.slice(name.length + 1));
}

function setRefreshCookie(res, refreshToken) {
  clearLegacyRefreshCookie(res);

  res.cookie(env.refreshCookieName, refreshToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/api/v1',
    maxAge: env.refreshTokenTtlSeconds * 1000
  });
}

function clearRefreshCookie(res) {
  res.clearCookie(env.refreshCookieName, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/api/v1'
  });
  clearLegacyRefreshCookie(res);
}

function clearLegacyRefreshCookie(res) {
  res.clearCookie(env.refreshCookieName, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/api/v1/auth'
  });
}

// Admin route
function setAdminRefreshCookie(res, refreshToken) {
  res.cookie(env.adminRefreshCookieName, refreshToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/api/v1/admin',
    maxAge: env.refreshTokenTtlSeconds * 1000
  });
}

// Admin route
function clearAdminRefreshCookie(res) {
  res.clearCookie(env.adminRefreshCookieName, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/api/v1/admin'
  });
}

function setOAuthStateCookie(res, stateToken) {
  res.cookie(env.oauthStateCookieName, stateToken, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/api/v1/auth/google/callback',
    maxAge: 10 * 60 * 1000
  });
}

function clearOAuthStateCookie(res) {
  res.clearCookie(env.oauthStateCookieName, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/api/v1/auth/google/callback'
  });
}

module.exports = {
  getCookie,
  setRefreshCookie,
  clearRefreshCookie,
  setAdminRefreshCookie,
  clearAdminRefreshCookie,
  setOAuthStateCookie,
  clearOAuthStateCookie
};
