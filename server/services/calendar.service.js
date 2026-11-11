const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');
const { pickPublicTransaction } = require('./transaction.service');
const { createNotificationsForProfile } = require('./notification.service');

const SCHEDULE_TYPES = new Set(['expense', 'income', 'transfer', 'reminder']);
const CADENCES = new Set(['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom']);
const OCCURRENCE_STATUSES = new Set(['upcoming', 'due', 'overdue', 'confirmed', 'matched', 'skipped', 'cancelled']);
const OPEN_OCCURRENCE_STATUSES = ['upcoming', 'due', 'overdue'];
const DEFAULT_FORECAST_MONTHS = 3;

const scheduleInclude = {
  bank_account: true,
  category_account: true,
  contact: true
};

const occurrenceInclude = {
  schedule: { include: scheduleInclude },
  linked_transaction: true,
  notifications: { orderBy: { created_at: 'desc' } }
};

function invalid(field, message) {
  throw ApiError.badRequest(message, {
    code: ERROR_CODES.VALIDATION_FAILED,
    details: [{ location: 'body', field, message }]
  });
}

function toDateKey(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function dateFromKey(key) {
  return new Date(`${key}T00:00:00.000Z`);
}

function addDays(key, days) {
  const date = dateFromKey(key);
  date.setUTCDate(date.getUTCDate() + days);
  return toDateKey(date);
}

function addMonths(key, months) {
  const date = dateFromKey(key);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return toDateKey(date);
}

function dateKeyInTimezone(date, timezone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    return toDateKey(date);
  }
}

function assertTimezone(timezone) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    invalid('timezone', 'timezone must be a valid IANA timezone');
  }
  return timezone;
}

function normalizeText(value, field, { required = false, maxLength = 5000 } = {}) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (required && !text) invalid(field, `${field} is required`);
  if (text.length > maxLength) invalid(field, `${field} must be at most ${maxLength} characters`);
  return text || null;
}

function normalizeMoney(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) invalid(field, `${field} is required`);
    return value === undefined ? undefined : null;
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) invalid(field, `${field} must be greater than zero`);
  return Math.round(amount * 100) / 100;
}

function normalizeDate(value, field, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) invalid(field, `${field} is required`);
    return value === undefined ? undefined : null;
  }
  const key = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value) : toDateKey(value);
  if (!key) invalid(field, `${field} must be a valid date`);
  return dateFromKey(key);
}

function normalizeEnum(value, field, allowed, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) invalid(field, `${field} is required`);
    return value === undefined ? undefined : null;
  }

  const normalized = String(value).trim().toLowerCase();
  if (!allowed.has(normalized)) {
    invalid(field, `${field} must be one of: ${[...allowed].join(', ')}`);
  }

  return normalized;
}

function normalizeOffsets(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 10) {
    invalid('reminder_offsets', 'reminder_offsets must contain between 1 and 10 day offsets');
  }
  const offsets = [...new Set(value.map((offset) => Number(offset)))].sort((a, b) => b - a);
  if (offsets.some((offset) => !Number.isInteger(offset) || offset < 0 || offset > 365)) {
    invalid('reminder_offsets', 'reminder_offsets must be whole numbers between 0 and 365');
  }
  return offsets;
}

function canonicalRule(cadence, customIntervalDays) {
  if (cadence === 'weekly') return 'FREQ=WEEKLY;INTERVAL=1';
  if (cadence === 'biweekly') return 'FREQ=WEEKLY;INTERVAL=2';
  if (cadence === 'monthly') return 'FREQ=MONTHLY;INTERVAL=1';
  if (cadence === 'quarterly') return 'FREQ=MONTHLY;INTERVAL=3';
  if (cadence === 'yearly') return 'FREQ=YEARLY;INTERVAL=1';
  return `FREQ=DAILY;INTERVAL=${customIntervalDays}`;
}

function nextOccurrenceDate(key, schedule) {
  switch (schedule.cadence) {
    case 'weekly': return addDays(key, 7);
    case 'biweekly': return addDays(key, 14);
    case 'monthly': return addMonths(key, 1);
    case 'quarterly': return addMonths(key, 3);
    case 'yearly': return addMonths(key, 12);
    case 'custom': return addDays(key, schedule.custom_interval_days);
    default: return null;
  }
}

function occurrenceStatusForDate(key, timezone) {
  const today = dateKeyInTimezone(new Date(), timezone);
  if (key < today) return 'overdue';
  if (key === today) return 'due';
  return 'upcoming';
}

async function ensureProfileReference(db, profileId, id, model, field) {
  if (!id) return null;
  const record = await db[model].findFirst({
    where: { id, profile_id: profileId, deleted_at: null }
  });
  if (!record || record.is_active === false) invalid(field, `${field} must reference an active record in this profile`);
  return id;
}

async function buildScheduleData(profileId, input = {}, { partial = false, db = prisma } = {}) {
  const data = {};

  const scheduleType = normalizeEnum(input.schedule_type ?? input.scheduleType, 'schedule_type', SCHEDULE_TYPES, { required: !partial });
  const cadence = normalizeEnum(input.cadence, 'cadence', CADENCES, { required: !partial });
  const startDate = normalizeDate(input.start_date ?? input.startDate, 'start_date', { required: !partial });
  const endDate = normalizeDate(input.end_date ?? input.endDate, 'end_date');
  const timezone = input.timezone === undefined ? undefined : assertTimezone(String(input.timezone));
  const customInterval = input.custom_interval_days ?? input.customIntervalDays;

  if (scheduleType !== undefined) data.schedule_type = scheduleType;
  if (cadence !== undefined) data.cadence = cadence;
  if (startDate !== undefined) data.start_date = startDate;
  if (endDate !== undefined) data.end_date = endDate;
  if (timezone !== undefined) data.timezone = timezone;

  if (input.title !== undefined) data.title = normalizeText(input.title, 'title', { required: !partial, maxLength: 255 });
  if (input.description !== undefined) data.description = normalizeText(input.description, 'description');

  if (input.expected_amount !== undefined || input.expectedAmount !== undefined) {
    data.expected_amount = normalizeMoney(input.expected_amount ?? input.expectedAmount, 'expected_amount');
  }

  if (input.reminder_offsets ?? input.reminderOffsets) {
    data.reminder_offsets = normalizeOffsets(input.reminder_offsets ?? input.reminderOffsets);
  }

  if (customInterval !== undefined) {
    const interval = Number(customInterval);
    if (!Number.isInteger(interval) || interval < 1 || interval > 366) invalid('custom_interval_days', 'custom_interval_days must be a whole number between 1 and 366');
    data.custom_interval_days = interval;
  }

  if (input.status !== undefined) {
    if (typeof input.status !== 'boolean') invalid('status', 'status must be a boolean');
    data.status = input.status;
  }

  if (input.metadata !== undefined) {
    if (!input.metadata || typeof input.metadata !== 'object' || Array.isArray(input.metadata)) invalid('metadata', 'metadata must be an object');
    data.metadata = input.metadata;
  }

  for (const [inputName, field, model] of [
    ['bank_account_id', 'bank_account_id', 'userChartOfAccount'],
    ['bankAccountId', 'bank_account_id', 'userChartOfAccount'],
    ['category_account_id', 'category_account_id', 'userChartOfAccount'],
    ['categoryAccountId', 'category_account_id', 'userChartOfAccount'],
    ['contact_id', 'contact_id', 'contact'],
    ['contactId', 'contact_id', 'contact']
  ]) {
    if (input[inputName] !== undefined) data[field] = await ensureProfileReference(db, profileId, input[inputName], model, field);
  }

  return data;
}

function validateCompleteSchedule(schedule) {
  if (!schedule.title) invalid('title', 'title is required');
  if (!SCHEDULE_TYPES.has(schedule.schedule_type)) invalid('schedule_type', 'schedule_type is invalid');
  if (!CADENCES.has(schedule.cadence)) invalid('cadence', 'cadence is invalid');
  if (!schedule.start_date) invalid('start_date', 'start_date is required');
  if (schedule.end_date && toDateKey(schedule.end_date) < toDateKey(schedule.start_date)) invalid('end_date', 'end_date must not be before start_date');
  if (schedule.cadence === 'custom' && (!Number.isInteger(schedule.custom_interval_days) || schedule.custom_interval_days < 1)) {
    invalid('custom_interval_days', 'custom_interval_days is required for custom cadence');
  }
  if (schedule.cadence !== 'custom') schedule.custom_interval_days = null;
  schedule.recurrence_rule = canonicalRule(schedule.cadence, schedule.custom_interval_days);
  if (!schedule.timezone) schedule.timezone = 'UTC';
  assertTimezone(schedule.timezone);
}

function pickAccount(account) {
  if (!account) return null;
  return { id: account.id, display_name: account.display_name, account_name: account.account_name, class: account.class };
}

function pickSchedule(schedule) {
  return {
    id: schedule.id,
    profile_id: schedule.profile_id,
    schedule_type: schedule.schedule_type,
    title: schedule.title,
    description: schedule.description,
    cadence: schedule.cadence,
    recurrence_rule: schedule.recurrence_rule,
    custom_interval_days: schedule.custom_interval_days,
    start_date: toDateKey(schedule.start_date),
    end_date: toDateKey(schedule.end_date),
    timezone: schedule.timezone,
    expected_amount: schedule.expected_amount === null ? null : Number(schedule.expected_amount),
    bank_account_id: schedule.bank_account_id,
    category_account_id: schedule.category_account_id,
    contact_id: schedule.contact_id,
    reminder_offsets: schedule.reminder_offsets,
    status: schedule.status,
    metadata: schedule.metadata || {},
    bank_account: pickAccount(schedule.bank_account),
    category_account: pickAccount(schedule.category_account),
    contact: schedule.contact ? { id: schedule.contact.id, name: schedule.contact.name } : null,
    created_at: schedule.created_at,
    updated_at: schedule.updated_at
  };
}

function pickOccurrence(occurrence) {
  return {
    id: occurrence.id,
    profile_id: occurrence.profile_id,
    schedule_id: occurrence.schedule_id,
    occurrence_date: toDateKey(occurrence.occurrence_date),
    expected_amount: occurrence.expected_amount === null ? null : Number(occurrence.expected_amount),
    status: occurrence.status,
    linked_transaction_id: occurrence.linked_transaction_id,
    completed_at: occurrence.completed_at,
    skipped_at: occurrence.skipped_at,
    cancelled_at: occurrence.cancelled_at,
    notes: occurrence.notes,
    metadata: occurrence.metadata || {},
    schedule: occurrence.schedule ? pickSchedule(occurrence.schedule) : undefined,
    linked_transaction: occurrence.linked_transaction ? {
      id: occurrence.linked_transaction.id,
      date: toDateKey(occurrence.linked_transaction.date),
      description: occurrence.linked_transaction.description,
      amount: Number(occurrence.linked_transaction.amount),
      status: occurrence.linked_transaction.status
    } : null,
    reminders: (occurrence.notifications || []).map(pickNotification),
    created_at: occurrence.created_at,
    updated_at: occurrence.updated_at
  };
}

function pickNotification(notification) {
  return {
    id: notification.id,
    profile_id: notification.profile_id,
    schedule_id: notification.schedule_id,
    occurrence_id: notification.occurrence_id,
    title: notification.title,
    body: notification.body,
    due_date: toDateKey(notification.due_date),
    reminder_offset_days: notification.reminder_offset_days,
    delivered_at: notification.delivered_at,
    acknowledged_at: notification.acknowledged_at,
    created_at: notification.created_at
  };
}

async function generateOccurrencesForSchedule(schedule, { db = prisma, forecastMonths = DEFAULT_FORECAST_MONTHS } = {}) {
  if (!schedule.status || schedule.deleted_at) return 0;
  const today = dateKeyInTimezone(new Date(), schedule.timezone);
  const horizon = addMonths(today, forecastMonths);
  const start = toDateKey(schedule.start_date);
  const end = schedule.end_date ? toDateKey(schedule.end_date) : horizon;
  const effectiveEnd = end < horizon ? end : horizon;
  const rows = [];
  let key = start;
  let iterations = 0;

  while (key <= effectiveEnd && iterations < 5000) {
    if (key >= today) {
      rows.push({
        profile_id: schedule.profile_id,
        schedule_id: schedule.id,
        occurrence_date: dateFromKey(key),
        expected_amount: schedule.expected_amount,
        status: occurrenceStatusForDate(key, schedule.timezone)
      });
    }
    key = nextOccurrenceDate(key, schedule);
    iterations += 1;
  }

  if (iterations >= 5000) invalid('start_date', 'recurrence produces too many occurrences; use a later start date or longer interval');
  if (!rows.length) return 0;

  const result = await db.recurringOccurrence.createMany({
    data: rows,
    skipDuplicates: true
  });

  return result.count;
}

async function createAuditLog(db, { profileId, userId, entityType, entityId, action, beforeData = null, afterData = null, reason = null }) {
  await db.auditLog.create({
    data: {
      profile_id: profileId,
      user_id: userId || null,
      entity_type: entityType,
      entity_id: entityId,
      action,
      before_data: beforeData,
      after_data: afterData,
      reason: reason || `Calendar action: ${action}`
    }
  });
}

async function findSchedule(profileId, scheduleId, db = prisma) {
  const schedule = await db.recurringSchedule.findFirst({
    where: {
      id: scheduleId,
      profile_id: profileId,
      deleted_at: null
    },
    include: scheduleInclude
  });

  if (!schedule) {
    throw ApiError.notFound('Recurring schedule not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return schedule;
}

async function findOccurrence(profileId, occurrenceId, db = prisma) {
  const occurrence = await db.recurringOccurrence.findFirst({
    where: {
      id: occurrenceId,
      profile_id: profileId,
      schedule: { deleted_at: null }
    },
    include: occurrenceInclude
  });

  if (!occurrence) {
    throw ApiError.notFound('Recurring occurrence not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return occurrence;
}

async function listSchedulesForProfile(profileId, query = {}) {
  const where = {
    profile_id: profileId,
    deleted_at: null
  };

  if (query.status !== undefined) {
    if (query.status !== 'true' && query.status !== 'false') invalid('status', 'status must be true or false');
    where.status = query.status === 'true';
  }

  const schedules = await prisma.recurringSchedule.findMany({
    where,
    include: scheduleInclude,
    orderBy: [
      { status: 'desc' },
      { title: 'asc' }
    ]
  });

  return {
    schedules: schedules.map(pickSchedule)
  };
}

async function createScheduleForProfile(profileId, input = {}, context = {}) {
  const data = await buildScheduleData(profileId, input);

  const complete = {
    ...data,
    timezone: data.timezone || 'UTC',
    reminder_offsets: data.reminder_offsets || [7, 3, 1, 0]
  };
  validateCompleteSchedule(complete);

  const schedule = await prisma.$transaction(async (tx) => {
    const created = await tx.recurringSchedule.create({
      data: {
        ...complete,
        profile_id: profileId,
        created_by_user_id: context.userId || null
      },
      include: scheduleInclude
    });

    await generateOccurrencesForSchedule(created, { db: tx });
    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'recurring_schedule',
      entityId: created.id,
      action: 'created',
      afterData: pickSchedule(created)
    });

    return created;
  });

  return pickSchedule(schedule);
}

async function updateScheduleForProfile(profileId, scheduleId, input = {}, context = {}) {
  const existing = await findSchedule(profileId, scheduleId);

  const data = await buildScheduleData(profileId, input, { partial: true });
  if (!Object.keys(data).length) {
    invalid('body', 'At least one schedule field must be supplied');
  }

  const recurrenceChanged = ['cadence', 'custom_interval_days', 'start_date', 'end_date', 'timezone', 'expected_amount']
    .some((key) => data[key] !== undefined);

  const complete = { ...existing, ...data };
  validateCompleteSchedule(complete);
  data.recurrence_rule = complete.recurrence_rule;
  if (data.cadence !== undefined || data.custom_interval_days !== undefined) {
    data.custom_interval_days = complete.custom_interval_days;
  }

  const schedule = await prisma.$transaction(async (tx) => {
    if (recurrenceChanged) {
      await tx.recurringOccurrence.deleteMany({
        where: {
          schedule_id: scheduleId,
          linked_transaction_id: null,
          occurrence_date: { gte: dateFromKey(dateKeyInTimezone(new Date(), existing.timezone)) },
          status: { in: OPEN_OCCURRENCE_STATUSES }
        }
      });
    }

    const updated = await tx.recurringSchedule.update({
      where: { id: scheduleId },
      data,
      include: scheduleInclude
    });

    if (updated.status) await generateOccurrencesForSchedule(updated, { db: tx });

    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'recurring_schedule',
      entityId: scheduleId,
      action: context.auditAction || 'updated',
      beforeData: pickSchedule(existing),
      afterData: pickSchedule(updated)
    });

    return updated;
  });

  return pickSchedule(schedule);
}

async function pauseScheduleForProfile(profileId, scheduleId, context = {}) {
  return updateScheduleForProfile(profileId, scheduleId, { status: false }, context);
}

async function resumeScheduleForProfile(profileId, scheduleId, context = {}) {
  return updateScheduleForProfile(profileId, scheduleId, { status: true }, context);
}

async function duplicateScheduleForProfile(profileId, scheduleId, input = {}, context = {}) {
  const schedule = await findSchedule(profileId, scheduleId);

  return createScheduleForProfile(profileId, {
    ...pickSchedule(schedule),
    title: input.title || `${schedule.title} (copy)`,
    start_date: input.start_date || dateKeyInTimezone(new Date(), schedule.timezone),
    end_date: input.end_date ?? null,
    status: true
  }, context);
}

async function deleteScheduleForProfile(profileId, scheduleId, context = {}) {
  const existing = await findSchedule(profileId, scheduleId);

  await prisma.$transaction(async (tx) => {
    await tx.recurringSchedule.update({
      where: { id: scheduleId },
      data: {
        deleted_at: new Date(),
        status: false
      }
    });

    await tx.recurringOccurrence.updateMany({
      where: {
        schedule_id: scheduleId,
        linked_transaction_id: null,
        status: { in: OPEN_OCCURRENCE_STATUSES }
      },
      data: {
        status: 'cancelled',
        cancelled_at: new Date()
      }
    });

    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'recurring_schedule',
      entityId: scheduleId,
      action: 'deleted',
      beforeData: pickSchedule(existing)
    });
  });

  return { deleted: true };
}

async function listOccurrencesForProfile(profileId, query = {}) {
  const from = normalizeDate(query.dateFrom || query.date_from, 'dateFrom') || dateFromKey(toDateKey(new Date()));
  const to = normalizeDate(query.dateTo || query.date_to, 'dateTo') || dateFromKey(addMonths(toDateKey(new Date()), DEFAULT_FORECAST_MONTHS));
  if (to < from) {
    invalid('dateTo', 'dateTo must not be before dateFrom');
  }

  const where = {
    profile_id: profileId,
    occurrence_date: { gte: from, lte: to },
    schedule: { deleted_at: null }
  };

  if (query.status) {
    where.status = normalizeEnum(query.status, 'status', OCCURRENCE_STATUSES);
  }

  if (query.scheduleType || query.schedule_type) {
    where.schedule = {
      ...where.schedule,
      schedule_type: normalizeEnum(query.scheduleType || query.schedule_type, 'scheduleType', SCHEDULE_TYPES)
    };
  }

  const occurrences = await prisma.recurringOccurrence.findMany({
    where,
    include: occurrenceInclude,
    orderBy: [
      { occurrence_date: 'asc' },
      { created_at: 'asc' }
    ]
  });
  const publicOccurrences = occurrences.map(pickOccurrence);

  const forecast = publicOccurrences.filter((item) => !['skipped', 'cancelled'].includes(item.status)).reduce((total, item) => {
    const amount = Number(item.expected_amount || 0);
    if (item.schedule?.schedule_type === 'income') total.income += amount;
    if (item.schedule?.schedule_type === 'expense') total.expenses += amount;
    if (item.schedule?.schedule_type === 'transfer') total.transfers += amount;

    return total;
  }, { income: 0, expenses: 0, transfers: 0 });

  return {
    occurrences: publicOccurrences,
    forecast: {
      ...forecast,
      net: Math.round((forecast.income - forecast.expenses) * 100) / 100
    }
  };
}

async function getOccurrenceForProfile(profileId, occurrenceId) {
  return pickOccurrence(await findOccurrence(profileId, occurrenceId));
}

async function updateOccurrenceStatusForProfile(profileId, occurrenceId, status, input = {}, context = {}) {
  if (!['skipped', 'cancelled'].includes(status)) {
    invalid('status', 'Only skipped and cancelled are supported by this action');
  }

  const existing = await findOccurrence(profileId, occurrenceId);

  if (!OPEN_OCCURRENCE_STATUSES.includes(existing.status)) {
    invalid('status', `Cannot ${status} an occurrence with status ${existing.status}`);
  }

  const occurrence = await prisma.$transaction(async (tx) => {
    const updated = await tx.recurringOccurrence.update({
      where: { id: occurrenceId },
      data: {
        status,
        notes: input.notes === undefined ? existing.notes : normalizeText(input.notes, 'notes'),
        [status === 'skipped' ? 'skipped_at' : 'cancelled_at']: new Date()
      },
      include: occurrenceInclude
    });

    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'recurring_occurrence',
      entityId: occurrenceId,
      action: status,
      beforeData: pickOccurrence(existing),
      afterData: pickOccurrence(updated)
    });

    return updated;
  });

  return pickOccurrence(occurrence);
}

async function confirmOccurrenceForProfile(profileId, occurrenceId, input = {}, context = {}) {
  const existing = await findOccurrence(profileId, occurrenceId);
  if (!OPEN_OCCURRENCE_STATUSES.includes(existing.status)) {
    invalid('status', `Cannot confirm an occurrence with status ${existing.status}`);
  }

  const transactionId = input.transaction_id || input.transactionId;

  const result = await prisma.$transaction(async (tx) => {
    const reservation = await tx.recurringOccurrence.updateMany({
      where: {
        id: occurrenceId,
        profile_id: profileId,
        linked_transaction_id: null,
        status: { in: OPEN_OCCURRENCE_STATUSES }
      },
      data: {
        status: transactionId ? 'matched' : 'confirmed',
        completed_at: new Date()
      }
    });

    if (reservation.count !== 1) {
      throw ApiError.badRequest('Occurrence was already completed', {
        code: ERROR_CODES.CONFLICT
      });
    }

    let linkedTransactionId = transactionId;
    if (transactionId) {
      const transaction = await tx.transaction.findFirst({
        where: {
          id: transactionId,
          profile_id: profileId,
          deleted_at: null
        }
      });
      if (!transaction) {
        throw ApiError.notFound('Transaction not found', {
          code: ERROR_CODES.TRANSACTION_NOT_FOUND
        });
      }

      const linkedElsewhere = await tx.recurringOccurrence.findFirst({
        where: {
          linked_transaction_id: transactionId,
          id: { not: occurrenceId }
        }
      });
      if (linkedElsewhere) {
        throw ApiError.badRequest('Transaction is already linked to another calendar occurrence', {
          code: ERROR_CODES.CONFLICT
        });
      }
    } else {
      const schedule = existing.schedule;
      if (schedule.schedule_type === 'reminder') {
        linkedTransactionId = null;
      } else if (!schedule.bank_account_id || !schedule.category_account_id || !existing.expected_amount) {
        invalid('schedule', 'A bank account, category account, and expected amount are required before creating a transaction');
      } else {
        const amount = schedule.schedule_type === 'income' ? Number(existing.expected_amount) : -Number(existing.expected_amount);
        const createdTransaction = await tx.transaction.create({
          data: {
            profile_id: profileId,
            bank_account_id: schedule.bank_account_id,
            category_account_id: schedule.category_account_id,
            contact_id: schedule.contact_id,
            date: existing.occurrence_date,
            description: schedule.title,
            amount,
            transaction_type: schedule.schedule_type,
            status: 'pending',
            memo: schedule.description,
            source: 'calendar',
            metadata: {
              calendar_schedule_id: schedule.id,
              calendar_occurrence_id: occurrenceId
            }
          }
        });
        linkedTransactionId = createdTransaction.id;

        await createAuditLog(tx, {
          profileId,
          userId: context.userId,
          entityType: 'transaction',
          entityId: createdTransaction.id,
          action: 'create_transaction',
          beforeData: null,
          afterData: pickPublicTransaction(createdTransaction),
          reason: `Transaction created from calendar ${existing.schedule.title} occurrence on ${toDateKey(existing.occurrence_date)}`
        });
      }
    }

    const occurrence = await tx.recurringOccurrence.update({
      where: { id: occurrenceId },
      data: {
        linked_transaction_id: linkedTransactionId,
        notes: input.notes === undefined ? existing.notes : normalizeText(input.notes, 'notes')
      },
      include: occurrenceInclude
    });

    await createAuditLog(tx, {
      profileId,
      userId: context.userId,
      entityType: 'recurring_occurrence',
      entityId: occurrenceId,
      action: transactionId ? 'matched_transaction' : 'confirmed_transaction',
      beforeData: pickOccurrence(existing),
      afterData: pickOccurrence(occurrence)
    });

    return occurrence;
  });

  return pickOccurrence(result);
}

async function listNotificationsForProfile(profileId, query = {}) {
  const where = { profile_id: profileId };
  if (query.unacknowledged === 'true') {
    where.acknowledged_at = null;
  }

  const notifications = await prisma.calendarNotification.findMany({
    where,
    include: {
      schedule: true,
      occurrence: true
    },
    orderBy: [
      { due_date: 'asc' },
      { created_at: 'desc' }
    ]
  });

  return {
    notifications: notifications.map(pickNotification)
  };
}

async function acknowledgeNotificationForProfile(profileId, notificationId, context = {}) {
  const notification = await prisma.calendarNotification.findFirst({
    where: {
      id: notificationId,
      profile_id: profileId
    }
  });

  if (!notification) {
    throw ApiError.notFound('Calendar notification not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.calendarNotification.update({
      where: { id: notificationId },
      data: {
        acknowledged_at: notification.acknowledged_at || new Date(),
        acknowledged_by_id: context.userId || null
      }
    });

    await tx.notification.updateMany({
      where: {
        profile_id: profileId,
        delivery_key: `calendar:${notification.delivery_key}`,
        read_at: null
      },
      data: {
        read_at: updated.acknowledged_at,
        read_by_id: context.userId || null
      }
    });
  });

  return pickNotification(updated);
}

async function runCalendarScheduler({ forecastMonths = DEFAULT_FORECAST_MONTHS } = {}) {
  const schedules = await prisma.recurringSchedule.findMany({
    where: {
      status: true,
      deleted_at: null
    },
    include: scheduleInclude
  });

  const result = await prisma.$transaction(async (tx) => {
    let generatedOccurrences = 0;
    for (const schedule of schedules) {
      generatedOccurrences += await generateOccurrencesForSchedule(schedule, {
        db: tx,
        forecastMonths
      });
    }

    for (const schedule of schedules) {
      const profileToday = dateKeyInTimezone(new Date(), schedule.timezone);

      await tx.recurringOccurrence.updateMany({
        where: {
          schedule_id: schedule.id,
          status: 'upcoming',
          occurrence_date: { lt: dateFromKey(profileToday) }
        },
        data: { status: 'overdue' }
      });

      await tx.recurringOccurrence.updateMany({
        where: {
          schedule_id: schedule.id,
          status: 'upcoming',
          occurrence_date: dateFromKey(profileToday)
        },
        data: { status: 'due' }
      });
    }

    const today = toDateKey(new Date());
    const pendingOccurrences = await tx.recurringOccurrence.findMany({
      where: {
        status: { in: OPEN_OCCURRENCE_STATUSES },
        occurrence_date: {
          gte: dateFromKey(addDays(today, -365)),
          lte: dateFromKey(addDays(today, 365))
        },
        schedule: {
          status: true,
          deleted_at: null
        }
      },
      include: { schedule: true }
    });

    const notificationRows = [];
    const inboxRows = [];
    for (const occurrence of pendingOccurrences) {
      const dueDate = toDateKey(occurrence.occurrence_date);
      const profileToday = dateKeyInTimezone(new Date(), occurrence.schedule.timezone);
      for (const offset of occurrence.schedule.reminder_offsets || []) {
        if (profileToday >= addDays(dueDate, -offset)) {
          const deliveryKey = `${occurrence.id}:${offset}`;
          const body = offset === 0 ? `Due today: ${occurrence.schedule.title}` : `Due in ${offset} day${offset === 1 ? '' : 's'}: ${occurrence.schedule.title}`;
          notificationRows.push({
            profile_id: occurrence.profile_id,
            schedule_id: occurrence.schedule_id,
            occurrence_id: occurrence.id,
            delivery_key: deliveryKey,
            title: occurrence.schedule.title,
            body,
            due_date: occurrence.occurrence_date,
            reminder_offset_days: offset
          });
          inboxRows.push({
            profile_id: occurrence.profile_id,
            source: 'calendar',
            source_id: occurrence.id,
            event_type: 'calendar.reminder_due',
            delivery_key: `calendar:${deliveryKey}`,
            title: occurrence.schedule.title,
            body,
            action_url: `/calendar/occurrences/${occurrence.id}`,
            priority: offset === 0 ? 'high' : 'normal',
            metadata: {
              schedule_id: occurrence.schedule_id,
              occurrence_id: occurrence.id,
              due_date: dueDate,
              reminder_offset_days: offset,
              schedule_type: occurrence.schedule.schedule_type
            }
          });
        }
      }
    }

    if (notificationRows.length) {
      await tx.calendarNotification.createMany({
        data: notificationRows,
        skipDuplicates: true
      });
    }

    if (inboxRows.length) {
      await createNotificationsForProfile(inboxRows, { db: tx });
    }

    return {
      generatedOccurrences,
      reminderAttempts: notificationRows.length
    };
  });

  return {
    schedules_processed: schedules.length,
    occurrences_generated: result.generatedOccurrences,
    reminder_attempts: result.reminderAttempts
  };
}

module.exports = {
  listSchedulesForProfile,
  createScheduleForProfile,
  updateScheduleForProfile,
  pauseScheduleForProfile,
  resumeScheduleForProfile,
  duplicateScheduleForProfile,
  deleteScheduleForProfile,
  listOccurrencesForProfile,
  getOccurrenceForProfile,
  updateOccurrenceStatusForProfile,
  confirmOccurrenceForProfile,
  listNotificationsForProfile,
  acknowledgeNotificationForProfile,
  runCalendarScheduler
};
