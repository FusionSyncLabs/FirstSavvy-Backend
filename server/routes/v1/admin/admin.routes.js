const express = require('express');
const { validateRequest } = require('../../../middleware/validateRequest');
const { authenticateAdmin, requireAdminRole } = require('../../../middleware/admin/authenticateAdmin');
const { authRateLimiter } = require('../../../middleware/rateLimit');
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
  authRateLimiter,
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
  authRateLimiter,
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true, maxLength: 320 },
      password: { required: true, type: 'string', minLength: 1, maxLength: 72 }
    }
  }),
  loginAdminHandler
);

router.post('/refresh', authRateLimiter, refreshAdminHandler);
router.post('/logout', authenticateAdmin, logoutAdminHandler);
router.get('/me', authenticateAdmin, currentAdminHandler);
router.use('/users', usersRoutes);

router.post(
  '/sub-admins',
  authenticateAdmin,
  requireAdminRole('SUPER_ADMIN'),
  validateRequest({
    body: {
      name: { required: true, type: 'string', minLength: 1, maxLength: 100 },
      email: { required: true, type: 'string', email: true, maxLength: 320 },
      password: { required: true, type: 'string', minLength: 8, maxLength: 72 }
    }
  }),
  createSubAdminHandler
);

module.exports = router;
