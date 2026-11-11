const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const {
  seedStatus,
  provisionUser,
  reprovisionUser,
  getProvisioningStatus,
  runSeed
} = require('../../controllers/dev.controller');

const router = express.Router();

router.get('/seed-status', seedStatus);
router.post('/run-seed', runSeed);

router.post(
  '/provision-user',
  validateRequest({
    body: {
      email: { required: true, type: 'string', email: true },
      fullName: { type: 'string', maxLength: 255 },
      password: { type: 'string', minLength: 8 },
      profileType: { type: 'string' }
    }
  }),
  provisionUser
);

router.post(
  '/provision-user/:userId',
  validateRequest({
    params: {
      userId: { required: true, type: 'string', uuid: true }
    }
  }),
  reprovisionUser
);

router.get(
  '/provision-user/:userId/status',
  validateRequest({
    params: {
      userId: { required: true, type: 'string', uuid: true }
    }
  }),
  getProvisioningStatus
);

module.exports = router;
