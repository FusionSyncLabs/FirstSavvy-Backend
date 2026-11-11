const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  duplicateRule,
  getMatchPreview,
  applyRule
} = require('../../controllers/transactionRule.controller');

const router = express.Router();

const ruleParamSchema = {
  ruleId: { required: true, type: 'string', uuid: true }
};

router.use(authenticate);

router.get(
  '/',
  validateRequest({
    query: {
      enabled: { type: 'string', enum: ['true', 'false'] },
      sortBy: { type: 'string', maxLength: 50 }
    }
  }),
  authorizeProfile(),
  listRules
);

router.post('/', authorizeProfile({ requiredRole: 'editor' }), createRule);
router.post('/preview', authorizeProfile(), getMatchPreview);

router.get(
  '/:ruleId',
  validateRequest({ params: ruleParamSchema }),
  authorizeProfile(),
  getRule
);

router.patch(
  '/:ruleId',
  validateRequest({ params: ruleParamSchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  updateRule
);

router.delete(
  '/:ruleId',
  validateRequest({ params: ruleParamSchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  deleteRule
);

router.post(
  '/:ruleId/duplicate',
  validateRequest({ params: ruleParamSchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  duplicateRule
);

router.post(
  '/:ruleId/apply',
  validateRequest({ params: ruleParamSchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  applyRule
);

module.exports = router;
