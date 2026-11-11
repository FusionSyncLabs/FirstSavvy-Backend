const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');
const { pickPublicAccount } = require('./account.service');
const { pickPublicTransaction } = require('./transaction.service');
const { pickPublicContact } = require('./contact.service');
const { pickPublicBudget } = require('./budget.service');
const { pickPublicGoal } = require('./goal.service');
const { pickPublicRule } = require('./transactionRule.service');
const { pickPublicVaultItem } = require('./vault.service');

const SEARCH_ENTITY_TYPES = [
  'accounts',
  'transactions',
  'contacts',
  'budgets',
  // 'goals',
  'journal_entries',
  'transaction_rules',
  'vault_items'
];

const DEFAULT_LIMIT_PER_TYPE = 5;
const MAX_LIMIT_PER_TYPE = 20;
const MIN_QUERY_LENGTH = 2;

function normalizeSearchQuery(value) {
  const search = String(value || '').trim();
  if (!search) {
    throw ApiError.badRequest('Search query is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'query', field: 'q', message: 'Required field is missing' }]
    });
  }

  if (search.length < MIN_QUERY_LENGTH) {
    throw ApiError.badRequest(`Search query must be at least ${MIN_QUERY_LENGTH} characters`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'query', field: 'q', message: `Must be at least ${MIN_QUERY_LENGTH} characters` }]
    });
  }

  return search;
}

function parseLimitPerType(value) {
  const parsed = Number(value ?? DEFAULT_LIMIT_PER_TYPE);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_LIMIT_PER_TYPE;
  }
  return Math.min(parsed, MAX_LIMIT_PER_TYPE);
}

function parseSearchTypes(value) {
  if (!value) {
    return new Set(SEARCH_ENTITY_TYPES);
  }

  const requested = String(value)
    .split(',')
    .map((type) => type.trim().toLowerCase())
    .filter(Boolean);

  const invalid = requested.filter((type) => !SEARCH_ENTITY_TYPES.includes(type));
  if (invalid.length > 0) {
    throw ApiError.badRequest('Invalid search entity type', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{
        location: 'query',
        field: 'types',
        message: `Unsupported types: ${invalid.join(', ')}`
      }]
    });
  }

  return new Set(requested);
}

function buildTextSearchFilter(fields, search) {
  return {
    OR: fields.map((field) => ({
      [field]: { contains: search, mode: 'insensitive' }
    }))
  };
}

function buildSearchItem({ entityType, id, title, subtitle, path, entity = null }) {
  return {
    entity_type: entityType,
    id,
    title,
    subtitle: subtitle || null,
    path,
    entity
  };
}

function buildUsableContactWhere(profileId, search) {
  return {
    profile_id: profileId,
    deleted_at: null,
    AND: [
      buildTextSearchFilter(['name', 'email', 'phone', 'group_name', 'notes'], search),
      {
        NOT: {
          OR: [
            { metadata: { path: ['connection_status'], equals: 'pending' } },
            { metadata: { path: ['connection_status'], equals: 'invited' } }
          ]
        }
      }
    ]
  };
}

function formatMoney(amount) {
  const value = Number(amount || 0);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2
  }).format(value);
}

function formatAccountSubtitle(account) {
  const parts = [
    account.class,
    account.account_type,
    account.account_detail
  ].filter(Boolean);
  return parts.join(' - ');
}

async function searchAccounts(profileId, search, limit) {
  const where = {
    profile_id: profileId,
    deleted_at: null,
    is_active: true,
    ...buildTextSearchFilter([
      'account_name',
      'display_name',
      'institution_name',
      'account_detail',
      'account_mask'
    ], search)
  };

  const [accounts, total] = await Promise.all([
    prisma.userChartOfAccount.findMany({
      where,
      orderBy: [{ display_name: 'asc' }, { account_number: 'asc' }],
      take: limit
    }),
    prisma.userChartOfAccount.count({ where })
  ]);

  return {
    total,
    items: accounts.map((account) => {
      const publicAccount = pickPublicAccount(account);
      const path = account.class === 'income' || account.class === 'expense'
        ? `/Budgeting/category/${account.id}`
        : `/Banking/account/${account.id}`;

      return buildSearchItem({
        entityType: 'accounts',
        id: account.id,
        title: account.display_name || account.account_name || 'Account',
        subtitle: formatAccountSubtitle(account),
        path,
        entity: publicAccount
      });
    })
  };
}

async function searchTransactions(profileId, search, limit) {
  const where = {
    profile_id: profileId,
    deleted_at: null,
    ...buildTextSearchFilter([
      'description',
      'original_description',
      'memo',
      'check_number',
      'external_id'
    ], search)
  };

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        bank_account: true,
        category_account: true
      },
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
      take: limit
    }),
    prisma.transaction.count({ where })
  ]);

  return {
    total,
    items: transactions.map((transaction) => {
      const publicTransaction = pickPublicTransaction(transaction);
      const amountLabel = formatMoney(transaction.amount);
      const subtitleParts = [
        amountLabel,
        transaction.transaction_type,
        transaction.bank_account?.display_name || transaction.bank_account?.account_name
      ].filter(Boolean);

      return buildSearchItem({
        entityType: 'transactions',
        id: transaction.id,
        title: transaction.description,
        subtitle: subtitleParts.join(' - '),
        path: `/Banking?tab=transactions&transactionId=${transaction.id}`,
        entity: publicTransaction
      });
    })
  };
}

async function searchContacts(profileId, search, limit) {
  const where = buildUsableContactWhere(profileId, search);

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      orderBy: [{ name: 'asc' }, { created_at: 'desc' }],
      take: limit
    }),
    prisma.contact.count({ where })
  ]);

  return {
    total,
    items: contacts.map((contact) => {
      const publicContact = pickPublicContact(contact);
      const subtitleParts = [
        contact.contact_type,
        contact.email,
        contact.group_name
      ].filter(Boolean);

      return buildSearchItem({
        entityType: 'contacts',
        id: contact.id,
        title: contact.name,
        subtitle: subtitleParts.join(' - '),
        path: `/Contacts/${contact.id}`,
        entity: publicContact
      });
    })
  };
}

async function searchBudgets(profileId, search, limit) {
  const where = {
    profile_id: profileId,
    is_active: true,
    OR: [
      { name: { contains: search, mode: 'insensitive' } },
      {
        chart_account: {
          OR: [
            { display_name: { contains: search, mode: 'insensitive' } },
            { account_name: { contains: search, mode: 'insensitive' } }
          ]
        }
      }
    ]
  };

  const [budgets, total] = await Promise.all([
    prisma.budget.findMany({
      where,
      include: { chart_account: true },
      orderBy: [{ name: 'asc' }, { updated_at: 'desc' }],
      take: limit
    }),
    prisma.budget.count({ where })
  ]);

  return {
    total,
    items: budgets.map((budget) => {
      const publicBudget = pickPublicBudget(budget);
      const title = budget.name || budget.chart_account?.display_name || budget.chart_account?.account_name || 'Budget';

      return buildSearchItem({
        entityType: 'budgets',
        id: budget.id,
        title,
        subtitle: `${formatMoney(budget.amount)} - ${budget.cadence}`,
        path: '/Budgeting',
        entity: publicBudget
      });
    })
  };
}

async function searchGoals(profileId, search, limit) {
  const where = {
    profile_id: profileId,
    deleted_at: null,
    status: { not: 'archived' },
    ...buildTextSearchFilter(['name', 'description'], search)
  };

  const [goals, total] = await Promise.all([
    prisma.financialGoal.findMany({
      where,
      include: {
        linked_account: true,
        child_profile: {
          select: {
            id: true,
            display_name: true,
            name: true,
            first_name: true,
            last_name: true
          }
        },
        contributions: {
          where: { deleted_at: null }
        }
      },
      orderBy: [{ target_date: 'asc' }, { name: 'asc' }],
      take: limit
    }),
    prisma.financialGoal.count({ where })
  ]);

  return {
    total,
    items: goals.map((goal) => {
      const publicGoal = pickPublicGoal(goal);
      const subtitleParts = [
        `${formatMoney(publicGoal.saved_amount)} of ${formatMoney(publicGoal.target_amount)}`,
        goal.target_date ? new Date(goal.target_date).toISOString().slice(0, 10) : null
      ].filter(Boolean);

      return buildSearchItem({
        entityType: 'goals',
        id: goal.id,
        title: goal.name,
        subtitle: subtitleParts.join(' - '),
        path: '/Goals',
        entity: publicGoal
      });
    })
  };
}

async function searchJournalEntries(profileId, search, limit) {
  const entryNumber = Number.parseInt(search, 10);
  const textFilter = buildTextSearchFilter(['description', 'memo', 'source'], search);
  const where = {
    profile_id: profileId,
    deleted_at: null,
    OR: [
      ...textFilter.OR,
      ...(Number.isInteger(entryNumber) ? [{ entry_number: entryNumber }] : [])
    ]
  };

  const [entries, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      orderBy: [{ entry_date: 'desc' }, { entry_number: 'desc' }],
      take: limit
    }),
    prisma.journalEntry.count({ where })
  ]);

  return {
    total,
    items: entries.map((entry) => buildSearchItem({
      entityType: 'journal_entries',
      id: entry.id,
      title: entry.description,
      subtitle: [
        entry.entry_number ? `#${entry.entry_number}` : null,
        entry.status,
        entry.entry_date ? new Date(entry.entry_date).toISOString().slice(0, 10) : null
      ].filter(Boolean).join(' - '),
      path: '/Banking?tab=transactions',
      entity: {
        id: entry.id,
        profile_id: entry.profile_id,
        entry_number: entry.entry_number,
        entry_date: entry.entry_date,
        description: entry.description,
        memo: entry.memo,
        source: entry.source,
        status: entry.status,
        created_at: entry.created_at,
        updated_at: entry.updated_at
      }
    }))
  };
}

async function searchTransactionRules(profileId, search, limit) {
  const where = {
    profile_id: profileId,
    is_active: true,
    ...buildTextSearchFilter(['name', 'pattern'], search)
  };

  const [rules, total] = await Promise.all([
    prisma.transactionRule.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      take: limit
    }),
    prisma.transactionRule.count({ where })
  ]);

  return {
    total,
    items: rules.map((rule) => {
      const publicRule = pickPublicRule(rule);
      return buildSearchItem({
        entityType: 'transaction_rules',
        id: rule.id,
        title: rule.name,
        subtitle: rule.pattern || publicRule.match_description_pattern || 'Transaction rule',
        path: '/Banking?tab=rules',
        entity: publicRule
      });
    })
  };
}

async function searchVaultItems(profileId, userId, search, limit) {
  const where = {
    profile_id: profileId,
    user_id: userId,
    deleted_at: null,
    ...buildTextSearchFilter(['name', 'url'], search)
  };

  const [items, total] = await Promise.all([
    prisma.vaultItem.findMany({
      where,
      orderBy: [{ is_favorite: 'desc' }, { updated_at: 'desc' }],
      take: limit
    }),
    prisma.vaultItem.count({ where })
  ]);

  return {
    total,
    items: items.map((item) => {
      const publicItem = pickPublicVaultItem(item);
      return buildSearchItem({
        entityType: 'vault_items',
        id: item.id,
        title: item.name,
        subtitle: [item.category, item.url].filter(Boolean).join(' - '),
        path: '/PasswordVault',
        entity: publicItem
      });
    })
  };
}

const SEARCH_HANDLERS = {
  accounts: (profileId, _userId, search, limit) => searchAccounts(profileId, search, limit),
  transactions: (profileId, _userId, search, limit) => searchTransactions(profileId, search, limit),
  contacts: (profileId, _userId, search, limit) => searchContacts(profileId, search, limit),
  budgets: (profileId, _userId, search, limit) => searchBudgets(profileId, search, limit),
  // goals: (profileId, _userId, search, limit) => searchGoals(profileId, search, limit),
  journal_entries: (profileId, _userId, search, limit) => searchJournalEntries(profileId, search, limit),
  transaction_rules: (profileId, _userId, search, limit) => searchTransactionRules(profileId, search, limit),
  vault_items: (profileId, userId, search, limit) => searchVaultItems(profileId, userId, search, limit)
};

const SEARCH_DELEGATES = {
  accounts: ['userChartOfAccount'],
  transactions: ['transaction'],
  contacts: ['contact'],
  budgets: ['budget'],
  goals: ['financialGoal'],
  journal_entries: ['journalEntry'],
  transaction_rules: ['transactionRule'],
  vault_items: ['vaultItem']
};

function isSearchTypeAvailable(type) {
  return (SEARCH_DELEGATES[type] || []).every((delegateName) => (
    prisma[delegateName]?.findMany && prisma[delegateName]?.count
  ));
}

async function searchForProfile(profileId, userId, query = {}) {
  const search = normalizeSearchQuery(query.q ?? query.search);
  const limitPerType = parseLimitPerType(query.limitPerType);
  const types = parseSearchTypes(query.types);

  const groupEntries = await Promise.all(
    [...types].map(async (type) => {
      const handler = SEARCH_HANDLERS[type];
      if (!isSearchTypeAvailable(type)) {
        return [type, { total: 0, items: [] }];
      }

      const group = await handler(profileId, userId, search, limitPerType);
      return [type, group];
    })
  );

  const groups = Object.fromEntries(groupEntries);
  const totals = groupEntries.reduce((acc, [type, group]) => {
    acc[type] = group.total;
    acc.all += group.total;
    return acc;
  }, { all: 0 });

  return {
    query: search,
    limitPerType,
    types: [...types],
    groups,
    totals,
    behavior: {
      minQueryLength: MIN_QUERY_LENGTH,
      defaultLimitPerType: DEFAULT_LIMIT_PER_TYPE,
      maxLimitPerType: MAX_LIMIT_PER_TYPE,
      supportedTypes: SEARCH_ENTITY_TYPES,
      notes: [
        'Search is profile-scoped and requires active profile authorization.',
        'Contacts exclude pending or invited connection requests.',
        'Vault search matches item name and URL only; encrypted fields are never searched.',
        'Each group returns up to limitPerType matches plus a total count for that entity type.'
      ]
    }
  };
}

module.exports = {
  SEARCH_ENTITY_TYPES,
  searchForProfile
};
