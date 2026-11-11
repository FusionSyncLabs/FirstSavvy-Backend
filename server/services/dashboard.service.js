const { prisma } = require('../config/database');

async function getDashboardDataForProfile(profileId) {
  const [accounts, postedTransactions, pendingTransactions, budgets] = await Promise.all([
    prisma.userChartOfAccount.findMany({
      where: {
        profile_id: profileId,
        deleted_at: null,
        is_active: true
      },
      orderBy: [{ account_number: 'asc' }, { display_name: 'asc' }]
    }),
    prisma.transaction.findMany({
      where: {
        profile_id: profileId,
        status: 'posted',
        deleted_at: null
      },
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
      take: 10000
    }),
    prisma.transaction.findMany({
      where: {
        profile_id: profileId,
        status: 'pending',
        deleted_at: null
      },
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
      take: 10000
    }),
    prisma.budget.findMany({
      where: {
        profile_id: profileId
      },
      include: {
        chart_account: true
      },
      orderBy: [{ created_at: 'asc' }]
    })
  ]);

  const publicAccounts = accounts.map(pickDashboardAccount);
  const assetAccounts = publicAccounts.filter((account) => account.class === 'asset');
  const liabilityAccounts = publicAccounts.filter((account) => account.class === 'liability');
  const chartAccounts = publicAccounts
    .filter((account) => ['income', 'expense'].includes(account.class))
    .map((account) => ({ ...account, level: 3 }));
  const transactionalAccountIds = new Set([
    ...assetAccounts.map((account) => account.id),
    ...liabilityAccounts
      .filter((account) => account.account_type === 'credit_card')
      .map((account) => account.id)
  ]);

  const publicPostedTransactions = postedTransactions.map(pickDashboardTransaction);
  const publicPendingTransactions = pendingTransactions.map(pickDashboardTransaction);
  const publicBudgets = budgets.map(pickDashboardBudget);
  const spendingByCategory = calculateCurrentMonthSpending(publicPostedTransactions, transactionalAccountIds);
  const topUtilizedBudgets = buildTopUtilizedBudgets(publicBudgets, chartAccounts, spendingByCategory);

  return {
    accounts: publicAccounts,
    assets: assetAccounts,
    liabilities: liabilityAccounts,
    chartAccounts,
    transactions: {
      posted: publicPostedTransactions,
      pending: publicPendingTransactions
    },
    budgets: publicBudgets,
    spendingByCategory,
    recentTransactions: publicPendingTransactions
      .filter((transaction) => !transaction.bank_account_id || transactionalAccountIds.has(transaction.bank_account_id))
      .sort((a, b) => new Date(b.date || b.created_at || 0) - new Date(a.date || a.created_at || 0))
      .slice(0, 10),
    topUtilizedBudgets,
    summary: {
      netWorth: calculateNetWorth(assetAccounts, liabilityAccounts),
      totalAssets: assetAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0),
      totalLiabilities: liabilityAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0),
      pendingTransactionCount: publicPendingTransactions.length,
      postedTransactionCount: publicPostedTransactions.length
    }
  };
}

function calculateCurrentMonthSpending(transactions, transactionalAccountIds) {
  const today = new Date();
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

  return transactions.reduce((acc, transaction) => {
    const transactionDate = new Date(transaction.date);
    if (Number.isNaN(transactionDate.getTime())) return acc;
    if (transactionDate < monthStart || transactionDate > monthEnd) return acc;
    if (!transactionalAccountIds.has(transaction.bank_account_id)) return acc;
    if (transaction.type === 'transfer' || transaction.transaction_type === 'transfer') return acc;
    const isExpense = transaction.type === 'expense' || (transaction.type !== 'income' && Number(transaction.amount) < 0);
    if (!isExpense) return acc;

    const key = transaction.category_account_id || '__uncategorized__';
    acc[key] = (acc[key] || 0) + Math.abs(Number(transaction.amount || 0));
    return acc;
  }, {});
}

function buildTopUtilizedBudgets(budgets, chartAccounts, spendingByCategory) {
  return budgets
    .filter((budget) => budget.is_active && budget.chartAccount?.class === 'expense')
    .map((budget) => {
      const spent = getSpendingWithChildren(budget.chart_account_id, chartAccounts, spendingByCategory);
      const limit = Number(budget.allocated_amount || 0);
      return {
        budgetId: budget.id,
        categoryAccountId: budget.chart_account_id,
        categoryName: budget.chartAccount?.display_name || budget.name || 'Unknown',
        icon: budget.chartAccount?.icon || 'Circle',
        spent,
        limit,
        percentage: limit > 0 ? (spent / limit) * 100 : 0
      };
    })
    .filter((item) => item.limit > 0)
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 7);
}

function getSpendingWithChildren(categoryId, chartAccounts, spendingByCategory) {
  if (!categoryId) return 0;

  const directSpending = spendingByCategory[categoryId] || 0;
  const childSpending = chartAccounts
    .filter((account) => account.parent_account_id === categoryId)
    .reduce((sum, account) => sum + (spendingByCategory[account.id] || 0), 0);

  return directSpending + childSpending;
}

function calculateNetWorth(assetAccounts, liabilityAccounts) {
  const totalAssets = assetAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
  const totalLiabilities = liabilityAccounts.reduce((sum, account) => sum + Number(account.current_balance || 0), 0);
  return totalAssets - totalLiabilities;
}

function pickDashboardAccount(account) {
  return {
    id: account.id,
    profile_id: account.profile_id,
    template_account_number: account.template_account_number,
    account_number: account.account_number,
    account_name: account.account_name,
    display_name: account.display_name,
    class: account.class,
    account_type: account.account_type,
    account_detail: account.account_detail,
    parent_account_id: account.parent_account_id,
    institution_name: account.institution_name,
    account_mask: account.account_mask,
    current_balance: decimalToNumber(account.current_balance),
    available_balance: decimalToNumber(account.available_balance),
    opening_balance: decimalToNumber(account.opening_balance),
    include_in_cash_balance: account.include_in_cash_balance,
    is_active: account.is_active,
    is_system: account.is_system,
    is_user_created: account.is_user_created,
    icon: account.icon,
    color: account.color,
    metadata: normalizeMetadata(account.metadata),
    created_at: account.created_at,
    updated_at: account.updated_at
  };
}

function pickDashboardTransaction(transaction) {
  return {
    id: transaction.id,
    profile_id: transaction.profile_id,
    bank_account_id: transaction.bank_account_id,
    category_account_id: transaction.category_account_id,
    contact_id: transaction.contact_id,
    journal_entry_id: transaction.journal_entry_id,
    date: transaction.date,
    posted_date: transaction.posted_date,
    description: transaction.description,
    original_description: transaction.original_description,
    amount: decimalToNumber(transaction.amount),
    transaction_type: transaction.transaction_type,
    type: transaction.transaction_type,
    status: transaction.status,
    memo: transaction.memo,
    check_number: transaction.check_number,
    source: transaction.source,
    external_id: transaction.external_id,
    imported_at: transaction.imported_at,
    metadata: normalizeMetadata(transaction.metadata),
    created_at: transaction.created_at,
    updated_at: transaction.updated_at
  };
}

function pickDashboardBudget(budget) {
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
    parent_budget_id: budget.parent_budget_id,
    is_active: budget.is_active,
    metadata: normalizeMetadata(budget.metadata),
    chartAccount: budget.chart_account ? pickDashboardAccount(budget.chart_account) : null,
    created_at: budget.created_at,
    updated_at: budget.updated_at
  };
}

function decimalToNumber(value) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

module.exports = {
  getDashboardDataForProfile
};
