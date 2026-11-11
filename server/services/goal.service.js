const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');
const { parsePaginationQuery, buildPaginationMeta } = require('../utils/pagination');
const { pickPublicAccount } = require('./account.service');
const { createTransactionInTransaction } = require('./transaction.service');
const {
  createNotificationsForProfile,
  createNotificationsForProfileMembers
} = require('./notification.service');

const GOAL_STATUSES = new Set(['active', 'completed', 'paused', 'archived']);
const GOAL_SORT_FIELDS = new Set(['name', 'target_amount', 'target_date', 'status', 'created_at', 'updated_at']);

const goalInclude = {
  linked_account: true,
  child_profile: {
    select: {
      id: true,
      auth_user_id: true,
      display_name: true,
      name: true,
      first_name: true,
      last_name: true
    }
  },
  contributions: {
    where: { deleted_at: null },
    include: {
      transaction: true
    },
    orderBy: [{ contribution_date: 'desc' }, { created_at: 'desc' }]
  }
};

function decimalToNumber(value) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNullableString(value) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function parseMoney(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw ApiError.badRequest(`${field} must be a valid amount`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field, message: 'Must be greater than zero' }]
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

function normalizeGoalStatus(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const status = String(value).trim().toLowerCase();
  if (!GOAL_STATUSES.has(status)) {
    throw ApiError.badRequest('Invalid goal status', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'status', message: `Must be one of: ${[...GOAL_STATUSES].join(', ')}` }]
    });
  }
  return status;
}

function computeSavedAmount(contributions = []) {
  return roundMoney(contributions.reduce((sum, contribution) => sum + Number(contribution.amount || 0), 0));
}

function computeProgress(goal) {
  const targetAmount = decimalToNumber(goal.target_amount) || 0;
  const savedAmount = computeSavedAmount(goal.contributions || []);
  const remainingAmount = Math.max(0, roundMoney(targetAmount - savedAmount));
  const progressPercent = targetAmount > 0
    ? Math.min(100, Number(((savedAmount / targetAmount) * 100).toFixed(2)))
    : 0;

  return {
    saved_amount: savedAmount,
    remaining_amount: remainingAmount,
    progress_percent: progressPercent,
    is_completed: savedAmount >= targetAmount && targetAmount > 0
  };
}

function pickPublicTransactionSummary(transaction) {
  if (!transaction) return undefined;
  return {
    id: transaction.id,
    date: transaction.date,
    posted_date: transaction.posted_date,
    description: transaction.description,
    amount: decimalToNumber(transaction.amount),
    transaction_type: transaction.transaction_type,
    status: transaction.status,
    journal_entry_id: transaction.journal_entry_id
  };
}

function pickPublicContribution(contribution) {
  return {
    id: contribution.id,
    goal_id: contribution.goal_id,
    profile_id: contribution.profile_id,
    amount: decimalToNumber(contribution.amount),
    contribution_date: contribution.contribution_date,
    transaction_id: contribution.transaction_id,
    notes: contribution.notes,
    metadata: normalizeMetadata(contribution.metadata),
    transaction: pickPublicTransactionSummary(contribution.transaction),
    created_at: contribution.created_at,
    updated_at: contribution.updated_at
  };
}

function pickPublicGoal(goal, options = {}) {
  const progress = computeProgress(goal);
  const publicGoal = {
    id: goal.id,
    profile_id: goal.profile_id,
    child_profile_id: goal.child_profile_id,
    linked_account_id: goal.linked_account_id,
    name: goal.name,
    description: goal.description,
    target_amount: decimalToNumber(goal.target_amount),
    target_date: goal.target_date,
    icon: goal.icon,
    color: goal.color,
    status: goal.status,
    metadata: normalizeMetadata(goal.metadata),
    saved_amount: progress.saved_amount,
    remaining_amount: progress.remaining_amount,
    progress_percent: progress.progress_percent,
    is_completed: progress.is_completed || goal.status === 'completed',
    linked_account: goal.linked_account ? pickPublicAccount(goal.linked_account) : undefined,
    child_profile: goal.child_profile ? {
      id: goal.child_profile.id,
      display_name: goal.child_profile.display_name,
      name: goal.child_profile.name,
      first_name: goal.child_profile.first_name,
      last_name: goal.child_profile.last_name
    } : undefined,
    created_at: goal.created_at,
    updated_at: goal.updated_at
  };

  if (options.includeContributions) {
    publicGoal.contributions = (goal.contributions || []).map(pickPublicContribution);
  }

  return publicGoal;
}

function buildGoalWhere(profileId, query = {}) {
  const where = {
    profile_id: profileId,
    deleted_at: null
  };

  if (query.status) {
    where.status = normalizeGoalStatus(query.status);
  } else if (query.includeCompleted !== 'true') {
    where.status = { not: 'archived' };
  }

  if (query.childProfileId) where.child_profile_id = query.childProfileId;
  if (query.search?.trim()) {
    where.name = { contains: query.search.trim(), mode: 'insensitive' };
  }

  return where;
}

function buildGoalOrder(orderBy = 'target_date') {
  const direction = orderBy.startsWith('-') ? 'desc' : 'asc';
  const field = orderBy.replace(/^-/, '');
  if (!GOAL_SORT_FIELDS.has(field)) return [{ target_date: 'asc' }, { name: 'asc' }];
  return [{ [field]: direction }, { name: 'asc' }];
}

async function listGoalsForProfile(profileId, query = {}) {
  const pagination = parsePaginationQuery(query, { defaultLimit: 100, maxLimit: 1000 });
  const where = buildGoalWhere(profileId, query);

  const [goals, total] = await Promise.all([
    prisma.financialGoal.findMany({
      where,
      include: goalInclude,
      orderBy: buildGoalOrder(query.orderBy || 'target_date'),
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.financialGoal.count({ where })
  ]);

  return {
    goals: goals.map((goal) => pickPublicGoal(goal)),
    pagination: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

async function getGoalSummaryForProfile(profileId) {
  const goals = await prisma.financialGoal.findMany({
    where: {
      profile_id: profileId,
      deleted_at: null,
      status: { in: ['active', 'paused', 'completed'] }
    },
    include: goalInclude,
    orderBy: [{ updated_at: 'desc' }]
  });

  const publicGoals = goals.map((goal) => pickPublicGoal(goal));
  const totals = publicGoals.reduce((acc, goal) => {
    acc.total_goal_count += 1;
    acc.total_target_amount += Number(goal.target_amount || 0);
    acc.total_saved_amount += Number(goal.saved_amount || 0);
    if (goal.status === 'completed') acc.completed_goal_count += 1;
    if (goal.status === 'active' || goal.status === 'paused') acc.pending_goal_count += 1;
    return acc;
  }, {
    total_goal_count: 0,
    pending_goal_count: 0,
    completed_goal_count: 0,
    total_target_amount: 0,
    total_saved_amount: 0
  });

  const nextDueGoal = publicGoals
    .filter((goal) => goal.status === 'active' && goal.target_date)
    .sort((a, b) => new Date(a.target_date) - new Date(b.target_date))[0] || null;

  return {
    summary: {
      ...totals,
      total_remaining_amount: Math.max(0, roundMoney(totals.total_target_amount - totals.total_saved_amount)),
      average_progress_percent: totals.total_target_amount > 0
        ? Math.min(100, Number(((totals.total_saved_amount / totals.total_target_amount) * 100).toFixed(2)))
        : 0,
      next_due_goal: nextDueGoal,
      recent_goals: publicGoals.slice(0, 5)
    }
  };
}

async function getGoalForProfile(profileId, goalId, options = {}) {
  const goal = await findGoal(profileId, goalId);
  return pickPublicGoal(goal, { includeContributions: options.includeContributions !== false });
}

async function createGoalForProfile(profileId, input = {}, context = {}) {
  const name = input.name?.trim();
  if (!name) {
    throw ApiError.badRequest('Goal name is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'name', message: 'Required field is missing' }]
    });
  }

  if (!input.linked_account_id) {
    throw ApiError.badRequest('A linked asset account is required for every goal', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'linked_account_id', message: 'Required field is missing' }]
    });
  }

  const data = await buildGoalData(profileId, input);
  const goal = await prisma.$transaction(async (tx) => {
    const createdGoal = await tx.financialGoal.create({
      data: { profile_id: profileId, name, ...data },
      include: goalInclude
    });

    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'financial_goal',
      entityId: createdGoal.id,
      action: 'created',
      afterData: pickPublicGoal(createdGoal),
      reason: 'Goal created with linked asset account'
    });

    return createdGoal;
  });

  return pickPublicGoal(goal);
}

async function updateGoalForProfile(profileId, goalId, input = {}, context = {}) {
  const existingGoal = await findGoal(profileId, goalId);
  const beforeData = pickPublicGoal(existingGoal, { includeContributions: true });
  const data = await buildGoalData(profileId, input, { partial: true });

  if (input.name !== undefined) {
    const name = input.name?.trim();
    if (!name) {
      throw ApiError.badRequest('Goal name cannot be blank', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'name', message: 'Must not be blank' }]
      });
    }
    data.name = name;
  }

  if (data.linked_account_id && data.linked_account_id !== existingGoal.linked_account_id) {
    const contributionCount = existingGoal.contributions?.length || 0;
    if (contributionCount > 0) {
      throw ApiError.badRequest('Goal linked account cannot be changed after contributions exist', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'linked_account_id', message: 'Archive this goal or delete contributions before changing account' }]
      });
    }
  }

  if (data.target_amount !== undefined && data.target_amount < beforeData.saved_amount) {
    throw ApiError.badRequest('Goal target cannot be less than the amount already saved', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{
        location: 'body',
        field: 'target_amount',
        message: `Must be at least the current saved amount (${beforeData.saved_amount})`
      }]
    });
  }

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest('No goal updates were provided', { code: ERROR_CODES.VALIDATION_FAILED });
  }

  const goal = await prisma.$transaction(async (tx) => {
    const updatedGoal = await tx.financialGoal.update({
      where: { id: goalId },
      data,
      include: goalInclude
    });

    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'financial_goal',
      entityId: goalId,
      action: data.status && data.status !== existingGoal.status ? 'status_changed' : 'updated',
      beforeData,
      afterData: pickPublicGoal(updatedGoal, { includeContributions: true }),
      reason: input.reason || input.audit_reason || 'Goal updated'
    });

    return updatedGoal;
  });

  return pickPublicGoal(goal, { includeContributions: true });
}

async function deleteGoalForProfile(profileId, goalId, context = {}) {
  const existingGoal = await findGoal(profileId, goalId);
  const beforeData = pickPublicGoal(existingGoal, { includeContributions: true });

  await prisma.$transaction(async (tx) => {
    await tx.financialGoal.update({
      where: { id: goalId },
      data: { deleted_at: new Date(), status: 'archived' }
    });

    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'financial_goal',
      entityId: goalId,
      action: 'deleted',
      beforeData,
      reason: 'Goal deleted'
    });
  });

  return { deleted: true };
}

async function listContributionsForGoal(profileId, goalId, query = {}) {
  await findGoal(profileId, goalId);
  const pagination = parsePaginationQuery(query, { defaultLimit: 100, maxLimit: 1000 });
  const where = { goal_id: goalId, profile_id: profileId, deleted_at: null };

  const [contributions, total] = await Promise.all([
    prisma.goalContribution.findMany({
      where,
      include: { transaction: true },
      orderBy: [{ contribution_date: 'desc' }, { created_at: 'desc' }],
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.goalContribution.count({ where })
  ]);

  return {
    contributions: contributions.map(pickPublicContribution),
    pagination: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

async function createContributionForGoal(profileId, goalId, input = {}, context = {}) {
  const goal = await findGoal(profileId, goalId);

  const result = await prisma.$transaction(async (tx) => {
    const transactionId = await resolveContributionTransaction(tx, profileId, goal, input, context.userId);
    const ledgerContribution = await validateContributionTransaction(tx, profileId, goal, transactionId);
    await assertTransactionNotLinked(tx, profileId, transactionId);

    const contribution = await tx.goalContribution.create({
      data: {
        goal_id: goalId,
        profile_id: profileId,
        amount: ledgerContribution.amount,
        contribution_date: ledgerContribution.contributionDate,
        transaction_id: transactionId,
        notes: normalizeNullableString(input.notes),
        metadata: normalizeMetadata({
          ...normalizeMetadata(input.metadata),
          journal_entry_id: ledgerContribution.journalEntryId,
          linked_account_id: goal.linked_account_id,
          ledger_direction: 'debit'
        })
      },
      include: { transaction: true }
    });

    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'goal_contribution',
      entityId: contribution.id,
      action: 'created',
      afterData: pickPublicContribution(contribution),
      reason: 'Goal contribution linked to posted transaction ledger movement'
    });

    const updatedGoal = await syncGoalCompletionStatus(tx, goalId, profileId);
    return { contribution, goal: updatedGoal };
  });

  return {
    contribution: pickPublicContribution(result.contribution),
    goal: pickPublicGoal(result.goal, { includeContributions: true }),
    goal_progress: pickGoalProgress(result.goal)
  };
}

async function updateContributionForGoal(profileId, goalId, contributionId, input = {}, context = {}) {
  await findGoal(profileId, goalId);
  const existingContribution = await findContribution(profileId, goalId, contributionId);

  if (input.notes === undefined || input.notes === null || String(input.notes).trim() === '' || String(input.notes).trim() === existingContribution.notes) {
    throw ApiError.badRequest('No contribution updates were provided', { code: ERROR_CODES.VALIDATION_FAILED });
  }

  const contribution = await prisma.$transaction(async (tx) => {
    const contribution = await tx.goalContribution.update({
      where: { id: contributionId },
      data: {
        notes: normalizeNullableString(input.notes)
      },
      include: { transaction: true }
    });

    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'goal_contribution',
      entityId: contributionId,
      action: 'updated',
      beforeData: pickPublicContribution(existingContribution),
      afterData: pickPublicContribution(contribution),
      reason: 'Goal contribution notes updated'
    });

    return contribution;
  });

  return {
    contribution: pickPublicContribution(contribution)
  };
}

async function deleteContributionForGoal(profileId, goalId, contributionId, context = {}) {
  await findGoal(profileId, goalId);
  const existingContribution = await findContribution(profileId, goalId, contributionId);

  const goal = await prisma.$transaction(async (tx) => {
    await tx.goalContribution.update({
      where: { id: contributionId },
      data: { deleted_at: new Date() }
    });

    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'goal_contribution',
      entityId: contributionId,
      action: 'deleted',
      beforeData: pickPublicContribution(existingContribution),
      reason: 'Goal contribution unlinked from goal; transaction ledger remains unchanged'
    });

    return syncGoalCompletionStatus(tx, goalId, profileId);
  });

  return {
    deleted: true,
    goal: pickPublicGoal(goal, { includeContributions: true }),
    goal_progress: pickGoalProgress(goal)
  };
}

async function resolveContributionTransaction(tx, profileId, goal, input = {}, userId = null) {
  const providedTransactionId = input.transaction_id || input.transactionId;
  if (providedTransactionId) return providedTransactionId;

  if (input.transaction && typeof input.transaction === 'object' && !Array.isArray(input.transaction)) {
    const transaction = await createTransactionInTransaction(
      tx,
      profileId,
      buildContributionTransactionInput(goal, input.transaction),
      userId
    );
    return transaction.id;
  }

  throw ApiError.badRequest('A posted transaction is required for a goal contribution', {
    code: ERROR_CODES.VALIDATION_FAILED,
    details: [{ location: 'body', field: 'transaction_id', message: 'Provide transaction_id or transaction payload' }]
  });
}

function buildContributionTransactionInput(goal, transactionInput = {}) {
  const transactionType = normalizeEnumValue(transactionInput.transaction_type ?? transactionInput.transactionType ?? 'transfer');
  const normalizedInput = {
    ...transactionInput,
    transaction_type: transactionType,
    status: 'posted'
  };

  if (transactionType === 'transfer') {
    const providedLinkedAccount = transactionInput.category_account_id ?? transactionInput.categoryAccountId;
    assertGoalLinkedAccountField(providedLinkedAccount, goal.linked_account_id, 'transaction.category_account_id');
    return {
      ...normalizedInput,
      category_account_id: goal.linked_account_id
    };
  }

  const providedLinkedAccount = transactionInput.bank_account_id ?? transactionInput.bankAccountId;
  assertGoalLinkedAccountField(providedLinkedAccount, goal.linked_account_id, 'transaction.bank_account_id');
  return {
    ...normalizedInput,
    bank_account_id: goal.linked_account_id
  };
}

function assertGoalLinkedAccountField(providedAccountId, linkedAccountId, field) {
  if (!providedAccountId || providedAccountId === linkedAccountId) return;

  throw ApiError.badRequest('Goal contribution transaction account must match the goal linked account', {
    code: ERROR_CODES.VALIDATION_FAILED,
    details: [{
      location: 'body',
      field,
      message: 'Omit this field or use the goal linked account'
    }]
  });
}

async function validateContributionTransaction(tx, profileId, goal, transactionId) {
  const transaction = await tx.transaction.findFirst({
    where: {
      id: transactionId,
      profile_id: profileId,
      deleted_at: null
    },
    include: {
      journal_entry: {
        include: {
          lines: true
        }
      }
    }
  });

  if (!transaction) {
    throw ApiError.badRequest('Transaction must belong to the active profile', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'transaction_id', message: 'Invalid transaction' }]
    });
  }

  if (transaction.status !== 'posted' || !transaction.journal_entry_id || !transaction.journal_entry) {
    throw ApiError.badRequest('Goal contributions require a posted transaction with a journal entry', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'transaction_id', message: 'Transaction must be posted before linking to a goal' }]
    });
  }

  const linkedAccountLines = transaction.journal_entry.lines.filter((line) => line.account_id === goal.linked_account_id);
  if (linkedAccountLines.length === 0) {
    throw ApiError.badRequest('Transaction does not affect the goal linked account', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'transaction_id', message: 'Journal entry must include the goal linked asset account' }]
    });
  }

  const debit = linkedAccountLines.reduce((sum, line) => sum + Number(line.debit || 0), 0);
  const credit = linkedAccountLines.reduce((sum, line) => sum + Number(line.credit || 0), 0);
  const netAmount = roundMoney(debit - credit);

  if (netAmount <= 0) {
    throw ApiError.badRequest('Transaction must debit and increase the goal linked asset account', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'transaction_id', message: 'Journal entry must have a net debit on the goal linked asset account' }]
    });
  }

  return {
    amount: netAmount,
    contributionDate: transaction.posted_date || transaction.date,
    journalEntryId: transaction.journal_entry_id
  };
}

async function assertTransactionNotLinked(tx, profileId, transactionId, ignoreContributionId = null) {
  const existing = await tx.goalContribution.findFirst({
    where: {
      profile_id: profileId,
      transaction_id: transactionId,
      deleted_at: null,
      ...(ignoreContributionId ? { id: { not: ignoreContributionId } } : {})
    }
  });

  if (existing) {
    throw ApiError.badRequest('Transaction is already linked to a goal contribution', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'transaction_id', message: 'A transaction can only count toward one active goal contribution' }]
    });
  }
}

async function findGoal(profileId, goalId) {
  const goal = await prisma.financialGoal.findFirst({
    where: { id: goalId, profile_id: profileId, deleted_at: null },
    include: goalInclude
  });

  if (!goal) throw ApiError.notFound('Goal not found', { code: ERROR_CODES.NOT_FOUND });
  return goal;
}

async function findContribution(profileId, goalId, contributionId) {
  const contribution = await prisma.goalContribution.findFirst({
    where: { id: contributionId, goal_id: goalId, profile_id: profileId, deleted_at: null },
    include: { transaction: true }
  });

  if (!contribution) throw ApiError.notFound('Goal contribution not found', { code: ERROR_CODES.NOT_FOUND });
  return contribution;
}

async function buildGoalData(profileId, input = {}, options = {}) {
  const data = {};

  if (input.description !== undefined) data.description = normalizeNullableString(input.description);
  if (input.target_amount !== undefined || !options.partial) data.target_amount = parseMoney(input.target_amount, 'target_amount');
  if (input.target_date !== undefined) {
    const parsedTargetDate = parseNullableDate(input.target_date, 'target_date');
    if (parsedTargetDate && !options.partial) {
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);
      if (parsedTargetDate < todayStart) {
        throw ApiError.badRequest('Target date cannot be in the past', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: 'target_date', message: 'Target date cannot be in the past' }]
        });
      }
    }
    data.target_date = parsedTargetDate;
  }
  if (input.icon !== undefined) data.icon = normalizeNullableString(input.icon);
  if (input.color !== undefined) data.color = normalizeNullableString(input.color);
  if (input.status !== undefined) data.status = normalizeGoalStatus(input.status);
  if (input.metadata !== undefined) data.metadata = normalizeMetadata(input.metadata);

  if (input.child_profile_id !== undefined) {
    data.child_profile_id = input.child_profile_id ? await assertChildProfile(profileId, input.child_profile_id) : null;
  }

  if (input.linked_account_id !== undefined || !options.partial) {
    data.linked_account_id = await assertLinkedAccount(profileId, input.linked_account_id);
  }

  return data;
}

async function assertChildProfile(profileId, childProfileId) {
  const childProfile = await prisma.childProfile.findFirst({
    where: { id: childProfileId, parent_profile_id: profileId, deleted_at: null, is_active: true }
  });

  if (!childProfile) {
    throw ApiError.badRequest('Child profile must belong to the active profile', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'child_profile_id', message: 'Invalid child profile' }]
    });
  }

  return childProfile.id;
}

async function assertLinkedAccount(profileId, linkedAccountId) {
  if (!linkedAccountId) {
    throw ApiError.badRequest('A linked asset account is required for every goal', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'linked_account_id', message: 'Required field is missing' }]
    });
  }

  const account = await prisma.userChartOfAccount.findFirst({
    where: { id: linkedAccountId, profile_id: profileId, deleted_at: null, is_active: true, class: 'asset' }
  });

  if (!account) {
    throw ApiError.badRequest('Linked account must be an active asset account in this profile', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'linked_account_id', message: 'Must reference an active asset account' }]
    });
  }

  return account.id;
}

async function syncGoalCompletionStatus(tx, goalId, profileId) {
  const goal = await tx.financialGoal.findFirst({
    where: { id: goalId, profile_id: profileId, deleted_at: null },
    include: goalInclude
  });

  if (!goal || goal.status === 'archived' || goal.status === 'paused') return goal;

  const progress = computeProgress(goal);
  const nextStatus = progress.is_completed ? 'completed' : 'active';
  if (goal.status === nextStatus) return goal;

  const updatedGoal = await tx.financialGoal.update({
    where: { id: goalId },
    data: { status: nextStatus },
    include: goalInclude
  });

  if (nextStatus === 'completed') {
    await createNotificationsForProfileMembers(profileId, {
      source: 'goals',
      source_id: goalId,
      event_type: 'goal.completed',
      delivery_key: `goal:completed:${goalId}`,
      title: 'Goal completed',
      body: `${goal.name} reached its target.`,
      action_url: '/Goals',
      priority: 'high',
      metadata: {
        goal_id: goalId,
        target_amount: decimalToNumber(goal.target_amount),
        saved_amount: progress.saved_amount,
        child_profile_id: goal.child_profile_id
      }
    }, { db: tx });

    if (goal.child_profile?.auth_user_id) {
      await createNotificationsForProfile([{
        profile_id: profileId,
        recipient_user_id: goal.child_profile.auth_user_id,
        source: 'goals',
        source_id: goalId,
        event_type: 'goal.completed',
        delivery_key: `goal:completed:${goalId}:child:${goal.child_profile.auth_user_id}`,
        title: 'Goal completed',
        body: `${goal.name} reached its target.`,
        action_url: '/Goals',
        priority: 'high',
        metadata: {
          goal_id: goalId,
          target_amount: decimalToNumber(goal.target_amount),
          saved_amount: progress.saved_amount,
          child_profile_id: goal.child_profile_id
        }
      }], { db: tx });
    }
  }

  return updatedGoal;
}

function pickGoalProgress(goal) {
  const progress = computeProgress(goal);
  return {
    saved_amount: progress.saved_amount,
    remaining_amount: progress.remaining_amount,
    progress_percent: progress.progress_percent,
    is_completed: progress.is_completed || goal.status === 'completed',
    status: goal.status
  };
}

async function createAuditLog(tx, {
  profileId,
  userId,
  entityType,
  entityId,
  action,
  beforeData,
  afterData,
  reason
}) {
  await tx.auditLog.create({
    data: {
      profile_id: profileId,
      user_id: userId || null,
      entity_type: entityType,
      entity_id: entityId,
      action,
      before_data: toAuditJson(beforeData),
      after_data: toAuditJson(afterData),
      reason
    }
  });
}

function toAuditJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeEnumValue(value) {
  return String(value || '').trim().toLowerCase();
}

module.exports = {
  listGoalsForProfile,
  getGoalSummaryForProfile,
  getGoalForProfile,
  createGoalForProfile,
  updateGoalForProfile,
  deleteGoalForProfile,
  listContributionsForGoal,
  createContributionForGoal,
  updateContributionForGoal,
  deleteContributionForGoal,
  pickPublicGoal
};
