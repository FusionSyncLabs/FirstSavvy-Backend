const { ok, created } = require("../utils/apiResponse");
const { asyncHandler } = require("../utils/asyncHandler");
const {
  createEventForProfile,
  listEventsForProfile,
  updateEventForProfile,
  deleteEventForProfile,
} = require("../services/event.service");

const listEvents = asyncHandler(async (req, res) => {
  const profileId = req.headers["x-profile-id"] || req.query.profileId;
  const events = await listEventsForProfile(req.auth.sub, profileId);
  return ok(res, {
    events,
  });
});

const createEvent = asyncHandler(async (req, res) => {
  const profileId = req.body.profile_id || req.headers["x-profile-id"] || req.params.profileId;
  const event = await createEventForProfile(
    req.auth.sub,
    profileId,
    req.body
  );
  return created(res, {
    event,
  });
});

const updateEvent = asyncHandler(async (req, res) => {
  const event = await updateEventForProfile(
    req.auth.sub,
    req.params.eventId,
    req.body
  );
  return ok(res, {
    event,
  });
});

const deleteEvent = asyncHandler(async (req, res) => {
  const result = await deleteEventForProfile(
    req.auth.sub,
    req.params.eventId
  );
  return ok(res, result);
});

module.exports = {
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
};
