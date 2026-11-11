const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authRateLimiter } = require('../../middleware/rateLimit');
const {
  requestOtp,
  verifyOtp,
  resendOtp
} = require('../../controllers/otp.controller');

const router = express.Router();

router.post(
  '/request',
  authRateLimiter,
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true }
    }
  }),
  requestOtp
);

router.post(
  '/resend',
  authRateLimiter,
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true }
    }
  }),
  resendOtp
);

router.post(
  '/verify',
  authRateLimiter,
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true },
      otp: { required: true, type: 'string', minLength: 6, maxLength: 6 }
    }
  }),
  verifyOtp
);

module.exports = router;
