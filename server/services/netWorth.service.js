const { prisma } = require('../config/database');
const { pickPublicAccount } = require('./account.service');

async function resolveScopeProfileIds(profileId, scope = 'household') {
  if (scope === 'individual') {
    return [profileId];
  }
  try {
    const currentProfile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: { owner_user_id: true }
    });
    if (!currentProfile?.owner_user_id) return [profileId];

    const householdProfiles = await prisma.profile.findMany({
      where: {
        owner_user_id: currentProfile.owner_user_id,
        deleted_at: null,
        is_active: true,
        profile_type: { in: ['personal', 'household'] }
      },
      select: { id: true }
    });
    const ids = new Set([profileId, ...householdProfiles.map((p) => p.id)]);
    return Array.from(ids);
  } catch {
    return [profileId];
  }
}

function filterAccountsByScope(accounts, profileId, scope = 'household') {
  if (scope !== 'individual') return accounts;
  return accounts.filter((acc) => {
    if (acc.profile_id && acc.profile_id !== profileId) return false;
    const metaOwnership = String(acc.metadata?.ownership || acc.ownership || '').toLowerCase();
    return metaOwnership !== 'household' && metaOwnership !== 'joint' && metaOwnership !== 'spouse';
  });
}

async function getNetWorthSummaryForProfile(profileId, options = {}) {
  const scope = options.scope === 'individual' ? 'individual' : 'household';
  const profileIds = await resolveScopeProfileIds(profileId, scope);

  const rawAccounts = await prisma.userChartOfAccount.findMany({
    where: {
      profile_id: { in: profileIds },
      deleted_at: null,
      is_active: true,
      class: {
        in: ['asset', 'liability']
      }
    },
    orderBy: [{ account_number: 'asc' }, { display_name: 'asc' }]
  });

  const accounts = filterAccountsByScope(rawAccounts, profileId, scope);
  const publicAccounts = accounts.map(pickPublicAccount);
  const assets = publicAccounts.filter((account) => account.class === 'asset');
  const liabilities = publicAccounts.filter((account) => account.class === 'liability');
  const totalAssets = sumBalances(assets, false);
  const totalLiabilities = sumBalances(liabilities, true);

  // Compute dynamic month-over-month change from posted transactions
  const now = new Date();
  const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  let changeAmount = 0;
  let percentChange = 0;
  let hasData = false;

  try {
    const recentTransactions = await prisma.transaction.findMany({
      where: {
        profile_id: { in: profileIds },
        deleted_at: null,
        status: 'posted',
        date: { gte: startOfPrevMonth }
      },
      select: {
        amount: true,
        transaction_type: true,
        date: true
      }
    });

    if (recentTransactions.length > 0) {
      hasData = true;
      let currentMonthNet = 0;

      recentTransactions.forEach((tx) => {
        const amt = Math.abs(Number(tx.amount || 0));
        const isIncome = tx.transaction_type === 'income';
        const net = isIncome ? amt : -amt;
        const txDate = new Date(tx.date);
        if (txDate >= startOfCurrentMonth) {
          currentMonthNet += net;
        }
      });

      changeAmount = Math.round(currentMonthNet * 100) / 100;
      const currentNetWorth = totalAssets - totalLiabilities;
      const prevEstimatedNetWorth = currentNetWorth - currentMonthNet;
      const base = Math.abs(prevEstimatedNetWorth) > 0 ? Math.abs(prevEstimatedNetWorth) : Math.abs(currentNetWorth) || 1;
      percentChange = Math.round((currentMonthNet / base) * 1000) / 10;
    }
  } catch (err) {
    console.warn('Could not compute dynamic monthly net worth change:', err.message);
  }

  return {
    asOf: new Date().toISOString(),
    assets,
    liabilities,
    groups: {
      assets: groupAccountsByType(assets, false),
      liabilities: groupAccountsByType(liabilities, true)
    },
    totals: {
      assets: totalAssets,
      liabilities: totalLiabilities,
      netWorth: totalAssets - totalLiabilities
    },
    change: {
      period: 'previous_month',
      change: changeAmount,
      percentChange: percentChange,
      hasData: hasData
    },
    calculation: {
      formula: 'assets - liabilities',
      notes: [
        'Active asset account current balances are summed as total assets.',
        'Active liability account current balances are summed as total liabilities.',
        'Net worth is total assets minus total liabilities.',
        'Month-over-month change is dynamically calculated from actual transaction cashflows.'
      ]
    }
  };
}

function sumBalances(accounts, isLiability = false) {
  return accounts.reduce((sum, account) => {
    const val = Number(account.current_balance || 0);
    return sum + (isLiability ? Math.abs(val) : val);
  }, 0);
}

function groupAccountsByType(accounts, isLiability = false) {
  return accounts.reduce((groups, account) => {
    const typeKey = account.account_type || 'other';
    if (!groups[typeKey]) {
      groups[typeKey] = {
        type: typeKey,
        total: 0,
        count: 0,
        accounts: []
      };
    }

    const val = Number(account.current_balance || 0);
    groups[typeKey].accounts.push(account);
    groups[typeKey].total += isLiability ? Math.abs(val) : val;
    groups[typeKey].count += 1;
    return groups;
  }, {});
}

module.exports = {
  getNetWorthSummaryForProfile,
  resolveScopeProfileIds,
  filterAccountsByScope
};
