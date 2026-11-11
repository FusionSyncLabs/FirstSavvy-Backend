const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { setRefreshCookie } = require('../utils/cookies');
const { env } = require('../config/env');
const { authenticate } = require('../middleware/authenticate');
const {
  requestPhoneVerification,
  verifyPhoneCode,
  resendPhoneVerification,
  removePhoneNumber
} = require('../services/phoneVerification.service');

const requestPhoneCode = asyncHandler(async (req, res) => {
  const { phone, userId } = req.body;
  const result = await requestPhoneVerification({ phone, userId });
  return ok(res, result);
});

const verifyPhone = asyncHandler(async (req, res) => {
  const { phone, code, email, password, fullName, referral } = req.body;
  const result = await verifyPhoneCode({ phone, code, email, password, fullName, referral });

  if (result.session && result.session.refreshToken) {
    setRefreshCookie(res, result.session.refreshToken);
    const { refreshToken: _refreshToken, ...session } = result.session;
    return ok(res, { ...result, session });
  }

  return ok(res, result);
});

const resendPhoneCode = asyncHandler(async (req, res) => {
  const { phone, userId } = req.body;
  const result = await resendPhoneVerification({ phone, userId });
  return ok(res, result);
});

const removePhone = asyncHandler(async (req, res) => {
  const result = await removePhoneNumber({ userId: req.auth.sub });
  return ok(res, result);
});

module.exports = {
  requestPhoneCode,
  verifyPhone,
  resendPhoneCode,
  removePhone
};