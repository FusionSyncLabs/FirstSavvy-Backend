const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const {
  listBudgets,
  listSuggestedBudgets,
  getBudget,
  createBudget,
  updateBudget,
  deleteBudget,
  getHistoricalSpending,
  getVendorBreakdown,
  getTransactionPatterns,
  getBudgetPerformanceHistory,
  getMonthlyActuals,
  getSpendingForecast,
  getComparativeAnalysis
} = require('../../controllers/budget.controller');

const router = express.Router();

const budgetParamSchema = {
  budgetId: { required: true, type: 'string', uuid: true }
};
const categoryAccountParamSchema = {
  categoryAccountId: { required: true, type: 'string', uuid: true }
};
const analyticsQuerySchema = {
  monthsBack: { type: 'string' },
  childAccountIds: { type: 'string' },
  month: { type: 'string' },
  transactionType: { type: 'string', enum: ['income', 'expense'] }
};

router.use(authenticate);

router.get(
  '/',
  validateRequest({
    query: {
      isActive: { type: 'string', enum: ['true', 'false'] }
    }
  }),
  authorizeProfile(),
  listBudgets
);

router.get(
  '/suggestions',
  authorizeProfile(),
  listSuggestedBudgets
);

router.get(
  '/analytics/historical-spending/:categoryAccountId',
  validateRequest({ params: categoryAccountParamSchema, query: analyticsQuerySchema }),
  authorizeProfile(),
  getHistoricalSpending
);

router.get(
  '/analytics/vendor-breakdown/:categoryAccountId',
  validateRequest({ params: categoryAccountParamSchema, query: analyticsQuerySchema }),
  authorizeProfile(),
  getVendorBreakdown
);

router.get(
  '/analytics/transaction-patterns/:categoryAccountId',
  validateRequest({ params: categoryAccountParamSchema }),
  authorizeProfile(),
  getTransactionPatterns
);

router.get(
  '/analytics/performance-history/:categoryAccountId',
  validateRequest({ params: categoryAccountParamSchema, query: analyticsQuerySchema }),
  authorizeProfile(),
  getBudgetPerformanceHistory
);

router.get(
  '/analytics/monthly-actuals/:categoryAccountId',
  validateRequest({ params: categoryAccountParamSchema, query: analyticsQuerySchema }),
  authorizeProfile(),
  getMonthlyActuals
);

router.get(
  '/analytics/spending-forecast/:categoryAccountId',
  validateRequest({ params: categoryAccountParamSchema }),
  authorizeProfile(),
  getSpendingForecast
);

router.get(
  '/analytics/comparative-analysis/:categoryAccountId',
  validateRequest({ params: categoryAccountParamSchema, query: analyticsQuerySchema }),
  authorizeProfile(),
  getComparativeAnalysis
);

const budgetBodySchema = {
  chart_account_id: { type: 'string', uuid: true },
  name: { type: 'string', maxLength: 255 },
  custom_name: { type: 'string', maxLength: 255 },
  amount: { type: 'number' },
  allocated_amount: { type: 'number' },
  cadence: { type: 'string', enum: ['monthly', 'weekly', 'biweekly', 'quarterly', 'yearly'] },
  month: { type: 'number' },
  year: { type: 'number' },
  rollover_enabled: { type: 'boolean' },
  rollover_amount: { type: 'number' },
  accumulated_rollover: { type: 'number' },
  parent_budget_id: { type: 'string', uuid: true },
  is_active: { type: 'boolean' },
  metadata: { type: 'object' }
};

router.post(
  '/',
  authorizeProfile({ requiredRole: 'editor' }),
  validateRequest({
    body: {
      ...budgetBodySchema,
      chart_account_id: { required: true, type: 'string', uuid: true }
    }
  }),
  createBudget
);

router.get(
  '/:budgetId',
  validateRequest({ params: budgetParamSchema }),
  authorizeProfile(),
  getBudget
);

router.patch(
  '/:budgetId',
  validateRequest({ params: budgetParamSchema, body: budgetBodySchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  updateBudget
);

router.delete(
  '/:budgetId',
  validateRequest({ params: budgetParamSchema }),
  authorizeProfile({ requiredRole: 'editor' }),
  deleteBudget
);

module.exports = router;
