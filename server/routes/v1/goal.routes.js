const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const {
  listGoals,
  getGoalSummary,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  listContributions,
  createContribution,
  updateContribution,
  deleteContribution
} = require('../../controllers/goal.controller');

const router = express.Router();

const goalParamSchema = {
  goalId: { required: true, type: 'string', uuid: true }
};

const contributionParamSchema = {
  goalId: { required: true, type: 'string', uuid: true },
  contributionId: { required: true, type: 'string', uuid: true }
};

const goalBodySchema = {
  name: { type: 'string', maxLength: 255 },
  description: { type: 'string', maxLength: 5000 },
  target_amount: { type: 'number' },
  target_date: { type: 'string' },
  linked_account_id: { type: 'string', uuid: true },
  child_profile_id: { type: 'string', uuid: true },
  icon: { type: 'string', maxLength: 100 },
  color: { type: 'string', maxLength: 32 },
  status: { type: 'string', enum: ['active', 'completed', 'paused', 'archived'] },
  metadata: { type: 'object' }
};

const contributionBodySchema = {
  transaction_id: { type: 'string', uuid: true },
  transactionId: { type: 'string', uuid: true },
  transaction: { type: 'object' },
  notes: { type: 'string', maxLength: 5000 },
  metadata: { type: 'object' }
};

const listQuerySchema = {
  page: { type: 'string' },
  limit: { type: 'string' },
  search: { type: 'string', maxLength: 255 },
  status: { type: 'string', enum: ['active', 'completed', 'paused', 'archived'] },
  includeCompleted: { type: 'string', enum: ['true', 'false'] },
  childProfileId: { type: 'string', uuid: true },
  orderBy: { type: 'string', maxLength: 50 },
  includeContributions: { type: 'string', enum: ['true', 'false'] }
};

router.use(authenticate);

router.get(
  '/summary',
  authorizeProfile(),
  getGoalSummary
);

router.get(
  '/',
  validateRequest({ query: listQuerySchema }),
  authorizeProfile(),
  listGoals
);

router.post(
  '/',
  validateRequest({
    body: {
      ...goalBodySchema,
      name: { required: true, type: 'string', maxLength: 255 },
      target_amount: { required: true, type: 'number' },
      linked_account_id: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  createGoal
);

router.get(
  '/:goalId',
  validateRequest({ params: goalParamSchema, query: { includeContributions: { type: 'string', enum: ['true', 'false'] } } }),
  authorizeProfile(),
  getGoal
);

router.patch(
  '/:goalId',
  validateRequest({ params: goalParamSchema, body: goalBodySchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  updateGoal
);

router.delete(
  '/:goalId',
  validateRequest({ params: goalParamSchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  deleteGoal
);


// Contributions routes
router.get(
  '/:goalId/contributions',
  validateRequest({ params: goalParamSchema, query: { page: { type: 'string' }, limit: { type: 'string' } } }),
  authorizeProfile(),
  listContributions
);

router.post(
  '/:goalId/contributions',
  validateRequest({
    params: goalParamSchema,
    body: contributionBodySchema
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  createContribution
);

router.patch(
  '/:goalId/contributions/:contributionId',
  validateRequest({
    params: contributionParamSchema,
    body: { notes: { type: 'string', maxLength: 5000 } }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  updateContribution
);

router.delete(
  '/:goalId/contributions/:contributionId',
  validateRequest({ params: contributionParamSchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  deleteContribution
);

module.exports = router;
