const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { authRateLimiter } = require('../../middleware/rateLimit');
const {
  register,
  login,
  loginWithPhoneOrEmail,
  phoneLogin,
  childLogin,
  refresh,
  logout,
  me,
  changePassword,
  forgotPassword,
  deleteAccount,
  resetUserPassword,
  startGoogleOAuth,
  googleOAuthCallback,
  verifyPasswordHandler,
  verifyIdentityHandler,
  completeTwoFactorLogin,
  acceptInvitationPasswordHandler,
  getInvitationStatusHandler,
  validateReferralHandler,
  acceptInvitationLoginHandler,
  acceptInvitationAuthenticatedHandler,
  searchUsersHandler,
  checkUserExists,
  createInvitedUser
} = require('../../controllers/auth.controller');

const router = express.Router();

router.post(
  '/register',
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true },
      fullName: { type: 'string', maxLength: 255 },
      password: { required: true, type: 'string', minLength: 8 },
      phone: { type: 'string', minLength: 10, maxLength: 20 },
      referral: { type: 'string' },
      profileType: {
        type: 'string',
        enum: ['personal', 'household', 'business', 'real_estate', 'passive', 'holding_company']
      }
    }
  }),
  register
);

router.post(
  '/login',
  authRateLimiter,
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true },
      password: { required: true, type: 'string' }
    }
  }),
  login
);

router.post(
  '/login-unified',
  authRateLimiter,
  validateRequest({
    body: {
      identifier: { required: true, type: 'string' },
      password: { required: true, type: 'string' }
    }
  }),
  loginWithPhoneOrEmail
);

router.post(
  '/phone-login',
  authRateLimiter,
  validateRequest({
    body: {
      phone: { required: true, type: 'string', minLength: 10 },
      password: { type: 'string' }
    }
  }),
  phoneLogin
);

router.post(
  '/child-login',
  authRateLimiter,
  validateRequest({
    body: {
      usernameOrEmail: { required: true, type: 'string', minLength: 3, maxLength: 320 },
      pin: { required: true, type: 'string', minLength: 4, maxLength: 6 }
    }
  }),
  childLogin
);

router.post('/refresh', refresh);
router.post('/logout', logout);
router.get('/me', authenticate, me);
router.patch(
  '/password',
  authenticate,
  validateRequest({
    body: {
      currentPassword: { type: 'string' },
      newPassword: { required: true, type: 'string', minLength: 8 }
    }
  }),
  changePassword
);
router.get('/google', startGoogleOAuth);
router.get('/google/callback', googleOAuthCallback);

router.post(
  '/forgot-password',
  authRateLimiter,
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true }
    }
  }),
  forgotPassword
);

router.post(
  '/reset-password',
  authRateLimiter,
  validateRequest({
    body: {
      token: { required: true, type: 'string', minLength: 20 },
      password: { required: true, type: 'string', minLength: 8 }
    }
  }),
  resetUserPassword
);

router.get(
  '/users/search',
  authenticate,
  validateRequest({
    query: {
      q: { required: true, type: 'string', minLength: 2 }
    }
  }),
  searchUsersHandler
);

router.get(
  '/users/exists',
  authenticate,
  validateRequest({
    query: {
      email: { required: true, type: 'string', email: true }
    }
  }),
  checkUserExists
);

router.post(
  '/create-invited',
  authenticate,
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true },
      fullName: { required: true, type: 'string', minLength: 1, maxLength: 255 },
      referral: { type: 'string' },
      inviterName: { type: 'string' },
      profileType: {
        type: 'string',
        enum: ['personal', 'household', 'business', 'real_estate', 'passive', 'holding_company']
      }
    }
  }),
  createInvitedUser
);

router.post(
  '/verify-password',
  authenticate,
  validateRequest({
    body: {
      password: { required: true, type: 'string' }
    }
  }),
  verifyPasswordHandler
);

router.post(
  '/verify-identity',
  authenticate,
  validateRequest({
    body: {
      method: { required: true, type: 'string', enum: ['password', 'secretKey'] },
      password: { type: 'string' },
      secretKey: { type: 'string' }
    }
  }),
  verifyIdentityHandler
);

router.post(
  '/complete-two-factor',
  authRateLimiter,
  validateRequest({
    body: {
      userId: { type: 'string' },
      completionToken: { required: true, type: 'string' }
    }
  }),
  completeTwoFactorLogin
);

router.post(
  '/accept-invitation-password',
  authRateLimiter,
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true },
      password: { required: true, type: 'string', minLength: 8 },
      otp: { type: 'string' },
      token: { type: 'string' }
    }
  }),
  acceptInvitationPasswordHandler
);

router.get(
  '/invitation-status',
  authRateLimiter,
  validateRequest({
    query: {
      email: { required: true, type: 'string', email: true }
    }
  }),
  getInvitationStatusHandler
);

router.post(
  '/accept-invitation-login',
  authRateLimiter,
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true },
      password: { required: true, type: 'string' },
      invitationData: { required: false, type: 'object' }
    }
  }),
  acceptInvitationLoginHandler
);

router.post(
  '/accept-invitation-authenticated',
  authenticate,
  acceptInvitationAuthenticatedHandler
);

router.delete(
  '/account',
  authenticate,
  validateRequest({
    body: {
      password: { required: true, type: 'string', minLength: 8 },
      transferOwnerUserId: { type: 'string' },
      transfer_owner_user_id: { type: 'string' }
    }
  }),
  deleteAccount
);

module.exports = router;
