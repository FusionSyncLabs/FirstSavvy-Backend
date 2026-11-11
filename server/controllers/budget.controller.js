const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listBudgetsForProfile,
  getBudgetForProfile,
  createBudgetForProfile,
  updateBudgetForProfile,
  deleteBudgetForProfile,
  listSuggestedBudgetsForProfile
} = require('../services/budget.service');
const {
  getHistoricalSpendingForProfile,
  getVendorBreakdownForProfile,
  getTransactionPatternsForProfile,
  getBudgetPerformanceHistoryForProfile,
  getMonthlyActualsForProfile,
  getSpendingForecastForProfile,
  getComparativeAnalysisForProfile
} = require('../services/budgetAnalytics.service');

const listBudgets = asyncHandler(async (req, res) => {
  return ok(res, await listBudgetsForProfile(req.profileAccess.profileId, req.query));
});

const listSuggestedBudgets = asyncHandler(async (req, res) => {
  return ok(res, await listSuggestedBudgetsForProfile(req.profileAccess.profileId, req.query));
});

const getBudget = asyncHandler(async (req, res) => {
  return ok(res, {
    budget: await getBudgetForProfile(req.profileAccess.profileId, req.params.budgetId)
  });
});

const createBudget = asyncHandler(async (req, res) => {
  return created(res, {
    budget: await createBudgetForProfile(req.profileAccess.profileId, req.body)
  });
});

const updateBudget = asyncHandler(async (req, res) => {
  return ok(res, {
    budget: await updateBudgetForProfile(req.profileAccess.profileId, req.params.budgetId, req.body)
  });
});

const deleteBudget = asyncHandler(async (req, res) => {
  return ok(res, await deleteBudgetForProfile(req.profileAccess.profileId, req.params.budgetId));
});

const getHistoricalSpending = asyncHandler(async (req, res) => {
  return ok(res, {
    historicalSpending: await getHistoricalSpendingForProfile(
      req.profileAccess.profileId,
      req.params.categoryAccountId,
      req.query
    )
  });
});

const getVendorBreakdown = asyncHandler(async (req, res) => {
  return ok(res, {
    vendorBreakdown: await getVendorBreakdownForProfile(
      req.profileAccess.profileId,
      req.params.categoryAccountId,
      req.query
    )
  });
});

const getTransactionPatterns = asyncHandler(async (req, res) => {
  return ok(res, {
    transactionPatterns: await getTransactionPatternsForProfile(
      req.profileAccess.profileId,
      req.params.categoryAccountId
    )
  });
});

const getBudgetPerformanceHistory = asyncHandler(async (req, res) => {
  return ok(res, {
    performanceHistory: await getBudgetPerformanceHistoryForProfile(
      req.profileAccess.profileId,
      req.params.categoryAccountId,
      req.query
    )
  });
});

const getMonthlyActuals = asyncHandler(async (req, res) => {
  return ok(res, {
    monthlyActuals: await getMonthlyActualsForProfile(
      req.profileAccess.profileId,
      req.params.categoryAccountId,
      req.query
    )
  });
});

const getSpendingForecast = asyncHandler(async (req, res) => {
  return ok(res, {
    spendingForecast: await getSpendingForecastForProfile(
      req.profileAccess.profileId,
      req.params.categoryAccountId
    )
  });
});

const getComparativeAnalysis = asyncHandler(async (req, res) => {
  return ok(res, {
    comparativeAnalysis: await getComparativeAnalysisForProfile(
      req.profileAccess.profileId,
      req.params.categoryAccountId,
      req.query
    )
  });
});

module.exports = {
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
};
