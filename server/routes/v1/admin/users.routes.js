const express = require('express');
const { validateRequest } = require('../../../middleware/validateRequest');
const { validateAdminPaginationQuery } = require('../../../validators/admin/admin.validators');
const { authenticateAdmin, requireAdminRole } = require('../../../middleware/admin/authenticateAdmin');
const { adminGeneralRateLimiter } = require('../../../middleware/admin/adminGeneralRateLimiter');
const {
  listAdminUsersHandler,
  listAdminReferralUsersHandler
} = require('../../../controllers/admin/users.controller');

const router = express.Router();

router.get(
  '/',
  authenticateAdmin,
  adminGeneralRateLimiter,
  requireAdminRole('SUPER_ADMIN'),
  validateAdminPaginationQuery,
  listAdminUsersHandler
);

router.get(
  '/:userId/referrals/:referralId/users',
  authenticateAdmin,
  adminGeneralRateLimiter,
  requireAdminRole('SUPER_ADMIN'),
  validateRequest({
    params: {
      userId: { required: true, type: 'string', uuid: true },
      referralId: { required: true, type: 'string', uuid: true }
    }
  }),
  validateAdminPaginationQuery,
  listAdminReferralUsersHandler
);

module.exports = router;
