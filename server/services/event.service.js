const { prisma } = require("../config/database");
const { ApiError } = require("../middleware/errorHandler");
const { ERROR_CODES, HTTP_STATUS } = require("../constants/errorCodes");

async function resolveProfileId(userId, explicitProfileId) {
  if (explicitProfileId) return explicitProfileId;

  if (userId) {
    const membership = await prisma.profileMembership.findFirst({
      where: { user_id: userId },
    });
    if (membership?.profile_id) return membership.profile_id;

    const profile = await prisma.profile.findFirst({
      where: { owner_user_id: userId, is_active: true },
    });
    if (profile?.id) return profile.id;
  }

  const anyProfile = await prisma.profile.findFirst({
    where: { is_active: true },
  });
  return anyProfile?.id || null;
}

async function listEventsForProfile(userId, profileId) {
  const targetProfileId = await resolveProfileId(userId, profileId);

  const where = {};
  if (targetProfileId) {
    where.profile_id = targetProfileId;
  }

  const events = await prisma.event.findMany({
    where,
    orderBy: [{ start_date: "asc" }, { created_at: "desc" }],
  });

  return events.map(pickPublicEvent);
}

async function createEventForProfile(userId, profileId, input = {}) {
  const title = input.name || input.title;
  if (!title?.trim()) {
    throw ApiError.badRequest("Event name is required", {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [
        {
          location: "body",
          field: "name",
          message: "Required field is missing",
        },
      ],
    });
  }

  const targetProfileId = await resolveProfileId(userId, input.profile_id || profileId);

  if (!targetProfileId) {
    throw ApiError.badRequest("Profile ID is required", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const startDate = input.start_date ? new Date(input.start_date) : new Date();
  const endDate = input.end_date ? new Date(input.end_date) : startDate;

  let forArray = [];
  if (Array.isArray(input.for)) {
    forArray = input.for;
  } else if (typeof input.for === "string") {
    forArray = input.for.split(",").map((s) => s.trim()).filter(Boolean);
  }

  const created = await prisma.event.create({
    data: {
      profile_id: targetProfileId,
      name: title.trim(),
      destination: normalizeNullableString(input.destination),
      start_date: startDate,
      end_date: endDate,
      for: forArray,
      is_trip: input.is_trip ? 1 : 0,
      star_earning: input.star_earning ? 1 : 0,
      color_code: normalizeNullableString(input.color_code || input.color),
      notes: normalizeNullableString(input.notes || input.description),
    },
  });

  return pickPublicEvent(created);
}

async function updateEventForProfile(userId, eventId, input = {}) {
  const existing = await prisma.event.findUnique({
    where: { id: eventId },
  });

  if (!existing) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, "Event not found", {
      code: ERROR_CODES.NOT_FOUND,
    });
  }

  const title = input.name || input.title;
  const updateData = {};

  if (title !== undefined) updateData.name = title.trim();
  if (input.destination !== undefined) updateData.destination = normalizeNullableString(input.destination);
  if (input.start_date !== undefined) updateData.start_date = new Date(input.start_date);
  if (input.end_date !== undefined) updateData.end_date = new Date(input.end_date);
  if (input.for !== undefined) {
    updateData.for = Array.isArray(input.for)
      ? input.for
      : typeof input.for === "string"
      ? input.for.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  }
  if (input.is_trip !== undefined) updateData.is_trip = input.is_trip ? 1 : 0;
  if (input.star_earning !== undefined) updateData.star_earning = input.star_earning ? 1 : 0;
  if (input.color_code !== undefined || input.color !== undefined) {
    updateData.color_code = normalizeNullableString(input.color_code || input.color);
  }
  if (input.notes !== undefined || input.description !== undefined) {
    updateData.notes = normalizeNullableString(input.notes || input.description);
  }

  const updated = await prisma.event.update({
    where: { id: eventId },
    data: updateData,
  });

  return pickPublicEvent(updated);
}

async function deleteEventForProfile(userId, eventId) {
  try {
    const existing = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (existing) {
      await prisma.event.delete({
        where: { id: eventId },
      });
    }
  } catch (err) {
    console.warn(`Event ${eventId} not found in DB or local ID, treating as deleted:`, err.message);
  }

  return { success: true, deletedId: eventId };
}

function pickPublicEvent(event) {
  if (!event) return null;

  return {
    id: event.id,
    profile_id: event.profile_id,
    name: event.name,
    title: event.name,
    destination: event.destination,
    start_date: event.start_date,
    end_date: event.end_date,
    for: event.for,
    is_trip: event.is_trip,
    star_earning: event.star_earning,
    color_code: event.color_code,
    notes: event.notes,
    created_at: event.created_at,
  };
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

module.exports = {
  listEventsForProfile,
  createEventForProfile,
  updateEventForProfile,
  deleteEventForProfile,
};
