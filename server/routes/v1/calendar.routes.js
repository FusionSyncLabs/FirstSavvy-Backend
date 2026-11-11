const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { validateRequest } = require('../../middleware/validateRequest');
const controller = require('../../controllers/calendar.controller');

const router = express.Router();
const uuid = { required: true, type: 'string', uuid: true };
const optionalUuid = { type: 'string', uuid: true };

const scheduleBody = {
  schedule_type: { type: 'string', enum: ['expense', 'income', 'transfer', 'reminder'] },
  cadence: { type: 'string', enum: ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'] },
  title: { type: 'string', maxLength: 255 },
  description: { type: 'string', maxLength: 5000 },
  start_date: { type: 'string' },
  end_date: { type: 'string' },
  timezone: { type: 'string', maxLength: 100 },
  expected_amount: { type: 'number' },
  custom_interval_days: { type: 'number' },
  reminder_offsets: { type: 'array' },
  bank_account_id: optionalUuid,
  category_account_id: optionalUuid,
  contact_id: optionalUuid,
  status: { type: 'boolean' },
  metadata: { type: 'object' }
};

router.use(authenticate);

router.get(
  '/schedules',
  authorizeProfile(),
  controller.listSchedules
);

router.post(
  '/schedules',
  validateRequest({
    body: {
      ...scheduleBody,
      schedule_type: { required: true, type: 'string', enum: ['expense', 'income', 'transfer', 'reminder'] },
      cadence: { required: true, type: 'string', enum: ['weekly', 'biweekly', 'monthly', 'quarterly', 'yearly', 'custom'] },
      title: { required: true, type: 'string', maxLength: 255 },
      start_date: { required: true, type: 'string' }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  controller.createSchedule
);

router.patch(
  '/schedules/:scheduleId',
  validateRequest({
    params: { scheduleId: uuid },
    body: scheduleBody
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  controller.updateSchedule
);

router.delete(
  '/schedules/:scheduleId',
  validateRequest({ params: { scheduleId: uuid } }),
  authorizeProfile({ requiredRole: 'editor' }),
  controller.deleteSchedule
);

router.patch(
  '/schedules/:scheduleId/pause',
  validateRequest({ params: { scheduleId: uuid } }),
  authorizeProfile({ requiredRole: 'editor' }),
  controller.pauseSchedule
);

router.patch(
  '/schedules/:scheduleId/resume',
  validateRequest({ params: { scheduleId: uuid } }),
  authorizeProfile({ requiredRole: 'editor' }),
  controller.resumeSchedule
);

router.post(
  '/schedules/:scheduleId/duplicate',
  validateRequest({
    params: { scheduleId: uuid },
    body: {
      title: { type: 'string', maxLength: 255 },
      start_date: { type: 'string' },
      end_date: { type: 'string' }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  controller.duplicateSchedule
);

router.get(
  '/occurrences',
  authorizeProfile(),
  controller.listOccurrences
);

router.get(
  '/occurrences/:occurrenceId',
  validateRequest({ params: { occurrenceId: uuid } }),
  authorizeProfile(),
  controller.getOccurrence
);

router.patch(
  '/occurrences/:occurrenceId/confirm',
  validateRequest({
    params: { occurrenceId: uuid },
    body: {
      transaction_id: optionalUuid,
      notes: { type: 'string', maxLength: 5000 }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  controller.confirmOccurrence
);

router.patch(
  '/occurrences/:occurrenceId/skip',
  validateRequest({
    params: { occurrenceId: uuid },
    body: {
      notes: { type: 'string', maxLength: 5000 }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  controller.skipOccurrence
);

router.patch(
  '/occurrences/:occurrenceId/cancel',
  validateRequest({
    params: { occurrenceId: uuid },
    body: {
      notes: { type: 'string', maxLength: 5000 }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  controller.cancelOccurrence
);

router.get(
  '/notifications',
  authorizeProfile(),
  controller.listNotifications
);

router.patch(
  '/notifications/:notificationId/acknowledge',
  validateRequest({ params: { notificationId: uuid } }),
  authorizeProfile(),
  controller.acknowledgeNotification
);

module.exports = router;
