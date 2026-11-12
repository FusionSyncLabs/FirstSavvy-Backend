const { ok, created } = require('../../utils/apiResponse');
const { asyncHandler } = require('../../utils/asyncHandler');
const { env } = require('../../config/env');
const { getCookie, setAdminRefreshCookie, clearAdminRefreshCookie } = require('../../utils/cookies');
const {
  setupSuperAdmin,
  loginAdmin,
  refreshAdminSession,
  logoutAdmin,
  createSubAdmin,
  safeAdmin
} = require('../../services/admin/admin.service');

function sessionResponse(session) {
  return {
    accessToken: session.accessToken,
    tokenType: session.tokenType,
    expiresIn: session.expiresIn
  };
}

const setupSuperAdminHandler = asyncHandler(async (req, res) => {
  const result = await setupSuperAdmin(req.body);
  setAdminRefreshCookie(res, result.session.refreshToken);

  return created(res, {
    admin: result.admin,
    session: sessionResponse(result.session)
  });
});

const loginAdminHandler = asyncHandler(async (req, res) => {
  const result = await loginAdmin(req.body);
  setAdminRefreshCookie(res, result.session.refreshToken);

  return ok(res, {
    admin: result.admin,
    session: sessionResponse(result.session)
  });
});

const refreshAdminHandler = asyncHandler(async (req, res) => {
  const result = await refreshAdminSession(getCookie(req, env.adminRefreshCookieName));
  setAdminRefreshCookie(res, result.session.refreshToken);

  return ok(res, {
    admin: result.admin,
    session: sessionResponse(result.session)
  });
});

const logoutAdminHandler = asyncHandler(async (req, res) => {
  const result = await logoutAdmin(req.admin.id);
  clearAdminRefreshCookie(res);

  return ok(res, result);
});

const currentAdminHandler = asyncHandler(async (req, res) => {
  return ok(res, { admin: safeAdmin(req.admin) });
});

const createSubAdminHandler = asyncHandler(async (req, res) => {
  const admin = await createSubAdmin(req.body, req.admin.id);
  return created(res, { admin });
});

module.exports = {
  setupSuperAdminHandler,
  loginAdminHandler,
  refreshAdminHandler,
  logoutAdminHandler,
  currentAdminHandler,
  createSubAdminHandler
};
