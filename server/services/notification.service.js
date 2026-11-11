const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');
const { parsePaginationQuery, buildPaginationMeta } = require('../utils/pagination');

const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const SORT_FIELDS = new Set(['created_at', 'priority', 'source']);

// In-memory SSE stream clients per profileId -> Set<{ res, userId }>
const streamClientsByProfile = new Map();

function registerNotificationStreamClient(profileId, userId, res) {
  if (!profileId || !res) return () => {};
  let clients = streamClientsByProfile.get(profileId);
  if (!clients) {
    clients = new Set();
    streamClientsByProfile.set(profileId, clients);
  }
  const client = { res, userId };
  clients.add(client);

  return () => {
    const current = streamClientsByProfile.get(profileId);
    if (!current) return;
    current.delete(client);
    if (current.size === 0) {
      streamClientsByProfile.delete(profileId);
    }
  };
}

function broadcastNotificationEvent(profileId, payload = { type: 'refresh' }) {
  if (!profileId) return;
  const clients = streamClientsByProfile.get(profileId);
  if (!clients || clients.size === 0) return;

  const serialized = `event: notification\ndata: ${JSON.stringify({
    ...payload,
    profileId,
    timestamp: Date.now()
  })}\n\n`;

  for (const client of clients) {
    try {
      client.res.write(serialized);
    } catch {
      clients.delete(client);
    }
  }
}

function invalid(field, message, location = 'body') {
  throw ApiError.badRequest(message, {
    code: ERROR_CODES.VALIDATION_FAILED,
    details: [{ location, field, message }]
  });
}

function normalizeText(value, field, { required = false, maxLength = 5000 } = {}) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  if (required && !text) invalid(field, `${field} is required`);
  if (text.length > maxLength) invalid(field, `${field} must be at most ${maxLength} characters`);
  return text || null;
}

function normalizePriority(value) {
  if (value === undefined || value === null || value === '') return 'normal';
  const priority = String(value).trim().toLowerCase();
  if (!PRIORITIES.has(priority)) invalid('priority', `priority must be one of: ${[...PRIORITIES].join(', ')}`);
  return priority;
}

function normalizeMetadata(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('metadata', 'metadata must be an object');
  return value;
}

function normalizeDate(value, field) {
  if (value === undefined || value === null || value === '') return value === undefined ? undefined : null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) invalid(field, `${field} must be a valid date`);
  return date;
}

function pickNotification(notification) {
  return {
    id: notification.id,
    profile_id: notification.profile_id,
    recipient_user_id: notification.recipient_user_id,
    source: notification.source,
    source_id: notification.source_id,
    event_type: notification.event_type,
    delivery_key: notification.delivery_key,
    title: notification.title,
    body: notification.body,
    action_url: notification.action_url,
    priority: notification.priority,
    metadata: notification.metadata || {},
    read_at: notification.read_at,
    read_by_id: notification.read_by_id,
    is_read: Boolean(notification.read_at),
    expires_at: notification.expires_at,
    created_at: notification.created_at,
    updated_at: notification.updated_at
  };
}

function buildRecipientScope(userId) {
  return {
    OR: [
      { recipient_user_id: null },
      { recipient_user_id: userId }
    ]
  };
}

function buildNotificationWhere(profileId, query = {}, userId = null) {
  const now = new Date();
  const where = {
    profile_id: profileId,
    AND: []
  };

  if (userId) where.AND.push(buildRecipientScope(userId));
  if (query.unread === 'true') where.read_at = null;
  if (query.read === 'true') where.read_at = { not: null };
  if (query.source) where.source = String(query.source).trim();
  if (query.eventType || query.event_type) where.event_type = String(query.eventType || query.event_type).trim();
  if (query.priority) where.priority = normalizePriority(query.priority);
  if (query.includeExpired !== 'true') {
    where.AND.push({
      OR: [
        { expires_at: null },
        { expires_at: { gt: now } }
      ]
    });
  }

  if (!where.AND.length) delete where.AND;

  return where;
}

function buildNotificationOrder(orderBy = '-created_at') {
  const direction = orderBy.startsWith('-') ? 'desc' : 'asc';
  const field = orderBy.replace(/^-/, '');
  if (!SORT_FIELDS.has(field)) return [{ created_at: 'desc' }];
  return [{ [field]: direction }, { created_at: 'desc' }];
}

async function listNotificationsForProfile(profileId, query = {}, context = {}) {
  const pagination = parsePaginationQuery(query, { defaultLimit: 25, maxLimit: 100 });
  const where = buildNotificationWhere(profileId, query, context.userId);

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: buildNotificationOrder(query.orderBy || '-created_at'),
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.notification.count({ where }),
    countUnreadNotificationsForProfile(profileId, context)
  ]);

  return {
    notifications: notifications.map(pickNotification),
    unread_count: unreadCount,
    pagination: buildPaginationMeta({ page: pagination.page, limit: pagination.limit, total })
  };
}

async function getNotificationSummaryForProfile(profileId, context = {}) {
  const [unreadCount, highPriorityUnreadCount] = await Promise.all([
    countUnreadNotificationsForProfile(profileId, context),
    prisma.notification.count({
      where: {
        profile_id: profileId,
        read_at: null,
        priority: { in: ['high', 'urgent'] },
        AND: [
          ...(context.userId ? [buildRecipientScope(context.userId)] : []),
          {
            OR: [
              { expires_at: null },
              { expires_at: { gt: new Date() } }
            ]
          }
        ]
      }
    })
  ]);

  return {
    summary: {
      unread_count: unreadCount,
      high_priority_unread_count: highPriorityUnreadCount
    }
  };
}

async function countUnreadNotificationsForProfile(profileId, context = {}) {
  return prisma.notification.count({
    where: {
      profile_id: profileId,
      read_at: null,
      AND: [
        ...(context.userId ? [buildRecipientScope(context.userId)] : []),
        {
          OR: [
            { expires_at: null },
            { expires_at: { gt: new Date() } }
          ]
        }
      ]
    }
  });
}

async function getNotificationForProfile(profileId, notificationId, context = {}) {
  const notification = await findNotification(profileId, notificationId, context.userId);
  return pickNotification(notification);
}

const MANDATORY_NOTIFICATION_EVENTS = new Set([
  'calendar.reminder_due',
  'collaboration.invitation_accepted',
  'task.completion_submitted'
]);

async function recipientAllowsNotification(row) {
  const eventType = String(row.event_type || row.eventType || '');
  if (MANDATORY_NOTIFICATION_EVENTS.has(eventType)) return true;
  if (eventType === 'transactions.import_completed' && (row.metadata?.error || row.metadata?.failed)) return true;

  const userId = row.recipient_user_id;
  if (!userId) return true;

  const settingsRow = await prisma.userSetting.findUnique({
    where: { user_id: userId }
  });
  const notifications = settingsRow?.settings?.notifications && typeof settingsRow.settings.notifications === 'object'
    ? settingsRow.settings.notifications
    : {};

  if (eventType === 'task.created') return notifications.taskActivity !== false;
  if (['task.updated', 'task.deleted', 'child.stars_awarded'].includes(eventType)) return notifications.taskUpdates === true;
  if (['reward.created', 'reward.updated', 'reward.deleted'].includes(eventType)) return notifications.rewardActivity === true;
  if (['recipe_created', 'meal_planned'].includes(eventType)) return notifications.householdChatter === true;
  if (eventType === 'transfer_match.suggested' || eventType === 'transactions.import_completed') {
    return notifications.transactionAlerts !== false;
  }
  return true;
}

async function createNotificationsForProfile(rows = [], options = {}) {
  if (!rows.length) return { count: 0 };
  const db = options.db || options.tx || prisma;
  const allowed = [];
  for (const row of rows) {
    if (await recipientAllowsNotification(row)) allowed.push(row);
  }
  if (!allowed.length) return { count: 0 };
  const data = allowed.map((row) => buildNotificationData(row.profile_id, row));
  const result = await db.notification.createMany({
    data,
    skipDuplicates: true
  });

  if (result.count > 0) {
    const profileIds = new Set(data.map((item) => item.profile_id).filter(Boolean));
    // Defer broadcast slightly if running inside a transaction so listeners query committed rows
    setTimeout(() => {
      profileIds.forEach((pid) => broadcastNotificationEvent(pid, { type: 'created' }));
    }, 50);
  }

  return { count: result.count };
}

async function createNotificationsForProfileMembers(profileId, input = {}, options = {}) {
  const db = options.db || options.tx || prisma;
  const roles = options.roles || ['owner', 'admin', 'editor'];
  const excludedUserIds = new Set((options.excludeUserIds || []).filter(Boolean));

  const memberships = await db.profileMembership.findMany({
    where: {
      profile_id: profileId,
      role: { in: roles },
      user: { deleted_at: null }
    },
    select: { user_id: true }
  });

  const rows = memberships
    .filter((membership) => !excludedUserIds.has(membership.user_id))
    .map((membership) => ({
      ...input,
      profile_id: profileId,
      recipient_user_id: membership.user_id,
      delivery_key: input.delivery_key ? `${input.delivery_key}:user:${membership.user_id}` : undefined
    }));

  return createNotificationsForProfile(rows, { db });
}

async function createNotificationForUser(userId, input = {}, options = {}) {
  if (!userId) return null;

  const db = options.db || options.tx || prisma;
  const profileId = await resolveNotificationProfileForUser(userId, {
    db,
    fallbackProfileId: options.fallbackProfileId
  });

  if (!profileId) return null;

  const result = await createNotificationsForProfile([{
    ...input,
    profile_id: profileId,
    recipient_user_id: userId
  }], { db });

  return result.count > 0 ? result : null;
}

async function markNotificationReadForProfile(profileId, notificationId, context = {}) {
  const existing = await findNotification(profileId, notificationId, context.userId);
  const now = new Date();

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: {
      read_at: now,
      read_by_id: context.userId || null
    }
  });

  // Also mark any duplicate unread notifications for the same event/title in this profile as read
  // so deduplicated UI views do not show the item as unread again on refresh.
  const duplicateConditions = [];
  if (existing.source && existing.event_type && existing.source_id) {
    duplicateConditions.push({
      source: existing.source,
      event_type: existing.event_type,
      source_id: existing.source_id
    });
  }
  if (existing.source && existing.event_type && existing.title) {
    duplicateConditions.push({
      source: existing.source,
      event_type: existing.event_type,
      title: existing.title,
      body: existing.body
    });
  }

  if (duplicateConditions.length > 0) {
    await prisma.notification.updateMany({
      where: {
        profile_id: profileId,
        read_at: null,
        OR: duplicateConditions,
        ...(context.userId ? { AND: [buildRecipientScope(context.userId)] } : {})
      },
      data: {
        read_at: now,
        read_by_id: context.userId || null
      }
    });
  }

  broadcastNotificationEvent(profileId, { type: 'read', notificationId });

  return pickNotification(updated);
}

async function markNotificationUnreadForProfile(profileId, notificationId, context = {}) {
  await findNotification(profileId, notificationId, context.userId);
  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: {
      read_at: null,
      read_by_id: null
    }
  });

  broadcastNotificationEvent(profileId, { type: 'unread', notificationId });

  return pickNotification(updated);
}

async function markAllNotificationsReadForProfile(profileId, input = {}, context = {}) {
  const where = buildNotificationWhere(profileId, {
    ...input,
    includeExpired: 'true',
    unread: 'true'
  }, context.userId);

  const result = await prisma.notification.updateMany({
    where,
    data: {
      read_at: new Date(),
      read_by_id: context.userId || null
    }
  });

  broadcastNotificationEvent(profileId, { type: 'read-all' });

  return {
    updated_count: result.count,
    unread_count: await countUnreadNotificationsForProfile(profileId, context)
  };
}

async function findNotification(profileId, notificationId, userId = null) {
  const notification = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      profile_id: profileId,
      ...(userId ? { AND: [buildRecipientScope(userId)] } : {})
    }
  });

  if (!notification) {
    throw ApiError.notFound('Notification not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return notification;
}

async function resolveNotificationProfileForUser(userId, { db = prisma, fallbackProfileId = null } = {}) {
  if (fallbackProfileId) {
    const fallbackMembership = await db.profileMembership.findFirst({
      where: {
        user_id: userId,
        profile_id: fallbackProfileId,
        profile: {
          deleted_at: null,
          is_active: true
        }
      },
      select: { profile_id: true }
    });

    if (fallbackMembership) return fallbackMembership.profile_id;
  }

  const userSetting = await db.userSetting.findUnique({
    where: { user_id: userId }
  });
  const activeProfileId = userSetting?.settings?.activeProfileId;

  if (activeProfileId) {
    const activeMembership = await db.profileMembership.findFirst({
      where: {
        user_id: userId,
        profile_id: activeProfileId,
        profile: {
          deleted_at: null,
          is_active: true
        }
      },
      select: { profile_id: true }
    });

    if (activeMembership) return activeMembership.profile_id;
  }

  const defaultProfile = await db.profile.findFirst({
    where: {
      owner_user_id: userId,
      deleted_at: null,
      is_active: true,
      is_default: true
    },
    select: { id: true }
  });

  if (defaultProfile) return defaultProfile.id;

  const membership = await db.profileMembership.findFirst({
    where: {
      user_id: userId,
      profile: {
        deleted_at: null,
        is_active: true
      }
    },
    orderBy: { created_at: 'asc' },
    select: { profile_id: true }
  });

  return membership?.profile_id || null;
}

function buildNotificationData(profileId, input = {}) {
  if (!profileId) invalid('profile_id', 'profile_id is required');

  const source = normalizeText(input.source, 'source', { required: true, maxLength: 100 });
  const eventType = normalizeText(input.event_type || input.eventType, 'event_type', { required: true, maxLength: 100 });
  const title = normalizeText(input.title, 'title', { required: true, maxLength: 255 });

  return {
    profile_id: profileId,
    recipient_user_id: input.recipient_user_id || input.recipientUserId || null,
    source,
    source_id: normalizeText(input.source_id || input.sourceId, 'source_id', { maxLength: 255 }),
    event_type: eventType,
    delivery_key: normalizeText(input.delivery_key || input.deliveryKey, 'delivery_key', { maxLength: 255 }),
    title,
    body: normalizeText(input.body, 'body'),
    action_url: normalizeText(input.action_url || input.actionUrl, 'action_url'),
    priority: normalizePriority(input.priority),
    metadata: normalizeMetadata(input.metadata),
    expires_at: normalizeDate(input.expires_at || input.expiresAt, 'expires_at')
  };
}

module.exports = {
  listNotificationsForProfile,
  getNotificationSummaryForProfile,
  getNotificationForProfile,
  createNotificationsForProfile,
  createNotificationsForProfileMembers,
  createNotificationForUser,
  markNotificationReadForProfile,
  markNotificationUnreadForProfile,
  markAllNotificationsReadForProfile,
  countUnreadNotificationsForProfile,
  pickNotification,
  registerNotificationStreamClient,
  broadcastNotificationEvent
};
