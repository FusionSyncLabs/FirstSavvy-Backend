const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');

function decimalToNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function convertCadence(amount, fromCadence = 'monthly', toCadence = 'monthly') {
  if (fromCadence === toCadence) return amount;

  const yearly = (() => {
    switch (fromCadence) {
      case 'daily':
        return amount * 365;
      case 'weekly':
        return amount * 52;
      case 'yearly':
        return amount;
      case 'monthly':
      default:
        return amount * 12;
    }
  })();

  switch (toCadence) {
    case 'daily':
      return yearly / 365;
    case 'weekly':
      return yearly / 52;
    case 'yearly':
      return yearly;
    case 'monthly':
    default:
      return yearly / 12;
  }
}

async function getHistoricalSpendingForProfile(profileId, categoryAccountId, options = {}) {
  const monthsBack = parseMonthsBack(options.monthsBack);
  const accountIds = await resolveAccountIds(profileId, categoryAccountId, options.childAccountIds);
  const monthlyData = [];

  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const targetDate = addMonths(new Date(), -i);
    const monthStart = startOfMonth(targetDate);
    const monthEnd = endOfMonth(targetDate);
    const transactions = await listTransactions(profileId, accountIds, monthStart, monthEnd, 'expense');
    const totalSpent = transactions.reduce((sum, transaction) => sum + Math.abs(decimalToNumber(transaction.amount)), 0);
    const transactionCount = transactions.length;

    monthlyData.push({
      month: formatMonthYear(targetDate),
      monthKey: formatMonthKey(targetDate),
      totalSpent,
      transactionCount,
      avgTransaction: transactionCount > 0 ? totalSpent / transactionCount : 0
    });
  }

  const nonZeroSpending = monthlyData.map((month) => month.totalSpent).filter((amount) => amount > 0);

  return {
    monthlyData,
    summary: {
      average: nonZeroSpending.length > 0 ? nonZeroSpending.reduce((a, b) => a + b, 0) / nonZeroSpending.length : 0,
      max: nonZeroSpending.length > 0 ? Math.max(...nonZeroSpending) : 0,
      min: nonZeroSpending.length > 0 ? Math.min(...nonZeroSpending) : 0,
      trend: calculateTrend(monthlyData)
    }
  };
}

async function getVendorBreakdownForProfile(profileId, categoryAccountId, options = {}) {
  const monthsBack = parseMonthsBack(options.monthsBack);
  const accountIds = await resolveAccountIds(profileId, categoryAccountId, options.childAccountIds);
  const monthlyData = [];

  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const targetDate = addMonths(new Date(), -i);
    const monthStart = startOfMonth(targetDate);
    const monthEnd = endOfMonth(targetDate);
    const transactions = await listTransactions(profileId, accountIds, monthStart, monthEnd, 'expense', {
      includeContact: true,
      orderBy: { date: 'desc' }
    });

    const vendorMap = new Map();
    transactions.forEach((transaction) => {
      const vendorId = transaction.contact_id || 'uncategorized';
      const vendorName = transaction.contact?.name || 'Other';
      const current = vendorMap.get(vendorId) || {
        id: vendorId,
        name: vendorName,
        totalSpent: 0,
        transactionCount: 0
      };

      current.totalSpent += Math.abs(decimalToNumber(transaction.amount));
      current.transactionCount += 1;
      vendorMap.set(vendorId, current);
    });

    monthlyData.push({
      month: formatMonthYear(targetDate),
      monthKey: formatMonthKey(targetDate),
      vendors: Array.from(vendorMap.values()),
      totalSpent: transactions.reduce((sum, transaction) => sum + Math.abs(decimalToNumber(transaction.amount)), 0)
    });
  }

  const vendors = new Set();
  monthlyData.forEach((month) => {
    month.vendors.forEach((vendor) => vendors.add(vendor.name));
  });

  return {
    monthlyData,
    vendors: Array.from(vendors)
  };
}

async function getTransactionPatternsForProfile(profileId, categoryAccountId) {
  await assertCategoryAccount(profileId, categoryAccountId);

  const transactions = await prisma.transaction.findMany({
    where: {
      profile_id: profileId,
      category_account_id: categoryAccountId,
      status: 'posted',
      transaction_type: 'expense',
      deleted_at: null
    },
    select: {
      id: true,
      amount: true,
      date: true,
      description: true,
      transaction_type: true
    },
    orderBy: { date: 'desc' },
    take: 1000
  });

  const dayOfWeekMap = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayOfWeekCounts = {};
  const dayOfMonthCounts = {};

  transactions.forEach((transaction) => {
    const date = new Date(transaction.date);
    const dayOfWeek = date.getUTCDay();
    const dayOfMonth = date.getUTCDate();
    dayOfWeekCounts[dayOfWeek] = (dayOfWeekCounts[dayOfWeek] || 0) + 1;
    dayOfMonthCounts[dayOfMonth] = (dayOfMonthCounts[dayOfMonth] || 0) + 1;
  });

  return {
    dayOfWeekPattern: Object.entries(dayOfWeekCounts)
      .map(([day, count]) => ({ day: dayOfWeekMap[Number(day)], count }))
      .sort((a, b) => b.count - a.count),
    topDaysOfMonth: Object.entries(dayOfMonthCounts)
      .map(([day, count]) => ({ day: Number(day), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    averageFrequency: calculateFrequency(transactions)
  };
}

async function getBudgetPerformanceHistoryForProfile(profileId, categoryAccountId, options = {}) {
  const monthsBack = parseMonthsBack(options.monthsBack);
  const transactionType = normalizeTransactionType(options.transactionType);
  const accountIds = await resolveAccountIds(profileId, categoryAccountId, options.childAccountIds);
  const performanceData = [];

  const budget = await prisma.budget.findFirst({
    where: {
      profile_id: profileId,
      chart_account_id: categoryAccountId
    },
    select: {
      amount: true,
      cadence: true
    },
    orderBy: [
      { is_active: 'desc' },
      { updated_at: 'desc' }
    ]
  });

  const monthlyBudget = convertCadence(decimalToNumber(budget?.amount), budget?.cadence || 'monthly', 'monthly');

  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const targetDate = addMonths(new Date(), -i);
    const monthStart = startOfMonth(targetDate);
    const monthEnd = endOfMonth(targetDate);
    const transactions = await listTransactions(profileId, accountIds, monthStart, monthEnd, transactionType);
    const actual = transactions.reduce((sum, transaction) => sum + Math.abs(decimalToNumber(transaction.amount)), 0);
    const variance = monthlyBudget - actual;

    performanceData.push({
      month: formatMonthYear(targetDate),
      budgeted: monthlyBudget,
      actual,
      variance,
      percentUsed: monthlyBudget > 0 ? (actual / monthlyBudget) * 100 : 0,
      underBudget: variance >= 0
    });
  }

  const underBudgetMonths = performanceData.filter((period) => period.underBudget).length;

  return {
    performanceData,
    adherenceRate: performanceData.length > 0 ? (underBudgetMonths / performanceData.length) * 100 : 0
  };
}

async function getMonthlyActualsForProfile(profileId, categoryAccountId, options = {}) {
  const transactionType = normalizeTransactionType(options.transactionType);
  const accountIds = await resolveAccountIds(profileId, categoryAccountId, options.childAccountIds);
  const targetDate = parseTargetMonth(options.month);
  const transactions = await listTransactions(
    profileId,
    accountIds,
    startOfMonth(targetDate),
    endOfMonth(targetDate),
    transactionType
  );
  const byCategory = {};

  transactions.forEach((transaction) => {
    const categoryId = transaction.category_account_id;
    if (!categoryId) return;
    byCategory[categoryId] = (byCategory[categoryId] || 0) + Math.abs(decimalToNumber(transaction.amount));
  });

  return {
    total: Object.values(byCategory).reduce((sum, amount) => sum + amount, 0),
    byCategory
  };
}

async function getSpendingForecastForProfile(profileId, categoryAccountId) {
  await assertCategoryAccount(profileId, categoryAccountId);

  const now = new Date();
  const monthStart = startOfMonth(now);
  const monthEnd = endOfMonth(now);
  const daysInMonth = differenceInDays(monthEnd, monthStart) + 1;
  const daysElapsed = differenceInDays(now, monthStart) + 1;
  const transactions = await listTransactions(profileId, [categoryAccountId], monthStart, now, 'expense');
  const spentSoFar = transactions.reduce((sum, transaction) => sum + Math.abs(decimalToNumber(transaction.amount)), 0);
  const dailyAverage = daysElapsed > 0 ? spentSoFar / daysElapsed : 0;
  const daysRemaining = daysInMonth - daysElapsed;
  const historicalData = await getHistoricalSpendingForProfile(profileId, categoryAccountId, { monthsBack: 3 });

  return {
    spentSoFar,
    dailyAverage,
    daysElapsed,
    daysRemaining,
    projectedTotal: spentSoFar + (dailyAverage * daysRemaining),
    historicalAverage: historicalData.summary.average,
    confidence: daysElapsed / daysInMonth
  };
}

async function getComparativeAnalysisForProfile(profileId, categoryAccountId, options = {}) {
  const transactionType = normalizeTransactionType(options.transactionType);
  const accountIds = await resolveAccountIds(profileId, categoryAccountId, options.childAccountIds);
  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const currentMonthEnd = endOfMonth(now);
  const lastYearDate = addMonths(now, -12);
  const lastYearMonthStart = startOfMonth(lastYearDate);
  const lastYearMonthEnd = endOfMonth(lastYearDate);

  const [currentMonthTxns, lastYearTxns, allPeriodTxns] = await Promise.all([
    listTransactions(profileId, accountIds, currentMonthStart, currentMonthEnd, transactionType),
    listTransactions(profileId, accountIds, lastYearMonthStart, lastYearMonthEnd, transactionType),
    listTransactions(profileId, null, currentMonthStart, currentMonthEnd, transactionType)
  ]);

  const currentMonth = sumAbsoluteAmounts(currentMonthTxns);
  const lastYearSameMonth = sumAbsoluteAmounts(lastYearTxns);
  const totalPeriodAmount = sumAbsoluteAmounts(allPeriodTxns);

  return {
    currentMonth,
    lastYearSameMonth,
    yearOverYearChange: lastYearSameMonth > 0 ? ((currentMonth - lastYearSameMonth) / lastYearSameMonth) * 100 : 0,
    percentOfTotalExpenses: totalPeriodAmount > 0 ? (currentMonth / totalPeriodAmount) * 100 : 0
  };
}

async function listTransactions(profileId, accountIds, startDate, endDate, transactionType, options = {}) {
  return prisma.transaction.findMany({
    where: {
      profile_id: profileId,
      ...(accountIds?.length ? { category_account_id: { in: accountIds } } : {}),
      status: 'posted',
      transaction_type: transactionType,
      deleted_at: null,
      date: {
        gte: startDate,
        lte: endDate
      }
    },
    select: {
      id: true,
      amount: true,
      date: true,
      description: true,
      category_account_id: true,
      contact_id: true,
      transaction_type: true,
      ...(options.includeContact ? { contact: { select: { id: true, name: true, contact_type: true } } } : {})
    },
    ...(options.orderBy ? { orderBy: options.orderBy } : {})
  });
}

async function resolveAccountIds(profileId, categoryAccountId, childAccountIds = []) {
  await assertCategoryAccount(profileId, categoryAccountId);

  const ids = [categoryAccountId, ...normalizeIdList(childAccountIds)];
  if (ids.length === 1) return ids;

  const validAccounts = await prisma.userChartOfAccount.findMany({
    where: {
      id: { in: ids },
      profile_id: profileId,
      deleted_at: null
    },
    select: { id: true }
  });

  return validAccounts.map((account) => account.id);
}

async function assertCategoryAccount(profileId, categoryAccountId) {
  if (!categoryAccountId) {
    throw ApiError.badRequest('Category account is required', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const account = await prisma.userChartOfAccount.findFirst({
    where: {
      id: categoryAccountId,
      profile_id: profileId,
      deleted_at: null
    },
    select: { id: true }
  });

  if (!account) {
    throw ApiError.notFound('Category account not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return account;
}

function sumAbsoluteAmounts(transactions) {
  return transactions.reduce((sum, transaction) => sum + Math.abs(decimalToNumber(transaction.amount)), 0);
}

function normalizeIdList(value) {
  if (!value) return [];
  const rawValues = Array.isArray(value) ? value : String(value).split(',');
  return rawValues.map((item) => String(item).trim()).filter(Boolean);
}

function parseMonthsBack(value) {
  const monthsBack = Number(value || 12);
  if (!Number.isInteger(monthsBack) || monthsBack < 1 || monthsBack > 60) {
    throw ApiError.badRequest('monthsBack must be an integer between 1 and 60', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
  return monthsBack;
}

function parseTargetMonth(value) {
  if (!value) return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest('month must be a valid date', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
  return date;
}

function normalizeTransactionType(value) {
  if (!value) return 'expense';
  if (value === 'income' || value === 'expense') return value;
  throw ApiError.badRequest('transactionType must be income or expense', {
    code: ERROR_CODES.VALIDATION_FAILED
  });
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function addMonths(date, amount) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + amount, 1));
}

function differenceInDays(later, earlier) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const laterDay = Date.UTC(later.getUTCFullYear(), later.getUTCMonth(), later.getUTCDate());
  const earlierDay = Date.UTC(earlier.getUTCFullYear(), earlier.getUTCMonth(), earlier.getUTCDate());
  return Math.floor((laterDay - earlierDay) / msPerDay);
}

function formatMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function formatMonthYear(date) {
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function calculateTrend(monthlyData) {
  if (monthlyData.length < 2) return 'stable';

  const recentMonths = monthlyData.slice(-3);
  const olderMonths = monthlyData.slice(0, Math.min(3, monthlyData.length - 3));
  const recentAvg = recentMonths.reduce((sum, month) => sum + month.totalSpent, 0) / recentMonths.length;
  const olderAvg = olderMonths.length > 0
    ? olderMonths.reduce((sum, month) => sum + month.totalSpent, 0) / olderMonths.length
    : recentAvg;

  if (recentAvg > olderAvg * 1.1) return 'increasing';
  if (recentAvg < olderAvg * 0.9) return 'decreasing';
  return 'stable';
}

function calculateFrequency(transactions) {
  if (transactions.length < 2) return 'occasional';

  const dates = transactions
    .map((transaction) => new Date(transaction.date))
    .sort((a, b) => a.getTime() - b.getTime());
  const intervals = [];

  for (let i = 1; i < dates.length; i += 1) {
    intervals.push(differenceInDays(dates[i], dates[i - 1]));
  }

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

  if (avgInterval <= 7) return 'weekly';
  if (avgInterval <= 14) return 'biweekly';
  if (avgInterval <= 31) return 'monthly';
  return 'occasional';
}

module.exports = {
  getHistoricalSpendingForProfile,
  getVendorBreakdownForProfile,
  getTransactionPatternsForProfile,
  getBudgetPerformanceHistoryForProfile,
  getMonthlyActualsForProfile,
  getSpendingForecastForProfile,
  getComparativeAnalysisForProfile
};
