const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { validateRequest } = require('../../middleware/validateRequest');
const {
  verifyCreditIdentity,
  getCreditStatusHandler,
  getCreditScoreHandler,
  getCreditHistoryHandler,
  refreshCreditScoreHandler
} = require('../../controllers/credit.controller');

const router = express.Router();

function redactCreditPii(req, _res, next) {
  req.redactRequestBody = true;
  return next();
};

router.use(authenticate);

router.post(
  '/verify',
  redactCreditPii,
  validateRequest({
    body: {
      full_legal_name: { type: 'string', maxLength: 255, required: true },
      date_of_birth: { type: 'string', maxLength: 50, required: true },
      ssn_last4: { type: 'string', maxLength: 4, minLength: 4, required: true },
      address: { type: 'object' }
    }
  }),
  authorizeProfile({ requiredRole: 'owner' }),
  verifyCreditIdentity
);

router.get(
  '/status',
  authorizeProfile(),
  getCreditStatusHandler
);

router.get(
  '/score',
  authorizeProfile(),
  getCreditScoreHandler
);

router.get(
  '/history',
  authorizeProfile(),
  getCreditHistoryHandler
);

router.post(
  '/refresh',
  authorizeProfile({ requiredRole: 'owner' }),
  refreshCreditScoreHandler
);

module.exports = router;
