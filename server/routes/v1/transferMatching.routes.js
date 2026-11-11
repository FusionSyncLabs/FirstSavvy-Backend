const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { validateRequest } = require('../../middleware/validateRequest');
const {
  findTransferMatches,
  pairTransfers,
  unmatchTransfer,
  autoMatchTransfers
} = require('../../controllers/transferMatching.controller');

const router = express.Router();

router.use(authenticate);

router.get(
  '/candidates/:transactionId',
  validateRequest({ params: { transactionId: { required: true, type: 'string', uuid: true } } }),
  authorizeProfile(),
  findTransferMatches
);

router.post(
  '/',
  validateRequest({
    body: {
      transactionId: { required: true, type: 'string', uuid: true },
      matchedTransactionId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  pairTransfers
);

router.delete(
  '/:transactionId',
  validateRequest({ params: { transactionId: { required: true, type: 'string', uuid: true } } }),
  authorizeProfile({ requiredRole: 'editor' }),
  unmatchTransfer
);

router.post(
  '/auto',
  validateRequest({ body: { minConfidence: { type: 'number' } } }),
  authorizeProfile({ requiredRole: 'editor' }),
  autoMatchTransfers
);

module.exports = router;
