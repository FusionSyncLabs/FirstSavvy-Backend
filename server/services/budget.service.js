const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');

function decimalToNumber(value) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function pickPublicBudget(budget) {
  return {
    id: budget.id,
    profile_id: budget.profile_id,
    chart_account_id: budget.chart_account_id,
    name: budget.name,
    amount: decimalToNumber(budget.amount),
    allocated_amount: decimalToNumber(budget.amount),
    cadence: budget.cadence,
    month: budget.month,
    year: budget.year,
    period_start: budget.period_start,
    period_end: budget.period_end,
    rollover_enabled: budget.rollover_enabled,
    rollover_amount: decimalToNumber(budget.rollover_amount),
    accumulated_rollover: decimalToNumber(budget.rollover_amount),
    parent_budget_id: budget.parent_budget_id,
    is_active: budget.is_active,
    metadata: budget.metadata && typeof budget.metadata === 'object' ? budget.metadata : {},
    chart_account: budget.chart_account ? {
      id: budget.chart_account.id,
      class: budget.chart_account.class,
      account_type: budget.chart_account.account_type,
      account_name: budget.chart_account.account_name,
      display_name: budget.chart_account.display_name,
      account_detail: budget.chart_account.account_detail,
      icon: budget.chart_account.icon,
      color: budget.chart_account.color,
      parent_account_id: budget.chart_account.parent_account_id,
      current_balance: decimalToNumber(budget.chart_account.current_balance)
    } : undefined,
    chartAccount: budget.chart_account ? {
      id: budget.chart_account.id,
      class: budget.chart_account.class,
      account_type: budget.chart_account.account_type,
      account_name: budget.chart_account.account_name,
      display_name: budget.chart_account.display_name,
      account_detail: budget.chart_account.account_detail,
      icon: budget.chart_account.icon,
      color: budget.chart_account.color,
      parent_account_id: budget.chart_account.parent_account_id,
      current_balance: decimalToNumber(budget.chart_account.current_balance)
    } : undefined,
    created_at: budget.created_at,
    updated_at: budget.updated_at
  };
}

async function listBudgetsForProfile(profileId, query = {}) {
  const where = {
    profile_id: profileId,
    chart_account: {
      deleted_at: null,
      is_active: true
    }
  };
  if (query.isActive !== undefined) {
    where.is_active = query.isActive === 'true';
  }

  const budgets = await prisma.budget.findMany({
    where,
    include: { chart_account: true },
    orderBy: [{ year: 'desc' }, { month: 'desc' }, { name: 'asc' }]
  });

  return { budgets: budgets.map(pickPublicBudget) };
}

async function getBudgetForProfile(profileId, budgetId) {
  const budget = await findBudget(profileId, budgetId);
  return pickPublicBudget(budget);
}

async function createBudgetForProfile(profileId, input = {}) {
  const chartAccount = await assertBudgetAccount(profileId, input.chart_account_id);
  const data = {
    chart_account_id: chartAccount.id,
    ...buildBudgetData(input),
    is_active: input.is_active !== false
  };

  const existingBudget = await prisma.budget.findFirst({
    where: {
      profile_id: profileId,
      chart_account_id: chartAccount.id
    },
    orderBy: [
      { is_active: 'desc' },
      { updated_at: 'desc' }
    ]
  });

  if (existingBudget) {
    const budget = await prisma.budget.update({
      where: { id: existingBudget.id },
      data,
      include: { chart_account: true }
    });

    return pickPublicBudget(budget);
  }

  const budget = await prisma.budget.create({
    data: {
      profile_id: profileId,
      ...data
    },
    include: { chart_account: true }
  });

  return pickPublicBudget(budget);
}

async function updateBudgetForProfile(profileId, budgetId, input = {}) {
  await findBudget(profileId, budgetId);

  if (input.chart_account_id !== undefined) {
    await assertBudgetAccount(profileId, input.chart_account_id);
  }

  const data = buildBudgetData(input, { partial: true });

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest('No budget updates were provided', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const budget = await prisma.budget.update({
    where: { id: budgetId },
    data,
    include: { chart_account: true }
  });

  return pickPublicBudget(budget);
}

async function deleteBudgetForProfile(profileId, budgetId) {
  await findBudget(profileId, budgetId);

  await prisma.budget.update({
    where: { id: budgetId },
    data: { is_active: false }
  });

  return { deactivated: true };
}

async function findBudget(profileId, budgetId) {
  const budget = await prisma.budget.findFirst({
    where: {
      id: budgetId,
      profile_id: profileId
    },
    include: { chart_account: true }
  });

  if (!budget) {
    throw ApiError.notFound('Budget not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return budget;
}

async function assertBudgetAccount(profileId, chartAccountId) {
  if (!chartAccountId) {
    throw ApiError.badRequest('Budget category is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'chart_account_id', message: 'Required field is missing' }]
    });
  }

  const account = await prisma.userChartOfAccount.findFirst({
    where: {
      id: chartAccountId,
      profile_id: profileId,
      deleted_at: null,
      is_active: true,
      class: { in: ['income', 'expense'] }
    }
  });

  if (!account) {
    throw ApiError.badRequest('Budget category must be an active income or expense account', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'chart_account_id', message: 'Must reference an income or expense account' }]
    });
  }

  return account;
}

function buildBudgetData(input = {}, options = {}) {
  const data = {};

  if (input.chart_account_id !== undefined) data.chart_account_id = normalizeNullableString(input.chart_account_id);
  if (input.name !== undefined || input.custom_name !== undefined) {
    data.name = normalizeNullableString(input.name ?? input.custom_name);
  }
  if (input.allocated_amount !== undefined || input.amount !== undefined) {
    data.amount = parseMoney(input.allocated_amount ?? input.amount, 'allocated_amount');
  } else if (!options.partial) {
    data.amount = 0;
  }
  if (input.cadence !== undefined) data.cadence = normalizeNullableString(input.cadence) || 'monthly';
  if (input.month !== undefined) data.month = parseNullableInteger(input.month, 'month');
  if (input.year !== undefined) data.year = parseNullableInteger(input.year, 'year');
  if (input.period_start !== undefined) data.period_start = parseNullableDate(input.period_start, 'period_start');
  if (input.period_end !== undefined) data.period_end = parseNullableDate(input.period_end, 'period_end');
  if (input.rollover_enabled !== undefined) data.rollover_enabled = Boolean(input.rollover_enabled);
  if (input.rollover_amount !== undefined || input.accumulated_rollover !== undefined) {
    data.rollover_amount = parseMoney(input.rollover_amount ?? input.accumulated_rollover, 'rollover_amount');
  }
  if (input.parent_budget_id !== undefined) data.parent_budget_id = normalizeNullableString(input.parent_budget_id);
  if (input.is_active !== undefined) data.is_active = Boolean(input.is_active);
  if (input.metadata !== undefined) data.metadata = normalizeMetadata(input.metadata);

  return data;
}

function normalizeNullableString(value) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseMoney(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw ApiError.badRequest(`${field} must be a valid amount`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field, message: 'Must be a valid amount' }]
    });
  }
  return number;
}

function parseNullableInteger(value, field) {
  if (value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number)) {
    throw ApiError.badRequest(`${field} must be an integer`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field, message: 'Must be an integer' }]
    });
  }
  return number;
}

function parseNullableDate(value, field) {
  if (value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest(`${field} must be a valid date`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field, message: 'Must be a valid date' }]
    });
  }
  return date;
}

function decimalToNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

async function listSuggestedBudgetsForProfile(profileId, query = {}) {
  // 1. Get active user chart of accounts (income & expense)
  const categories = await prisma.userChartOfAccount.findMany({
    where: {
      profile_id: profileId,
      deleted_at: null,
      is_active: true,
      class: { in: ['income', 'expense'] }
    },
    orderBy: { display_name: 'asc' }
  });

  if (categories.length === 0) {
    return { suggestions: [] };
  }

  // 2. Get active budgets for this profile
  const activeBudgets = await prisma.budget.findMany({
    where: {
      profile_id: profileId,
      is_active: true
    }
  });

  const activeChartAccountIds = new Set(activeBudgets.map((b) => b.chart_account_id).filter(Boolean));

  // 3. Find categories without active budgets
  const unbudgetedCategories = categories.filter((c) => !activeChartAccountIds.has(c.id));
  if (unbudgetedCategories.length === 0) {
    return { suggestions: [] };
  }

  const unbudgetedIds = unbudgetedCategories.map((c) => c.id);

  // 4. Fetch all posted transactions for these categories
  const transactions = await prisma.transaction.findMany({
    where: {
      profile_id: profileId,
      category_account_id: { in: unbudgetedIds },
      status: 'posted',
      deleted_at: null
    },
    orderBy: { date: 'desc' }
  });

  const txByCat = new Map();
  transactions.forEach((t) => {
    if (!txByCat.has(t.category_account_id)) {
      txByCat.set(t.category_account_id, []);
    }
    txByCat.get(t.category_account_id).push(t);
  });

  const suggestions = [];
  const now = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  for (const cat of unbudgetedCategories) {
    const catTxns = txByCat.get(cat.id) || [];
    if (catTxns.length === 0) continue;

    const isIncome = cat.class === 'income';
    const totalAmount = catTxns.reduce((sum, t) => sum + Math.abs(decimalToNumber(t.amount)), 0);

    const monthSet = new Set();
    let currentMonthAmount = 0;

    catTxns.forEach((t) => {
      const d = t.date || t.posted_date;
      if (d) {
        const key = String(d).substring(0, 7);
        monthSet.add(key);
        if (key === currentMonthKey) {
          currentMonthAmount += Math.abs(decimalToNumber(t.amount));
        }
      }
    });

    const monthsCount = Math.max(1, monthSet.size);
    const monthlyAverage = Math.round((totalAmount / monthsCount) * 100) / 100;
    const recentTx = catTxns[0];
    const recentTxAmount = recentTx ? Math.abs(decimalToNumber(recentTx.amount)) : 0;

    let suggestedAmount = 0;
    if (isIncome) {
      if (currentMonthAmount > 0) suggestedAmount = Math.round(currentMonthAmount);
      else if (monthlyAverage > 0) suggestedAmount = monthlyAverage;
      else if (recentTxAmount > 0) suggestedAmount = Math.round(recentTxAmount);
      else suggestedAmount = 100;
    } else {
      if (currentMonthAmount > 0) suggestedAmount = Math.round(currentMonthAmount);
      else if (monthlyAverage > 0) suggestedAmount = monthlyAverage;
      else if (recentTxAmount > 0) suggestedAmount = Math.round(recentTxAmount);
      else suggestedAmount = 50;
    }

    suggestions.push({
      chart_account_id: cat.id,
      category_name: cat.display_name || cat.account_name,
      display_name: cat.display_name || cat.account_name,
      class: cat.class,
      account_type: cat.account_type || cat.account_detail || (isIncome ? 'income' : 'general_expenses'),
      icon: cat.icon,
      color: cat.color,
      suggested_amount: suggestedAmount,
      monthly_average: monthlyAverage,
      current_month_spent: isIncome ? 0 : currentMonthAmount,
      current_month_income: isIncome ? currentMonthAmount : 0,
      total_spent: isIncome ? 0 : totalAmount,
      total_income: isIncome ? totalAmount : 0,
      transaction_count: catTxns.length,
      recent_transaction_amount: recentTxAmount,
      recent_transaction_date: recentTx ? (recentTx.date || recentTx.posted_date) : null
    });
  }

  suggestions.sort((a, b) => {
    const aCurrent = a.class === 'income' ? a.current_month_income : a.current_month_spent;
    const bCurrent = b.class === 'income' ? b.current_month_income : b.current_month_spent;
    if (aCurrent !== bCurrent) return bCurrent - aCurrent;
    return b.transaction_count - a.transaction_count;
  });

  return { suggestions };
}

module.exports = {
  listBudgetsForProfile,
  getBudgetForProfile,
  createBudgetForProfile,
  updateBudgetForProfile,
  deleteBudgetForProfile,
  listSuggestedBudgetsForProfile,
  pickPublicBudget
};
