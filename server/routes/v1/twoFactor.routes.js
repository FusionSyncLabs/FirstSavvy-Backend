const express = require("express");
const router = express.Router();
const {
  setupTwoFactor,
  confirmSetupTwoFactor,
  disableTwoFactorHandler,
  requestVerification,
  verifyCode,
  verifyTotp,
  getStatus,
  regenerateBackupCodesHandler,
} = require("../../controllers/twoFactor.controller");
const { authenticate } = require("../../middleware/authenticate");
const { validateRequest } = require("../../middleware/validateRequest");
const { authRateLimiter } = require("../../middleware/rateLimit");

// Pre-session login 2FA endpoints (also usable when authenticated)
router.post(
  "/request",
  authRateLimiter,
  validateRequest({
    body: {
      userId: { type: "string" },
      challengeToken: { type: "string" },
    },
  }),
  requestVerification
);

router.post(
  "/verify",
  authRateLimiter,
  validateRequest({
    body: {
      userId: { type: "string" },
      challengeToken: { type: "string" },
      code: { type: "string", maxLength: 10 },
      backupCode: { type: "string", maxLength: 30 },
    },
  }),
  verifyCode
);

router.post(
  "/verify-totp",
  authRateLimiter,
  validateRequest({
    body: {
      userId: { type: "string" },
      challengeToken: { type: "string" },
      code: { required: true, type: "string", minLength: 6, maxLength: 8 },
    },
  }),
  verifyTotp
);

// Authenticated account management endpoints
router.post(
  "/setup",
  authenticate,
  validateRequest({
    body: {
      method: { required: true, type: "string", enum: ["sms", "totp", "email"] },
      phoneNumber: { type: "string" },
      email: { type: "string" },
    },
  }),
  setupTwoFactor
);

router.post(
  "/confirm-setup",
  authenticate,
  authRateLimiter,
  validateRequest({
    body: {
      method: { required: true, type: "string", enum: ["sms", "totp", "email"] },
      code: { required: true, type: "string", minLength: 6, maxLength: 8 },
    },
  }),
  confirmSetupTwoFactor
);

router.post(
  "/disable",
  authenticate,
  authRateLimiter,
  validateRequest({
    body: {
      password: { type: "string" },
    },
  }),
  disableTwoFactorHandler
);

router.get("/status", authenticate, getStatus);

router.post(
  "/regenerate-backup-codes",
  authenticate,
  authRateLimiter,
  validateRequest({
    body: {
      password: { type: "string" },
    },
  }),
  regenerateBackupCodesHandler
);

module.exports = router;
