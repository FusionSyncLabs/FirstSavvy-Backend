const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { validateRequest } = require('../../middleware/validateRequest');
const controller = require('../../controllers/notification.controller');

const router = express.Router();
const uuid = { required: true, type: 'string', uuid: true };
const priorities = ['low', 'normal', 'high', 'urgent'];

const listQuery = {
  page: { type: 'string' },
  limit: { type: 'string' },
  unread: { type: 'string', enum: ['true', 'false'] },
  read: { type: 'string', enum: ['true', 'false'] },
  source: { type: 'string', maxLength: 100 },
  eventType: { type: 'string', maxLength: 100 },
  event_type: { type: 'string', maxLength: 100 },
  priority: { type: 'string', enum: priorities },
  includeExpired: { type: 'string', enum: ['true', 'false'] },
  orderBy: { type: 'string', maxLength: 50 }
};

// Allow EventSource connections to pass token in query string (?token=...)
router.use((req, _res, next) => {
  if (!req.headers.authorization && req.query?.token && typeof req.query.token === 'string') {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});

router.use(authenticate);

router.get(
  '/stream',
  authorizeProfile(),
  controller.streamNotifications
);

router.get(
  '/summary',
  authorizeProfile(),
  controller.getNotificationSummary
);

router.get(
  '/',
  validateRequest({ query: listQuery }),
  authorizeProfile(),
  controller.listNotifications
);

router.patch(
  '/read-all',
  validateRequest({
    body: {
      source: { type: 'string', maxLength: 100 },
      eventType: { type: 'string', maxLength: 100 },
      event_type: { type: 'string', maxLength: 100 },
      priority: { type: 'string', enum: priorities },
      includeExpired: { type: 'string', enum: ['true', 'false'] }
    }
  }),
  authorizeProfile(),
  controller.markAllNotificationsRead
);

router.get(
  '/:notificationId',
  validateRequest({ params: { notificationId: uuid } }),
  authorizeProfile(),
  controller.getNotification
);

router.patch(
  '/:notificationId/read',
  validateRequest({ params: { notificationId: uuid } }),
  authorizeProfile(),
  controller.markNotificationRead
);

router.patch(
  '/:notificationId/unread',
  validateRequest({ params: { notificationId: uuid } }),
  authorizeProfile(),
  controller.markNotificationUnread
);

module.exports = router;
