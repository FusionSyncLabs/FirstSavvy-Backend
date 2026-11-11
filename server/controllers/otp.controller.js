const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { setRefreshCookie } = require('../utils/cookies');
const { env } = require('../config/env');
const {
  requestOtpVerification,
  verifyOtpCode,
  resendOtpVerification
} = require('../services/otp.service');

const requestOtp = asyncHandler(async (req, res) => {
  const result = await requestOtpVerification(req.body);
  return ok(res, result);
});

const resendOtp = asyncHandler(async (req, res) => {
  const result = await resendOtpVerification(req.body);
  return ok(res, result);
});

const verifyOtp = asyncHandler(async (req, res) => {
  const result = await verifyOtpCode(req.body);

  if (result.session && result.session.refreshToken) {
    setRefreshCookie(res, result.session.refreshToken);
    const { refreshToken: _refreshToken, ...session } = result.session;
    return ok(res, { ...result, session });
  }

  return ok(res, result);
});

module.exports = {
  requestOtp,
  verifyOtp,
  resendOtp
};
