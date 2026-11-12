const express = require('express');
const { validateRequest } = require('../../../middleware/validateRequest');
const { authenticateAdmin, requireAdminRole } = require('../../../middleware/admin/authenticateAdmin');
const {
  listAdminUsersHandler,
  listAdminReferralUsersHandler
} = require('../../../controllers/admin/users.controller');

const router = express.Router();

router.get(
  '/',
  authenticateAdmin,
  requireAdminRole('SUPER_ADMIN'),
  validateRequest({
    query: {
      page: { type: 'string', minLength: 1, maxLength: 6 },
      limit: { type: 'string', minLength: 1, maxLength: 6 }
    }
  }),
  listAdminUsersHandler
);

router.get(
  '/:userId/referrals/:referralId/users',
  authenticateAdmin,
  requireAdminRole('SUPER_ADMIN'),
  validateRequest({
    params: {
      userId: { required: true, type: 'string', uuid: true },
      referralId: { required: true, type: 'string', uuid: true }
    },
    query: {
      page: { type: 'string', minLength: 1, maxLength: 6 },
      limit: { type: 'string', minLength: 1, maxLength: 6 }
    }
  }),
  listAdminReferralUsersHandler
);

module.exports = router;
