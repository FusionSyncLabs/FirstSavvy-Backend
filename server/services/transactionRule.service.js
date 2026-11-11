const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');

function formatTransactionForRule(transaction) {
  if (!transaction) return null;
  return {
    id: transaction.id,
    profile_id: transaction.profile_id,
    bank_account_id: transaction.bank_account_id,
    category_account_id: transaction.category_account_id,
    contact_id: transaction.contact_id,
    date: transaction.date,
    posted_date: transaction.posted_date,
    description: transaction.description,
    original_description: transaction.original_description || transaction.description,
    amount: transaction.amount !== null && transaction.amount !== undefined ? Number(transaction.amount) : 0,
    type: transaction.transaction_type || transaction.type,
    transaction_type: transaction.transaction_type || transaction.type,
    status: transaction.status,
    memo: transaction.memo,
    bank_account: transaction.bank_account ? {
      id: transaction.bank_account.id,
      display_name: transaction.bank_account.display_name,
      account_name: transaction.bank_account.account_name
    } : undefined,
    category_account: transaction.category_account ? {
      id: transaction.category_account.id,
      display_name: transaction.category_account.display_name,
      account_name: transaction.category_account.account_name
    } : undefined
  };
}

const RULE_FIELDS = [
  'name',
  'match_description_pattern',
  'match_description_mode',
  'match_original_description_pattern',
  'match_case_sensitive',
  'match_money_direction',
  'match_bank_account_ids',
  'match_bank_account_id',
  'match_amount_exact',
  'match_amount_min',
  'match_amount_max',
  'match_transaction_type',
  'match_contact_id',
  'match_date_from',
  'match_date_to',
  'match_conditions_logic',
  'action_set_category_id',
  'action_set_contact_id',
  'action_set_description',
  'action_add_note',
  'action_add_tags',
  'auto_confirm_and_post',
  'is_enabled',
  'created_from_transaction_id'
];

async function listRulesForProfile(profileId, query = {}) {
  const rules = await prisma.transactionRule.findMany({
    where: {
      profile_id: profileId,
      ...(query.enabled === undefined ? {} : { is_active: query.enabled === 'true' })
    },
    orderBy: buildRuleOrder(query.sortBy || 'name')
  });

  return {
    rules: rules.map(pickPublicRule)
  };
}

async function getRuleForProfile(profileId, ruleId) {
  return pickPublicRule(await findRule(profileId, ruleId));
}

async function createRuleForProfile(profileId, input = {}) {
  const data = buildRuleData(profileId, input);
  await assertRuleContactsUsable(profileId, data);
  const rule = await prisma.transactionRule.create({ data });
  return pickPublicRule(rule);
}

async function updateRuleForProfile(profileId, ruleId, input = {}) {
  await findRule(profileId, ruleId);
  const data = buildRuleData(profileId, input, { partial: true });
  await assertRuleContactsUsable(profileId, data);
  const rule = await prisma.transactionRule.update({
    where: { id: ruleId },
    data
  });
  return pickPublicRule(rule);
}

async function deleteRuleForProfile(profileId, ruleId) {
  await findRule(profileId, ruleId);
  await prisma.transactionRule.delete({ where: { id: ruleId } });
  return { deleted: true };
}

async function duplicateRuleForProfile(profileId, ruleId) {
  const rule = pickPublicRule(await findRule(profileId, ruleId));
  const duplicate = await createRuleForProfile(profileId, {
    ...rule,
    name: `${rule.name} (Copy)`,
    times_matched: 0,
    last_matched_at: null
  });
  return duplicate;
}

async function getRuleMatchPreview(profileId, input = {}) {
  try {
    const conditions = sanitizeRulePayload(input.conditions || input);
    const limit = normalizeLimit(input.limit, 100);
    const transactions = await prisma.transaction.findMany({
      where: {
        profile_id: profileId,
        deleted_at: null
      },
      include: {
        bank_account: true,
        category_account: true,
        contact: true,
        splits: {
          include: { category_account: true },
          orderBy: { created_at: 'asc' }
        }
      },
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
      take: 2000
    });

    const matched = transactions
      .map(formatTransactionForRule)
      .filter((publicTxn) => transactionMatchesConditions(
        {
          ...publicTxn,
          type: publicTxn.transaction_type || publicTxn.type,
          original_description: publicTxn.original_description || publicTxn.description
        },
        conditions
      ))
      .slice(0, limit);

    return {
      transactions: matched
    };
  } catch (error) {
    console.error('Error in getRuleMatchPreview:', error);
    throw error;
  }
}

async function applyRuleToPendingTransactions(profileId, ruleId) {
  const rule = pickPublicRule(await findRule(profileId, ruleId));
  await assertContactIdsUsable(profileId, [
    rule.match_contact_id,
    rule.action_set_contact_id
  ]);
  const transactions = await prisma.transaction.findMany({
    where: {
      profile_id: profileId,
      status: 'pending',
      deleted_at: null
    },
    orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
    take: 10000
  });

  let applied = 0;
  for (const transaction of transactions) {
    const publicTransaction = {
      ...transaction,
      amount: decimalToNumber(transaction.amount),
      type: transaction.transaction_type
    };

    if (!transactionMatchesConditions(publicTransaction, rule)) continue;

    const data = buildTransactionRuleActions(rule);
    if (Object.keys(data).length === 0) continue;
    data.metadata = {
      ...normalizeJson(transaction.metadata),
      applied_rule_id: ruleId
    };

    await prisma.transaction.update({
      where: { id: transaction.id },
      data
    });
    applied += 1;
  }

  if (applied > 0) {
    await prisma.transactionRule.update({
      where: { id: ruleId },
      data: {
        apply_count: { increment: applied },
        last_applied_at: new Date()
      }
    });
  }

  return { applied };
}

async function findRule(profileId, ruleId) {
  const rule = await prisma.transactionRule.findFirst({
    where: {
      id: ruleId,
      profile_id: profileId
    }
  });

  if (!rule) {
    throw ApiError.notFound('Transaction rule not found', {
      code: ERROR_CODES.TRANSACTION_NOT_FOUND
    });
  }

  return rule;
}

function buildRuleData(profileId, input = {}, options = {}) {
  const cleaned = sanitizeRulePayload(input);
  const name = normalizeString(cleaned.name);

  if (!options.partial && !name) {
    throw ApiError.badRequest('Rule name is required', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const conditions = pickKeys(cleaned, (key) => key.startsWith('match_') || key === 'created_from_transaction_id');
  const actions = pickKeys(cleaned, (key) => key.startsWith('action_') || key === 'auto_confirm_and_post');

  const data = {};
  if (!options.partial) data.profile_id = profileId;
  if (name !== undefined) data.name = name;
  if (cleaned.match_description_pattern !== undefined) data.pattern = cleaned.match_description_pattern || null;
  if (cleaned.match_description_mode !== undefined) data.pattern_type = cleaned.match_description_mode || 'contains';
  if (cleaned.action_set_category_id !== undefined) data.category_account_id = cleaned.action_set_category_id || null;
  if (cleaned.action_set_contact_id !== undefined) data.contact_id = cleaned.action_set_contact_id || null;
  if (cleaned.is_enabled !== undefined) data.is_active = Boolean(cleaned.is_enabled);
  if (Object.keys(conditions).length > 0 || !options.partial) data.conditions = conditions;
  if (Object.keys(actions).length > 0 || !options.partial) data.actions = actions;

  return data;
}

async function assertRuleContactsUsable(profileId, data) {
  await assertContactIdsUsable(profileId, [
    data.contact_id,
    data.conditions?.match_contact_id,
    data.actions?.action_set_contact_id
  ]);
}

async function assertContactIdsUsable(profileId, contactIds) {
  const uniqueContactIds = [...new Set(contactIds.filter(Boolean))];
  if (uniqueContactIds.length === 0) return;

  const contacts = await prisma.contact.findMany({
    where: {
      id: { in: uniqueContactIds },
      profile_id: profileId,
      deleted_at: null
    },
    select: {
      id: true,
      metadata: true
    }
  });

  if (contacts.length !== uniqueContactIds.length) {
    throw ApiError.badRequest('Transaction rule contacts must belong to this profile', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  if (contacts.some((contact) => isContactUnavailableOutsideContacts(contact))) {
    throw ApiError.badRequest('Transaction rule contacts must be connected before use', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
}

function isContactUnavailableOutsideContacts(contact) {
  const metadata = contact.metadata && typeof contact.metadata === 'object' && !Array.isArray(contact.metadata)
    ? contact.metadata
    : {};
  return ['pending', 'invited'].includes(metadata.connection_status);
}

function pickPublicRule(rule) {
  const conditions = normalizeJson(rule.conditions);
  const actions = normalizeJson(rule.actions);
  const timesMatched = Number(rule.apply_count || 0);
  const timesAccepted = Number(actions.times_accepted || 0);
  const timesRejected = Number(actions.times_rejected || 0);
  const feedbackTotal = timesAccepted + timesRejected;

  return {
    id: rule.id,
    profile_id: rule.profile_id,
    name: rule.name,
    description: conditions.description || null,
    match_description_pattern: conditions.match_description_pattern ?? rule.pattern,
    match_description_mode: conditions.match_description_mode ?? rule.pattern_type ?? 'contains',
    match_original_description_pattern: conditions.match_original_description_pattern ?? null,
    match_case_sensitive: Boolean(conditions.match_case_sensitive),
    match_money_direction: conditions.match_money_direction || 'both',
    match_bank_account_ids: conditions.match_bank_account_ids || [],
    match_bank_account_id: conditions.match_bank_account_id || null,
    match_amount_exact: decimalToNumber(conditions.match_amount_exact),
    match_amount_min: decimalToNumber(conditions.match_amount_min),
    match_amount_max: decimalToNumber(conditions.match_amount_max),
    match_transaction_type: conditions.match_transaction_type || null,
    match_contact_id: conditions.match_contact_id || null,
    match_date_from: conditions.match_date_from || null,
    match_date_to: conditions.match_date_to || null,
    match_conditions_logic: conditions.match_conditions_logic || 'any',
    action_set_category_id: actions.action_set_category_id ?? rule.category_account_id,
    action_set_contact_id: actions.action_set_contact_id ?? rule.contact_id,
    action_set_description: actions.action_set_description || null,
    action_add_note: actions.action_add_note || null,
    action_add_tags: actions.action_add_tags || [],
    auto_confirm_and_post: Boolean(actions.auto_confirm_and_post),
    is_enabled: rule.is_active,
    created_from_transaction_id: conditions.created_from_transaction_id || null,
    times_matched: timesMatched,
    times_accepted: timesAccepted,
    times_rejected: timesRejected,
    acceptance_rate: feedbackTotal > 0 ? (timesAccepted / feedbackTotal) * 100 : 0,
    last_matched_at: rule.last_applied_at,
    created_at: rule.created_at,
    updated_at: rule.updated_at
  };
}

function transactionMatchesConditions(transaction, conditions = {}) {
  // 1. Mandatory Scope / Filter Checks (All must pass if defined)
  
  // Bank Account filter
  const bankAccountIds = Array.isArray(conditions.match_bank_account_ids)
    ? conditions.match_bank_account_ids.filter(Boolean)
    : (conditions.match_bank_account_id ? [conditions.match_bank_account_id] : []);
  if (bankAccountIds.length > 0 && !bankAccountIds.includes(transaction.bank_account_id)) {
    return false;
  }

  // Money Direction filter
  if (conditions.match_money_direction && conditions.match_money_direction !== 'both') {
    const isMoneyIn = transaction.type === 'income' || Number(transaction.amount) > 0;
    if (conditions.match_money_direction === 'money_in' && !isMoneyIn) {
      return false;
    }
    if (conditions.match_money_direction === 'money_out' && isMoneyIn) {
      return false;
    }
  }

  // Transaction Type filter
  if (conditions.match_transaction_type) {
    const txnType = transaction.type || transaction.transaction_type;
    if (txnType !== conditions.match_transaction_type) {
      return false;
    }
  }

  // Contact filter
  if (conditions.match_contact_id && transaction.contact_id !== conditions.match_contact_id) {
    return false;
  }

  // Category filter
  const categoryFilter = conditions.match_category_id || conditions.match_category_account_id;
  if (categoryFilter && transaction.category_account_id !== categoryFilter) {
    return false;
  }

  // Date Range filters
  const date = String(transaction.date || '').slice(0, 10);
  if (conditions.match_date_from && date < conditions.match_date_from) {
    return false;
  }
  if (conditions.match_date_to && date > conditions.match_date_to) {
    return false;
  }

  // 2. Content & Amount Condition Checks
  const contentChecks = [];

  // Description Pattern
  if (conditions.match_description_pattern) {
    contentChecks.push(matchesPattern(
      transaction.description,
      conditions.match_description_pattern,
      conditions.match_description_mode || 'contains',
      conditions.match_case_sensitive
    ));
  }

  // Bank Memo / Original Description Pattern
  if (conditions.match_original_description_pattern) {
    contentChecks.push(matchesPattern(
      transaction.original_description || transaction.memo || transaction.description,
      conditions.match_original_description_pattern,
      conditions.match_description_mode || 'contains',
      conditions.match_case_sensitive
    ));
  }

  // Amount Matchers
  const amount = Math.abs(Number(transaction.amount || 0));
  if (conditions.match_amount_exact !== undefined && conditions.match_amount_exact !== null && conditions.match_amount_exact !== '') {
    contentChecks.push(Math.abs(amount - Math.abs(Number(conditions.match_amount_exact))) < 0.001);
  }
  if (conditions.match_amount_min !== undefined && conditions.match_amount_min !== null && conditions.match_amount_min !== '') {
    contentChecks.push(amount >= Math.abs(Number(conditions.match_amount_min)));
  }
  if (conditions.match_amount_max !== undefined && conditions.match_amount_max !== null && conditions.match_amount_max !== '') {
    contentChecks.push(amount <= Math.abs(Number(conditions.match_amount_max)));
  }

  // If NO content/amount conditions are defined, return true (scope filters passed)
  if (contentChecks.length === 0) {
    return true;
  }

  // Evaluate content conditions based on logic ('all' vs 'any')
  const logic = conditions.match_conditions_logic === 'any' ? 'any' : 'all';
  return logic === 'all' ? contentChecks.every(Boolean) : contentChecks.some(Boolean);
}

function matchesPattern(value, pattern, mode = 'contains', caseSensitive = false) {
  if (!pattern) return false;
  if (!value) return false;

  const patterns = String(pattern).split('|').map((item) => item.trim()).filter(Boolean);
  if (patterns.length === 0) return false;

  const rawHaystack = String(value).trim();
  const haystack = caseSensitive ? rawHaystack : rawHaystack.toLowerCase();

  return patterns.some((rawPattern) => {
    const needle = caseSensitive ? rawPattern : rawPattern.toLowerCase();
    if (!needle) return false;

    if (mode === 'exact') {
      return haystack === needle;
    }
    if (mode === 'starts_with') {
      return haystack.startsWith(needle);
    }
    if (mode === 'ends_with') {
      return haystack.endsWith(needle);
    }
    if (mode === 'regex') {
      try {
        return new RegExp(rawPattern, caseSensitive ? '' : 'i').test(rawHaystack);
      } catch {
        return false;
      }
    }
    // Default 'contains'
    return haystack.includes(needle);
  });
}

function buildTransactionRuleActions(rule) {
  const data = {};
  if (rule.action_set_category_id) data.category_account_id = rule.action_set_category_id;
  if (rule.action_set_contact_id) data.contact_id = rule.action_set_contact_id;
  if (rule.action_set_description) data.description = rule.action_set_description;
  if (rule.action_add_note) data.memo = rule.action_add_note;
  if (rule.auto_confirm_and_post && rule.action_set_category_id) data.status = 'posted';
  return data;
}

function buildRuleOrder(sortBy) {
  const raw = String(sortBy || 'name');
  const descending = raw.startsWith('-');
  const field = descending ? raw.slice(1) : raw;
  const column = field === 'is_enabled' ? 'is_active' : field;

  if (!['name', 'created_at', 'updated_at', 'is_active', 'priority'].includes(column)) {
    return [{ name: 'asc' }];
  }

  return [{ [column]: descending ? 'desc' : 'asc' }];
}

function sanitizeRulePayload(input = {}) {
  return RULE_FIELDS.reduce((acc, field) => {
    if (input[field] !== undefined) acc[field] = input[field];
    return acc;
  }, {});
}

function pickKeys(value, predicate) {
  return Object.entries(value).reduce((acc, [key, item]) => {
    if (predicate(key)) acc[key] = item;
    return acc;
  }, {});
}

function normalizeLimit(value, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return Math.min(number, 100);
}

function normalizeString(value) {
  if (value === undefined) return undefined;
  const trimmed = String(value || '').trim();
  return trimmed || undefined;
}

function normalizeJson(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function decimalToNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  return Number(value);
}

module.exports = {
  listRulesForProfile,
  getRuleForProfile,
  createRuleForProfile,
  updateRuleForProfile,
  deleteRuleForProfile,
  duplicateRuleForProfile,
  getRuleMatchPreview,
  applyRuleToPendingTransactions,
  pickPublicRule,
  transactionMatchesConditions,
  buildTransactionRuleActions
};
