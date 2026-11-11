const { prisma } = require("../config/database");
const { ApiError } = require("../middleware/errorHandler");
const { ERROR_CODES } = require("../constants/errorCodes");
const { createNotificationsForProfile } = require("./notification.service");

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isValidUuid(id) {
  return typeof id === "string" && UUID_REGEX.test(id.trim());
}

async function resolveProfileId(userId, explicitProfileId) {
  if (isValidUuid(explicitProfileId)) return explicitProfileId.trim();

  if (isValidUuid(userId)) {
    const membership = await prisma.profileMembership.findFirst({
      where: { user_id: userId.trim() },
    });
    if (membership?.profile_id) return membership.profile_id;

    const profile = await prisma.profile.findFirst({
      where: { owner_user_id: userId.trim(), is_active: true },
    });
    if (profile?.id) return profile.id;
  }

  const anyProfile = await prisma.profile.findFirst({
    where: { is_active: true },
  });
  return anyProfile?.id || null;
}

function parseDateOnlyToUtc(d) {
  if (!d) return null;
  if (typeof d === "string") {
    const match = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      return new Date(Date.UTC(year, month, day, 12, 0, 0));
    }
  }
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate(), 12, 0, 0));
}

function formatDateToIsoString(d) {
  if (!d) return null;
  if (typeof d === "string") {
    const match = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  const dt = new Date(d);
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function pickPublicMealPlan(mp) {
  if (!mp) return null;
  return {
    id: mp.id,
    profile_id: mp.profile_id,
    date: formatDateToIsoString(mp.date),
    meal_type: mp.meal_type,
    course: mp.course,
    dish_name: mp.dish_name,
    recipe_id: mp.recipe_id,
    notes: mp.notes,
    metadata: mp.metadata || {},
    recipe: mp.recipe
      ? {
          id: mp.recipe.id,
          name: mp.recipe.name,
          type: mp.recipe.type,
          prepTime: mp.recipe.prep_time,
        }
      : null,
    created_at: mp.created_at,
    updated_at: mp.updated_at,
  };
}

async function listMealPlansForProfile(userId, profileId, query = {}) {
  try {
    const targetProfileId = await resolveProfileId(userId, profileId);

    const where = { deleted_at: null };
    if (targetProfileId) {
      where.profile_id = targetProfileId;
    }

    if (query.startDate || query.endDate) {
      where.date = {};
      if (query.startDate) where.date.gte = parseDateOnlyToUtc(query.startDate);
      if (query.endDate) where.date.lte = parseDateOnlyToUtc(query.endDate);
    }

    const mealPlans = await prisma.mealPlan.findMany({
      where,
      include: {
        recipe: true,
      },
      orderBy: [{ date: "asc" }, { meal_type: "asc" }],
    });

    return mealPlans.map(pickPublicMealPlan);
  } catch (error) {
    if (error.code === "P2021" || error.message?.includes("does not exist")) {
      console.warn("meal_plans table does not exist in the database yet. Returning empty list.");
      return [];
    }
    throw error;
  }
}

async function setMealPlanForProfile(userId, profileId, input = {}) {
  const dateStr = input.date;
  const mealType = input.meal_type || input.mealType;
  const dishName = input.dish_name || input.dishName || input.name;

  if (!dateStr) {
    throw ApiError.badRequest("Date is required", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }
  if (!mealType) {
    throw ApiError.badRequest("Meal type (Breakfast/Lunch/Dinner/Snack) is required", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }
  if (!dishName?.trim()) {
    throw ApiError.badRequest("Dish name is required", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const targetProfileId = await resolveProfileId(userId, input.profile_id || profileId);
  if (!targetProfileId) {
    throw ApiError.badRequest("Profile ID is required", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const parsedDate = parseDateOnlyToUtc(dateStr);
  const course = (input.course || "entree").toLowerCase();

  // Find existing meal plan for this date and meal_type
  const existing = await prisma.mealPlan.findFirst({
    where: {
      profile_id: targetProfileId,
      date: parsedDate,
      meal_type: mealType,
      deleted_at: null,
    },
  });

  let result;
  if (existing) {
    result = await prisma.mealPlan.update({
      where: { id: existing.id },
      data: {
        dish_name: dishName.trim(),
        course: course,
        recipe_id: input.recipe_id || input.recipeId || null,
        notes: input.notes !== undefined ? input.notes : existing.notes,
        metadata: input.metadata !== undefined ? input.metadata : existing.metadata,
      },
      include: { recipe: true },
    });
  } else {
    result = await prisma.mealPlan.create({
      data: {
        profile_id: targetProfileId,
        date: parsedDate,
        meal_type: mealType,
        course: course,
        dish_name: dishName.trim(),
        recipe_id: input.recipe_id || input.recipeId || null,
        notes: input.notes || null,
        metadata: input.metadata || {},
      },
      include: { recipe: true },
    });
  }
 
  const deliveryKey = `meal_plan:${targetProfileId}:${dateStr}:${mealType.toLowerCase()}`;
  try {
    const existingNotif = await prisma.notification.findFirst({
      where: { delivery_key: deliveryKey }
    });

    if (existingNotif) {
      await prisma.notification.update({
        where: { id: existingNotif.id },
        data: {
          title: `Meal Planned: ${dishName.trim()}`,
          body: `${dishName.trim()} was planned for ${mealType} on ${dateStr}.`,
          metadata: {
            date: dateStr,
            meal_type: mealType,
            dish_name: dishName.trim(),
            course: course,
            recipe_id: input.recipe_id || input.recipeId || null
          },
          updated_at: new Date()
        }
      });
    } else {
      await createNotificationsForProfile([{
        profile_id: targetProfileId,
        source: "calendar",
        event_type: "meal_planned",
        delivery_key: deliveryKey,
        title: `Meal Planned: ${dishName.trim()}`,
        body: `${dishName.trim()} was planned for ${mealType} on ${dateStr}.`,
        action_url: `/Calendar?date=${dateStr}`,
        priority: "normal",
        metadata: {
          date: dateStr,
          meal_type: mealType,
          dish_name: dishName.trim(),
          course: course,
          recipe_id: input.recipe_id || input.recipeId || null
        }
      }]);
    }
  } catch (err) {
    console.warn("Failed to create/update meal planned notification:", err);
  }

  return pickPublicMealPlan(result);
}

async function removeMealPlanForProfile(userId, profileId, input = {}) {
  const targetProfileId = await resolveProfileId(userId, input.profile_id || profileId);

  // If specific meal plan ID provided
  if (input.id || input.mealPlanId) {
    const mealId = input.id || input.mealPlanId;
    await prisma.mealPlan.deleteMany({
      where: {
        id: mealId,
        ...(targetProfileId ? { profile_id: targetProfileId } : {}),
      },
    });
    return { success: true, id: mealId };
  }

  // If date and meal_type provided
  if (input.date && (input.meal_type || input.mealType)) {
    const parsedDate = parseDateOnlyToUtc(input.date);
    const mealType = input.meal_type || input.mealType;
    const where = {
      profile_id: targetProfileId,
      date: parsedDate,
      meal_type: mealType,
    };
    if (input.course) {
      where.course = input.course.toLowerCase();
    }

    await prisma.mealPlan.deleteMany({ where });
    return { success: true, date: input.date, meal_type: mealType };
  }

  throw ApiError.badRequest("Must specify meal plan ID or date and meal_type to remove", {
    code: ERROR_CODES.VALIDATION_FAILED,
  });
}

module.exports = {
  listMealPlansForProfile,
  setMealPlanForProfile,
  removeMealPlanForProfile,
};
