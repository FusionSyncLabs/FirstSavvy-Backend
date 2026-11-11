const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listSchedulesForProfile,
  createScheduleForProfile,
  updateScheduleForProfile,
  deleteScheduleForProfile,
  pauseScheduleForProfile,
  resumeScheduleForProfile,
  duplicateScheduleForProfile,
  listOccurrencesForProfile,
  getOccurrenceForProfile,
  confirmOccurrenceForProfile,
  updateOccurrenceStatusForProfile,
  listNotificationsForProfile,
  acknowledgeNotificationForProfile
} = require('../services/calendar.service');


const listSchedules = asyncHandler(async (req, res) => {
  return ok(res, await listSchedulesForProfile(req.profileAccess.profileId, req.query))
});

const createSchedule = asyncHandler(async (req, res) => {
  return created(res, {
    schedule: await createScheduleForProfile(
      req.profileAccess.profileId,
      req.body,
      { userId: req.auth.sub }
    )
  })
});

const updateSchedule = asyncHandler(async (req, res) => {
  return ok(res, {
    schedule: await updateScheduleForProfile(
      req.profileAccess.profileId,
      req.params.scheduleId,
      req.body,
      { userId: req.auth.sub }
    )
  })
});

const deleteSchedule = asyncHandler(async (req, res) => {
  return ok(res, await deleteScheduleForProfile(
    req.profileAccess.profileId,
    req.params.scheduleId,
    { userId: req.auth.sub }
  ))
});

const pauseSchedule = asyncHandler(async (req, res) => {
  return ok(res, {
    schedule: await pauseScheduleForProfile(
      req.profileAccess.profileId,
      req.params.scheduleId,
      { userId: req.auth.sub, auditAction: 'paused' }
    )
  })
});

const resumeSchedule = asyncHandler(async (req, res) => {
  return ok(res, {
    schedule: await resumeScheduleForProfile(
      req.profileAccess.profileId,
      req.params.scheduleId,
      { userId: req.auth.sub, auditAction: 'resumed' }
    )
  })
});

const duplicateSchedule = asyncHandler(async (req, res) => {
  return created(res, {
    schedule: await duplicateScheduleForProfile(
      req.profileAccess.profileId,
      req.params.scheduleId,
      req.body,
      { userId: req.auth.sub }
    )
  })
});

const listOccurrences = asyncHandler(async (req, res) => {
  return ok(res, await listOccurrencesForProfile(req.profileAccess.profileId, req.query))
});

const getOccurrence = asyncHandler(async (req, res) => {
  return ok(res, {
    occurrence: await getOccurrenceForProfile(req.profileAccess.profileId, req.params.occurrenceId)
  })
});

const confirmOccurrence = asyncHandler(async (req, res) => {
  return ok(res, {
    occurrence: await confirmOccurrenceForProfile(
      req.profileAccess.profileId,
      req.params.occurrenceId,
      req.body,
      { userId: req.auth.sub }
    )
  })
});

const skipOccurrence = asyncHandler(async (req, res) => {
  return ok(res, {
    occurrence: await updateOccurrenceStatusForProfile(
      req.profileAccess.profileId,
      req.params.occurrenceId,
      'skipped',
      req.body, { userId: req.auth.sub }
    )
  })
});

const cancelOccurrence = asyncHandler(async (req, res) => {
  return ok(res, {
    occurrence: await updateOccurrenceStatusForProfile(
      req.profileAccess.profileId,
      req.params.occurrenceId,
      'cancelled',
      req.body,
      { userId: req.auth.sub }
    )
  })
});

const listNotifications = asyncHandler(async (req, res) => {
  return ok(res, await listNotificationsForProfile(req.profileAccess.profileId, req.query))
});

const acknowledgeNotification = asyncHandler(async (req, res) => {
  return ok(res, {
    notification: await acknowledgeNotificationForProfile(
      req.profileAccess.profileId,
      req.params.notificationId,
      { userId: req.auth.sub }
    )
  })
});


module.exports = {
  listSchedules,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  pauseSchedule,
  resumeSchedule,
  duplicateSchedule,
  listOccurrences,
  getOccurrence,
  confirmOccurrence,
  skipOccurrence,
  cancelOccurrence,
  listNotifications,
  acknowledgeNotification
};