const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const {
  getStatus,
  createLinkToken,
  createUpdateLinkToken,
  exchangePublicToken,
  syncPlaidItem,
  disconnectItem,
  unlinkAccount,
  mapAccounts,
  refreshBalance
} = require('../../controllers/plaid.controller');

const router = express.Router();

router.use(authenticate);
router.use(authorizeProfile());
router.get('/status', getStatus);
router.post('/link-token', createLinkToken);
router.post('/item/:itemId/link-token', createUpdateLinkToken);
router.post('/exchange-token', exchangePublicToken);
router.post('/sync', syncPlaidItem);
router.delete('/item/:itemId', disconnectItem);
router.delete('/account/:accountId/unlink', unlinkAccount);
router.post('/account/:accountId/unlink', unlinkAccount);
router.post('/map-accounts', mapAccounts);
router.post('/account/:accountId/refresh-balance', refreshBalance);

module.exports = router;
