const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { getNetWorthSummaryForProfile } = require('../services/netWorth.service');
const { getNetWorthForecastForProfile } = require('../services/netWorthForecast.service');

const getNetWorthSummary = asyncHandler(async (req, res) => {
  return ok(res, {
    summary: await getNetWorthSummaryForProfile(req.profileAccess.profileId, {
      scope: req.query.scope
    })
  });
});

const getNetWorthForecast = asyncHandler(async (req, res) => {
  try {
    const profileId = req.profileAccess?.profileId;
    if (!profileId) {
      return ok(res, { forecast: null });
    }
    const forecast = await getNetWorthForecastForProfile(profileId, {
      range: req.query.range,
      targetAge: req.query.targetAge ? Number(req.query.targetAge) : 65,
      currentAge: req.query.currentAge ? Number(req.query.currentAge) : 30,
      scenario: req.query.scenario || 'expected',
      scope: req.query.scope || 'household',
      monthlyAdditionalSavings: req.query.monthlyAdditionalSavings ? Number(req.query.monthlyAdditionalSavings) : 0,
      expectedReturnRate: req.query.expectedReturnRate ? Number(req.query.expectedReturnRate) : null
    });

    return ok(res, { forecast });
  } catch (err) {
    console.error('getNetWorthForecast controller error:', err);
    return ok(res, {
      forecast: {
        computedAt: new Date().toISOString(),
        currentNetWorth: 0,
        totalAssets: 0,
        totalLiabilities: 0,
        cashFlow: { monthlyActual: 0, monthlyExpensesActual: 0, monthlyBudgeted: null, monthlyBlended: 0, dataMonths: 1, transactionCount: 0 },
        historical: [],
        projections: { conservative: [], expected: [], optimistic: [] },
        activeScenario: req.query.scenario || 'expected',
        milestones: {},
        assumptions: {}
      }
    });
  }
});

module.exports = {
  getNetWorthSummary,
  getNetWorthForecast
};
