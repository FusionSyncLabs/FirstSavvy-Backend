const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authRateLimiter } = require('../../middleware/rateLimit');
const { authenticate } = require('../../middleware/authenticate');
const { asyncHandler } = require('../../utils/asyncHandler');
const { ok } = require('../../utils/apiResponse');
const {
  requestPhoneCode,
  verifyPhone,
  resendPhoneCode,
  removePhone
} = require('../../controllers/phoneVerification.controller');
const {
  requestPhoneVerification,
  verifyPhoneCode
} = require('../../services/phoneVerification.service');

const router = express.Router();

router.post(
  '/request',
  authRateLimiter,
  validateRequest({
    body: {
      phone: { required: true, type: 'string', minLength: 10 },
      userId: { type: 'string' }
    }
  }),
  requestPhoneCode
);

router.post(
  '/add',
  authenticate,
  authRateLimiter,
  validateRequest({
    body: {
      phone: { required: true, type: 'string', minLength: 10 }
    }
  }),
  asyncHandler(async (req, res) => {
    const { phone } = req.body;
    const result = await requestPhoneVerification({ phone, userId: req.auth.sub });
    return ok(res, result);
  })
);

router.post(
  '/verify',
  authRateLimiter,
  validateRequest({
    body: {
      phone: { required: true, type: 'string', minLength: 10 },
      code: { required: true, type: 'string', minLength: 6, maxLength: 6 },
      email: { type: 'string', email: true },
      password: { type: 'string', minLength: 8 },
      fullName: { type: 'string' },
      referral: { type: 'string' }
    }
  }),
  verifyPhone
);

router.post(
  '/verify-add',
  authenticate,
  authRateLimiter,
  validateRequest({
    body: {
      phone: { required: true, type: 'string', minLength: 10 },
      code: { required: true, type: 'string', minLength: 6, maxLength: 6 }
    }
  }),
  asyncHandler(async (req, res) => {
    const { phone, code } = req.body;
    const result = await verifyPhoneCode({ phone, code, userId: req.auth.sub });
    return ok(res, result);
  })
);

router.post(
  '/resend',
  authRateLimiter,
  validateRequest({
    body: {
      phone: { required: true, type: 'string', minLength: 10 },
      userId: { type: 'string' }
    }
  }),
  resendPhoneCode
);

router.delete(
  '/remove',
  authenticate,
  removePhone
);

module.exports = router;
