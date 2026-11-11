const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const {
  createSecretKeyHandler,
  verifySecretKeyHandler,
  getActiveSecretKeyHandler,
  expireSecretKeyHandler,
  deleteSecretKeyHandler,
} = require('../../controllers/secretKey.controller');

const router = express.Router();

router.post(
  '/',
  authenticate,
  validateRequest({
    body: {
      name: { type: 'string', maxLength: 100 },
    }
  }),
  createSecretKeyHandler
);

router.post(
  '/verify',
  authenticate,
  validateRequest({
    body: {
      key: { required: true, type: 'string' }
    }
  }),
  verifySecretKeyHandler
);

router.get(
  '/active',
  authenticate,
  getActiveSecretKeyHandler
);

router.post(
  '/:keyId/expire',
  authenticate,
  expireSecretKeyHandler
);

router.delete(
  '/:keyId',
  authenticate,
  deleteSecretKeyHandler
);

module.exports = router;