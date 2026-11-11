const { prisma } = require("../config/database");
const { ApiError } = require("../middleware/errorHandler");
const { ERROR_CODES } = require("../constants/errorCodes");

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

function pickPublicRecipe(recipe) {
  if (!recipe) return null;
  return {
    id: recipe.id,
    profile_id: recipe.profile_id,
    name: recipe.name,
    type: recipe.type,
    prepTime: recipe.prep_time,
    prep_time: recipe.prep_time,
    description: recipe.description,
    tags: recipe.tags || [],
    ingredients: recipe.ingredients || [],
    instructions: recipe.instructions,
    metadata: recipe.metadata || {},
    created_at: recipe.created_at,
    updated_at: recipe.updated_at,
  };
}

async function listRecipesForProfile(userId, profileId) {
  const targetProfileId = await resolveProfileId(userId, profileId);

  const where = { deleted_at: null };
  if (targetProfileId) {
    where.profile_id = targetProfileId;
  }

  const recipes = await prisma.recipe.findMany({
    where,
    orderBy: [{ name: "asc" }, { created_at: "desc" }],
  });

  return recipes.map(pickPublicRecipe);
}

async function createRecipeForProfile(userId, profileId, input = {}) {
  const name = input.name || input.title;
  if (!name?.trim()) {
    throw ApiError.badRequest("Recipe name is required", {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ field: "name", message: "Required field is missing" }],
    });
  }

  const targetProfileId = await resolveProfileId(userId, input.profile_id || profileId);
  if (!targetProfileId) {
    throw ApiError.badRequest("Profile ID is required", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const created = await prisma.recipe.create({
    data: {
      profile_id: targetProfileId,
      name: name.trim(),
      type: input.type || "Entree",
      prep_time: input.prepTime ? parseInt(input.prepTime, 10) : input.prep_time ? parseInt(input.prep_time, 10) : 30,
      description: input.description || null,
      tags: Array.isArray(input.tags) ? input.tags : [],
      ingredients: Array.isArray(input.ingredients) ? input.ingredients : [],
      instructions: input.instructions || null,
      metadata: input.metadata || {},
    },
  });

  try {
    const { createNotificationsForProfile } = require("./notification.service");
    await createNotificationsForProfile([{
      profile_id: targetProfileId,
      source: "calendar",
      event_type: "recipe_created",
      title: `Recipe Added: ${name.trim()}`,
      body: `${name.trim()} was added to the household recipe library.`,
      action_url: `/Calendar`,
      priority: "normal",
      metadata: {
        recipe_id: created.id,
        name: name.trim(),
        type: created.type
      }
    }]);
  } catch (err) {
    console.warn("Failed to emit recipe notification:", err);
  }

  return pickPublicRecipe(created);
}

async function updateRecipeForProfile(userId, recipeId, input = {}) {
  const existing = await prisma.recipe.findUnique({
    where: { id: recipeId },
  });

  if (!existing || existing.deleted_at) {
    throw ApiError.notFound("Recipe not found", {
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
    });
  }

  const data = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.type !== undefined) data.type = input.type;
  if (input.prepTime !== undefined || input.prep_time !== undefined) {
    const pt = input.prepTime !== undefined ? input.prepTime : input.prep_time;
    data.prep_time = pt ? parseInt(pt, 10) : null;
  }
  if (input.description !== undefined) data.description = input.description;
  if (input.tags !== undefined) data.tags = Array.isArray(input.tags) ? input.tags : [];
  if (input.ingredients !== undefined) data.ingredients = Array.isArray(input.ingredients) ? input.ingredients : [];
  if (input.instructions !== undefined) data.instructions = input.instructions;
  if (input.metadata !== undefined) data.metadata = input.metadata;

  const updated = await prisma.recipe.update({
    where: { id: recipeId },
    data,
  });

  return pickPublicRecipe(updated);
}

async function deleteRecipeForProfile(userId, recipeId) {
  const existing = await prisma.recipe.findUnique({
    where: { id: recipeId },
  });

  if (!existing) {
    throw ApiError.notFound("Recipe not found", {
      code: ERROR_CODES.RESOURCE_NOT_FOUND,
    });
  }

  await prisma.recipe.delete({
    where: { id: recipeId },
  });

  return { success: true, id: recipeId };
}

module.exports = {
  listRecipesForProfile,
  createRecipeForProfile,
  updateRecipeForProfile,
  deleteRecipeForProfile,
};
