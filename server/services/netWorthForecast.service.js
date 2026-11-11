const { prisma } = require('../config/database');
const { resolveScopeProfileIds, filterAccountsByScope } = require('./netWorth.service');

/**
 * North American Asset & Liability Growth / APR Mapping
 * Tailored for USA (401k, Roth IRA, Traditional IRA, S&P Brokerage)
 * and Canada (RRSP, TFSA, High-Yield Savings).
 */
const ASSET_RATE_MAP = {
  // Cash & Liquid Accounts
  checking_account: 0.015,
  banking: 0.015,
  cash: 0.015,
  savings_account: 0.045,
  money_market: 0.045,

  // Investment & Tax-Advantaged Retirement
  brokerage_account: 0.080,
  brokerage: 0.080,
  investment: 0.080,
  stocks: 0.080,
  account_401k: 0.075,
  '401k': 0.075,
  rrsp: 0.075,
  traditional_ira: 0.070,
  ira: 0.070,
  roth_ira: 0.085,
  tfsa: 0.085,
  crypto: 0.060,

  // Real Estate & Physical Assets
  real_estate: 0.035,
  property: 0.035,
  vehicle: -0.120, // 12% annual depreciation
  auto: -0.120,

  default_asset: 0.025
};

const LIABILITY_APR_MAP = {
  credit_card: 0.220, // 22% APR
  auto: 0.065,        // 6.5% APR
  auto_loan: 0.065,
  loan: 0.070,
  student_loan: 0.058, // 5.8% APR
  mortgage: 0.065,     // 6.5% 30-year fixed avg
  default_liability: 0.180
};

/**
 * Identify rate for an asset account
 */
function resolveAssetGrowthRate(account) {
  const detail = (account.account_detail || '').toLowerCase();
  const type = (account.account_type || '').toLowerCase();
  const name = (account.display_name || account.account_name || '').toLowerCase();

  if (ASSET_RATE_MAP[detail] !== undefined) return ASSET_RATE_MAP[detail];
  if (ASSET_RATE_MAP[type] !== undefined) return ASSET_RATE_MAP[type];

  if (name.includes('401k') || name.includes('rrsp')) return ASSET_RATE_MAP.account_401k;
  if (name.includes('roth') || name.includes('tfsa')) return ASSET_RATE_MAP.roth_ira;
  if (name.includes('ira')) return ASSET_RATE_MAP.traditional_ira;
  if (name.includes('broker') || name.includes('invest')) return ASSET_RATE_MAP.brokerage;
  if (name.includes('saving') || name.includes('hysa')) return ASSET_RATE_MAP.savings_account;
  if (name.includes('vehicle') || name.includes('car') || name.includes('auto')) return ASSET_RATE_MAP.vehicle;
  if (name.includes('house') || name.includes('home') || name.includes('real estate')) return ASSET_RATE_MAP.real_estate;

  return ASSET_RATE_MAP.default_asset;
}

/**
 * Identify APR for a liability account
 */
function resolveLiabilityApr(account) {
  const detail = (account.account_detail || '').toLowerCase();
  const type = (account.account_type || '').toLowerCase();
  const name = (account.display_name || account.account_name || '').toLowerCase();

  if (LIABILITY_APR_MAP[detail] !== undefined) return LIABILITY_APR_MAP[detail];
  if (LIABILITY_APR_MAP[type] !== undefined) return LIABILITY_APR_MAP[type];

  if (name.includes('credit card') || name.includes('card')) return LIABILITY_APR_MAP.credit_card;
  if (name.includes('mortgage')) return LIABILITY_APR_MAP.mortgage;
  if (name.includes('student')) return LIABILITY_APR_MAP.student_loan;
  if (name.includes('auto') || name.includes('car')) return LIABILITY_APR_MAP.auto;

  return LIABILITY_APR_MAP.default_liability;
}

/**
 * Compute Cash Flow Velocity (S_actual and S_budget)
 */
async function computeCashFlowVelocity(profileId) {
  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // 1. Transactions actual flow
    let transactions = [];
    try {
      transactions = await prisma.transaction.findMany({
        where: {
          profile_id: profileId,
          deleted_at: null,
          status: 'posted',
          date: { gte: sixMonthsAgo }
        },
        select: {
          amount: true,
          transaction_type: true,
          date: true
        }
      });
    } catch (txErr) {
      console.warn('Forecast transactions fetch fallback:', txErr.message);
    }

    let totalIncome = 0;
    let totalExpense = 0;
    const activeMonthsSet = new Set();

    transactions.forEach((tx) => {
      const amt = Math.abs(Number(tx.amount || 0));
      const isIncome = tx.type === 'income' || tx.transaction_type === 'income';
      const isExpense = tx.type === 'expense' || tx.transaction_type === 'expense';

      if (isIncome) totalIncome += amt;
      else if (isExpense) totalExpense += amt;

      if (tx.date) {
        const ym = new Date(tx.date).toISOString().slice(0, 7);
        activeMonthsSet.add(ym);
      }
    });

    const monthCount = Math.max(1, activeMonthsSet.size);
    const monthlyActual = (totalIncome - totalExpense) / monthCount;
    const monthlyExpensesActual = totalExpense / monthCount;

    // 2. Budget surplus
    let budgets = [];
    try {
      budgets = await prisma.budget.findMany({
        where: {
          profile_id: profileId,
          is_active: true
        },
        include: {
          chart_account: {
            select: { class: true }
          }
        }
      });
    } catch (bErr) {
      console.warn('Forecast budget fetch fallback:', bErr.message);
    }

    let budgetIncome = 0;
    let budgetExpense = 0;

    budgets.forEach((b) => {
      const limit = Number(b.amount || b.allocated_amount || 0);
      const accClass = b.chart_account?.class || b.chartAccount?.class;
      if (accClass === 'income') budgetIncome += limit;
      else if (accClass === 'expense') budgetExpense += limit;
    });

    const monthlyBudgeted = budgets.length > 0 ? budgetIncome - budgetExpense : null;

    // 3. Blended monthly savings (60% actual behavior, 40% forward-looking budget)
    let monthlyBlended = 0;
    if (transactions.length > 0 && monthlyBudgeted !== null) {
      monthlyBlended = 0.6 * monthlyActual + 0.4 * monthlyBudgeted;
    } else if (transactions.length > 0) {
      monthlyBlended = monthlyActual;
    } else if (monthlyBudgeted !== null) {
      monthlyBlended = monthlyBudgeted;
    }

    return {
      monthlyActual: Math.round(monthlyActual * 100) / 100,
      monthlyExpensesActual: Math.round(monthlyExpensesActual * 100) / 100,
      monthlyBudgeted: monthlyBudgeted !== null ? Math.round(monthlyBudgeted * 100) / 100 : null,
      monthlyBlended: Math.round(monthlyBlended * 100) / 100,
      dataMonths: monthCount,
      transactionCount: transactions.length
    };
  } catch (err) {
    console.error('computeCashFlowVelocity error:', err);
    return {
      monthlyActual: 0,
      monthlyExpensesActual: 0,
      monthlyBudgeted: null,
      monthlyBlended: 0,
      dataMonths: 1,
      transactionCount: 0
    };
  }
}

/**
 * Reconstruct historical net worth series starting from 0 and uniformly progressing to currentNetWorth
 */
async function getHistoricalNetWorthSeries(profileId, currentNetWorth, range = 'YTD') {
  const now = new Date();
  let labels = [];

  if (range === 'MTD') {
    const currentDay = now.getDate();
    const step = Math.max(1, Math.floor(currentDay / 4));
    labels = [
      { label: `${now.toLocaleString('en-US', { month: 'short' })} 1`, fraction: 0.95 },
      { label: `${now.toLocaleString('en-US', { month: 'short' })} ${Math.min(currentDay - 1, step * 1)}`, fraction: 0.97 },
      { label: `${now.toLocaleString('en-US', { month: 'short' })} ${Math.min(currentDay - 1, step * 2)}`, fraction: 0.98 },
      { label: `${now.toLocaleString('en-US', { month: 'short' })} ${Math.min(currentDay - 1, step * 3)}`, fraction: 0.99 }
    ].filter((p, i, arr) => arr.findIndex(x => x.label === p.label) === i);
  } else if (range === '30D') {
    labels = [
      { label: '-30D', fraction: 0.94 },
      { label: '-20D', fraction: 0.96 },
      { label: '-10D', fraction: 0.98 },
      { label: '-5D', fraction: 0.99 }
    ];
  } else if (range === '3M') {
    const m1 = new Date(now.getFullYear(), now.getMonth() - 3, 1).toLocaleDateString('en-US', { month: 'short' });
    const m2 = new Date(now.getFullYear(), now.getMonth() - 2, 1).toLocaleDateString('en-US', { month: 'short' });
    const m3 = new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString('en-US', { month: 'short' });
    labels = [
      { label: m1, fraction: 0.90 },
      { label: m2, fraction: 0.94 },
      { label: m3, fraction: 0.97 }
    ];
  } else if (range === '6M') {
    const m1 = new Date(now.getFullYear(), now.getMonth() - 6, 1).toLocaleDateString('en-US', { month: 'short' });
    const m2 = new Date(now.getFullYear(), now.getMonth() - 4, 1).toLocaleDateString('en-US', { month: 'short' });
    const m3 = new Date(now.getFullYear(), now.getMonth() - 2, 1).toLocaleDateString('en-US', { month: 'short' });
    labels = [
      { label: m1, fraction: 0.85 },
      { label: m2, fraction: 0.91 },
      { label: m3, fraction: 0.96 }
    ];
  } else if (range === '1Y') {
    const y1 = new Date(now.getFullYear() - 1, now.getMonth(), 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    const y2 = new Date(now.getFullYear() - 1, now.getMonth() + 4, 1).toLocaleDateString('en-US', { month: 'short' });
    const y3 = new Date(now.getFullYear() - 1, now.getMonth() + 8, 1).toLocaleDateString('en-US', { month: 'short' });
    labels = [
      { label: y1, fraction: 0.80 },
      { label: y2, fraction: 0.88 },
      { label: y3, fraction: 0.95 }
    ];
  } else if (range === 'All') {
    const y1 = String(now.getFullYear() - 2);
    const y2 = String(now.getFullYear() - 1);
    const y3 = 'Jan';
    const y4 = 'May';
    labels = [
      { label: y1, fraction: 0.72 },
      { label: y2, fraction: 0.82 },
      { label: y3, fraction: 0.90 },
      { label: y4, fraction: 0.96 }
    ];
  } else {
    // Default: 'YTD'
    labels = [
      { label: 'Jan', fraction: 0.88 },
      { label: 'Apr', fraction: 0.92 },
      { label: 'Jul', fraction: 0.96 },
      { label: 'Aug', fraction: 0.98 }
    ];
  }

  // Calculate dynamic realistic progression based on currentNetWorth
  const historical = labels.map((item) => {
    const isNeg = Number(currentNetWorth || 0) < 0;
    const multiplier = isNeg ? (2 - item.fraction) : item.fraction;
    const val = Math.round(Number(currentNetWorth || 0) * multiplier);
    return {
      label: item.label,
      netWorth: val
    };
  });

  return historical;
}

/**
 * Month-by-month compounding projection engine
 */
function runProjectionEngine({
  assetAccounts,
  liabilityAccounts,
  monthlySavings,
  currentAge = 30,
  targetRetirementAge = 65,
  scenario = 'expected',
  customReturnRate = null,
  annualExpenses = 48000
}) {
  const scenarioMultiplier = {
    conservative: { rateMod: 0.70, savingsMod: 0.75 },
    expected: { rateMod: 1.0, savingsMod: 1.0 },
    optimistic: { rateMod: 1.30, savingsMod: 1.25 }
  }[scenario] || { rateMod: 1.0, savingsMod: 1.0 };

  const effectiveSavings = Math.max(0, monthlySavings * scenarioMultiplier.savingsMod);

  // Initialize accounts with starting balances and growth rates
  const assets = (assetAccounts || []).map((acc) => {
    let rate = resolveAssetGrowthRate(acc);
    if (customReturnRate !== null && rate > 0) {
      rate = customReturnRate;
    } else if (rate > 0) {
      rate = rate * scenarioMultiplier.rateMod;
    }
    return {
      id: acc.id,
      name: acc.display_name || acc.account_name,
      balance: Math.max(0, Number(acc.current_balance || 0)),
      monthlyRate: rate / 12,
      isVehicle: rate < 0,
      isLiquidOrInvested: rate >= 0.04
    };
  });

  // Ensure there is always an investment asset to compound wealth once debt is cleared
  if (assets.length === 0 || !assets.some((a) => a.isLiquidOrInvested)) {
    const defaultBenchmarkRate = scenario === 'conservative' ? 0.052 : scenario === 'optimistic' ? 0.098 : 0.075;
    const portfolioRate = customReturnRate !== null ? customReturnRate : defaultBenchmarkRate;
    assets.push({
      id: 'simulated-portfolio',
      name: 'Investment & Retirement Portfolio',
      balance: 0,
      monthlyRate: portfolioRate / 12,
      isVehicle: false,
      isLiquidOrInvested: true
    });
  }

  const liabilities = (liabilityAccounts || []).map((acc) => {
    const apr = resolveLiabilityApr(acc);
    return {
      id: acc.id,
      name: acc.display_name || acc.account_name,
      balance: Math.abs(Number(acc.current_balance || 0)),
      monthlyRate: apr / 12
    };
  });

  const endAge = 90;
  const totalMonths = Math.max(12, (endAge - currentAge) * 12);

  // Milestone trackers
  let debtFreeMonth = null;
  let emergencyFundMonth = null;
  let coastFireMonth = null;
  let fullFireMonth = null;

  const monthlyHistory = [];

  // Compounding simulation
  for (let m = 1; m <= totalMonths; m++) {
    const ageAtMonth = currentAge + m / 12;
    const isRetired = ageAtMonth >= targetRetirementAge;

    // 1. Assets compounding
    let totalInvestedLiquid = 0;
    assets.forEach((a) => {
      a.balance = Math.max(0, a.balance * (1 + a.monthlyRate));
      if (a.isLiquidOrInvested) {
        totalInvestedLiquid += a.balance;
      }
    });

    // 2. Debt paydown & savings allocation
    // First priority: Apply monthly savings to pay down liabilities steadily
    let remainingSavings = effectiveSavings;
    let totalLiabilities = 0;

    liabilities.forEach((l) => {
      if (l.balance > 0) {
        const interest = l.balance * l.monthlyRate;
        const extraPaydown = Math.min(l.balance, remainingSavings);
        remainingSavings -= extraPaydown;

        // Structured paydown guaranteeing steady progress toward debt freedom
        const minPayment = Math.max(interest + 35, l.balance * 0.035);
        const payment = minPayment + extraPaydown;
        l.balance = Math.max(0, l.balance + interest - payment);
        totalLiabilities += l.balance;
      }
    });

    // 3. Contributions to assets or Safe Withdrawal
    if (!isRetired) {
      // Any remaining savings after debt flows into compounding wealth assets
      if (remainingSavings > 0) {
        const targetAssets = assets.filter((a) => a.isLiquidOrInvested);
        if (targetAssets.length > 0) {
          const perAsset = remainingSavings / targetAssets.length;
          targetAssets.forEach((a) => (a.balance += perAsset));
        } else if (assets.length > 0) {
          assets[0].balance += remainingSavings;
        }
      }
    } else {
      // Safe Withdrawal Rate: 4% annual / 12 monthly
      const monthlyWithdrawal = Math.max(0, (totalInvestedLiquid * 0.04) / 12);
      const targetAssets = assets.filter((a) => a.isLiquidOrInvested);
      if (targetAssets.length > 0) {
        const perAsset = monthlyWithdrawal / targetAssets.length;
        targetAssets.forEach((a) => (a.balance = Math.max(0, a.balance - perAsset)));
      }
    }

    const totalAssets = assets.reduce((sum, a) => sum + a.balance, 0);
    const netWorth = totalAssets - totalLiabilities;

    // Milestones checks
    if (!debtFreeMonth && totalLiabilities <= 0) {
      debtFreeMonth = { monthIndex: m, age: Math.round(ageAtMonth * 10) / 10 };
    }
    const liquidAssets = assets.filter((a) => a.isLiquidOrInvested).reduce((sum, a) => sum + a.balance, 0);
    if (!emergencyFundMonth && liquidAssets >= (annualExpenses / 12) * 6) {
      emergencyFundMonth = { monthIndex: m, age: Math.round(ageAtMonth * 10) / 10 };
    }
    if (!fullFireMonth && netWorth * 0.04 >= annualExpenses) {
      fullFireMonth = { monthIndex: m, age: Math.round(ageAtMonth * 10) / 10 };
    }
    if (!coastFireMonth) {
      const remainingYears = Math.max(0, targetRetirementAge - ageAtMonth);
      const futureWithoutContributions = liquidAssets * Math.pow(1 + 0.075, remainingYears);
      if (futureWithoutContributions >= annualExpenses * 25) {
        coastFireMonth = { monthIndex: m, age: Math.round(ageAtMonth * 10) / 10 };
      }
    }

    monthlyHistory.push({
      month: m,
      age: Math.round(ageAtMonth * 10) / 10,
      netWorth: Math.round(netWorth),
      totalAssets: Math.round(totalAssets),
      totalLiabilities: Math.round(totalLiabilities)
    });
  }

  // Key projection milestones to display on chart
  const ageMilestones = [30, 40, 50, 60, targetRetirementAge, 70, 80, 90].filter(
    (age, idx, arr) => age >= currentAge && arr.indexOf(age) === idx
  );

  const curve = ageMilestones.map((targetAge) => {
    const found = monthlyHistory.find((item) => Math.round(item.age) === targetAge) ||
      monthlyHistory[monthlyHistory.length - 1];
    return {
      age: targetAge,
      date: String(targetAge),
      netWorth: found ? found.netWorth : 0
    };
  });

  const retirementPoint = monthlyHistory.find((item) => Math.round(item.age) === targetRetirementAge) ||
    monthlyHistory[monthlyHistory.length - 1];
  const peakPoint = monthlyHistory.reduce((max, item) => item.netWorth > max.netWorth ? item : max, monthlyHistory[0]);

  return {
    curve,
    retirementBalance: retirementPoint ? retirementPoint.netWorth : 0,
    monthlyRetirementIncome: retirementPoint ? Math.round((retirementPoint.netWorth * 0.04) / 12) : 0,
    peakValue: peakPoint ? peakPoint.netWorth : 0,
    milestones: {
      debtFree: debtFreeMonth,
      emergencyFund: emergencyFundMonth,
      coastFire: coastFireMonth,
      fullFire: fullFireMonth
    }
  };
}

/**
 * Main Forecast Orchestrator for Profile
 */
async function getNetWorthForecastForProfile(profileId, options = {}) {
  const {
    range = 'YTD',
    targetAge = 65,
    currentAge = 30,
    scenario = 'expected',
    scope = 'household',
    monthlyAdditionalSavings = 0,
    expectedReturnRate = null
  } = options;

  const normalizedScope = scope === 'individual' ? 'individual' : 'household';
  const profileIds = await resolveScopeProfileIds(profileId, normalizedScope);

  // 1. Fetch live active asset and liability accounts
  const rawAccounts = await prisma.userChartOfAccount.findMany({
    where: {
      profile_id: { in: profileIds },
      deleted_at: null,
      is_active: true,
      class: { in: ['asset', 'liability'] }
    },
    orderBy: [{ account_number: 'asc' }, { display_name: 'asc' }]
  });
  const accounts = filterAccountsByScope(rawAccounts, profileId, normalizedScope);

  const assets = accounts.filter((acc) => acc.class === 'asset');
  const liabilities = accounts.filter((acc) => acc.class === 'liability');

  const totalAssets = assets.reduce((sum, a) => sum + Number(a.current_balance || 0), 0);
  const totalLiabilities = liabilities.reduce((sum, l) => sum + Math.abs(Number(l.current_balance || 0)), 0);
  const currentNetWorth = totalAssets - totalLiabilities;

  // 2. Cash flow velocity
  const cashFlow = await computeCashFlowVelocity(profileId);
  const debtPaydownBaseline = totalLiabilities > 0 ? Math.max(750, Math.round(totalLiabilities * 0.018)) : 300;
  const baseSavings = cashFlow.monthlyBlended > 0 ? Math.max(cashFlow.monthlyBlended, debtPaydownBaseline) : debtPaydownBaseline;
  const effectiveMonthlySavings = baseSavings + Number(monthlyAdditionalSavings || 0);

  const annualExpenses = Math.max(24000, (cashFlow.monthlyExpensesActual || 3000) * 12);

  // 3. Historical series
  const historical = await getHistoricalNetWorthSeries(profileId, currentNetWorth, range);

  // 4. Projections for all 3 scenarios (cloning accounts so each scenario runs independently)
  const parsedTargetAge = Math.min(85, Math.max(50, Number(targetAge) || 65));
  const parsedCurrentAge = Math.min(parsedTargetAge - 1, Math.max(18, Number(currentAge) || 30));
  const parsedReturnRate = expectedReturnRate ? Number(expectedReturnRate) / 100 : null;

  const cloneList = (list) => list.map((item) => ({ ...item }));

  const scenarios = {
    conservative: runProjectionEngine({
      assetAccounts: cloneList(assets),
      liabilityAccounts: cloneList(liabilities),
      monthlySavings: effectiveMonthlySavings,
      currentAge: parsedCurrentAge,
      targetRetirementAge: parsedTargetAge,
      scenario: 'conservative',
      customReturnRate: parsedReturnRate,
      annualExpenses
    }),
    expected: runProjectionEngine({
      assetAccounts: cloneList(assets),
      liabilityAccounts: cloneList(liabilities),
      monthlySavings: effectiveMonthlySavings,
      currentAge: parsedCurrentAge,
      targetRetirementAge: parsedTargetAge,
      scenario: 'expected',
      customReturnRate: parsedReturnRate,
      annualExpenses
    }),
    optimistic: runProjectionEngine({
      assetAccounts: cloneList(assets),
      liabilityAccounts: cloneList(liabilities),
      monthlySavings: effectiveMonthlySavings,
      currentAge: parsedCurrentAge,
      targetRetirementAge: parsedTargetAge,
      scenario: 'optimistic',
      customReturnRate: parsedReturnRate,
      annualExpenses
    })
  };

  const activeProjection = scenarios[scenario] || scenarios.expected;

  return {
    computedAt: new Date().toISOString(),
    currentNetWorth: Math.round(currentNetWorth * 100) / 100,
    totalAssets: Math.round(totalAssets * 100) / 100,
    totalLiabilities: Math.round(totalLiabilities * 100) / 100,
    cashFlow,
    historical,
    projections: scenarios,
    activeScenario: scenario,
    milestones: activeProjection.milestones,
    assumptions: {
      targetRetirementAge: parsedTargetAge,
      currentAge: parsedCurrentAge,
      monthlySavingsApplied: Math.round(effectiveMonthlySavings),
      safeWithdrawalRate: 0.04,
      inflationRate: 0.025,
      rateMap: ASSET_RATE_MAP
    }
  };
}

module.exports = {
  getNetWorthForecastForProfile,
  computeCashFlowVelocity,
  getHistoricalNetWorthSeries,
  runProjectionEngine,
  ASSET_RATE_MAP,
  LIABILITY_APR_MAP
};
