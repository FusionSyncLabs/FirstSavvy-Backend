const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listNotificationsForProfile,
  getNotificationSummaryForProfile,
  getNotificationForProfile,
  markNotificationReadForProfile,
  markNotificationUnreadForProfile,
  markAllNotificationsReadForProfile,
  countUnreadNotificationsForProfile,
  registerNotificationStreamClient
} = require('../services/notification.service');

const streamNotifications = asyncHandler(async (req, res) => {
  const profileId = req.profileAccess.profileId;
  const userId = req.auth?.sub;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  // Send initial connected frame
  res.write(`event: connected\ndata: ${JSON.stringify({ profileId, timestamp: Date.now() })}\n\n`);

  const unregister = registerNotificationStreamClient(profileId, userId, res);

  // Heartbeat every 25s to keep reverse proxies / load balancers from closing idle stream
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
      unregister();
    }
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unregister();
  });
});

const getNotificationSummary = asyncHandler(async (req, res) => {
  return ok(res, await getNotificationSummaryForProfile(
    req.profileAccess.profileId,
    { userId: req.auth?.sub }
  ));
});

const listNotifications = asyncHandler(async (req, res) => {
  return ok(res, await listNotificationsForProfile(
    req.profileAccess.profileId,
    req.query,
    { userId: req.auth?.sub }
  ));
});

const getNotification = asyncHandler(async (req, res) => {
  return ok(res, {
    notification: await getNotificationForProfile(
      req.profileAccess.profileId,
      req.params.notificationId,
      { userId: req.auth?.sub }
    )
  });
});

const markNotificationRead = asyncHandler(async (req, res) => {
  const profileId = req.profileAccess.profileId;
  const context = { userId: req.auth?.sub };
  const notification = await markNotificationReadForProfile(
    profileId,
    req.params.notificationId,
    context
  );
  const unreadCount = await countUnreadNotificationsForProfile(profileId, context);

  return ok(res, {
    notification,
    unread_count: unreadCount
  });
});

const markNotificationUnread = asyncHandler(async (req, res) => {
  const profileId = req.profileAccess.profileId;
  const context = { userId: req.auth?.sub };
  const notification = await markNotificationUnreadForProfile(
    profileId,
    req.params.notificationId,
    context
  );
  const unreadCount = await countUnreadNotificationsForProfile(profileId, context);

  return ok(res, {
    notification,
    unread_count: unreadCount
  });
});

const markAllNotificationsRead = asyncHandler(async (req, res) => {
  return ok(res, await markAllNotificationsReadForProfile(
    req.profileAccess.profileId,
    req.body,
    { userId: req.auth?.sub }
  ));
});

module.exports = {
  streamNotifications,
  listNotifications,
  getNotificationSummary,
  getNotification,
  markNotificationRead,
  markNotificationUnread,
  markAllNotificationsRead
};
