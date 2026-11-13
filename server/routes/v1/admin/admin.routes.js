const express = require('express');
const { validateRequest } = require('../../../middleware/validateRequest');
const { validateStrictAdminBody } = require('../../../validators/admin/admin.validators');
const { authenticateAdmin, requireAdminRole } = require('../../../middleware/admin/authenticateAdmin');
const { requireSuperAdminSetupEnabled } = require('../../../middleware/admin/requireSuperAdminSetupEnabled');
const { adminAuthRateLimiter } = require('../../../middleware/admin/adminAuthRateLimiter');
const { adminGeneralRateLimiter } = require('../../../middleware/admin/adminGeneralRateLimiter');
const {
  setupSuperAdminHandler,
  loginAdminHandler,
  refreshAdminHandler,
  logoutAdminHandler,
  currentAdminHandler,
  createSubAdminHandler
} = require('../../../controllers/admin/admin.controller');
const usersRoutes = require('./users.routes');

const router = express.Router();

router.post(
  '/setup-super-admin',
  requireSuperAdminSetupEnabled,
  adminAuthRateLimiter,
  validateRequest({
    body: {
      secret_key: { required: true, type: 'string', minLength: 32, maxLength: 4096 },
      name: { required: true, type: 'string', minLength: 1, maxLength: 100 },
      email: { required: true, type: 'string', email: true, maxLength: 320 },
      password: { required: true, type: 'string', minLength: 8, maxLength: 72 }
    }
  }),
  setupSuperAdminHandler
);

router.post(
  '/login',
  adminAuthRateLimiter,
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true, maxLength: 320 },
      password: { required: true, type: 'string', minLength: 1, maxLength: 72 }
    }
  }),
  loginAdminHandler
);

router.post('/refresh', adminAuthRateLimiter, refreshAdminHandler);
router.post('/logout', authenticateAdmin, adminGeneralRateLimiter, logoutAdminHandler);
router.get('/me', authenticateAdmin, adminGeneralRateLimiter, currentAdminHandler);
router.use('/users', usersRoutes);

router.post(
  '/sub-admins',
  authenticateAdmin,
  adminGeneralRateLimiter,
  requireAdminRole('SUPER_ADMIN'),
  validateStrictAdminBody({
    name: { required: true, type: 'string', minLength: 1, maxLength: 100 },
    email: { required: true, type: 'string', email: true, maxLength: 320 },
    password: { required: true, type: 'string', minLength: 8, maxLength: 72 }
  }),
  createSubAdminHandler
);

module.exports = router;
