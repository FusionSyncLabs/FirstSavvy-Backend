const { ok, created } = require("../utils/apiResponse");
const { asyncHandler } = require("../utils/asyncHandler");
const {
  listRecipesForProfile,
  createRecipeForProfile,
  updateRecipeForProfile,
  deleteRecipeForProfile,
} = require("../services/recipe.service");

const listRecipes = asyncHandler(async (req, res) => {
  const profileId = req.headers["x-profile-id"] || req.query?.profileId || req.query?.profile_id;
  const recipes = await listRecipesForProfile(req.auth?.sub, profileId);
  return ok(res, { recipes });
});

const createRecipe = asyncHandler(async (req, res) => {
  const profileId = req.body?.profile_id || req.headers["x-profile-id"] || req.query?.profileId || req.query?.profile_id;
  const recipe = await createRecipeForProfile(req.auth?.sub, profileId, req.body || {});
  return created(res, { recipe });
});

const updateRecipe = asyncHandler(async (req, res) => {
  const recipe = await updateRecipeForProfile(req.auth?.sub, req.params.recipeId, req.body || {});
  return ok(res, { recipe });
});

const deleteRecipe = asyncHandler(async (req, res) => {
  const result = await deleteRecipeForProfile(req.auth?.sub, req.params.recipeId);
  return ok(res, result);
});

module.exports = {
  listRecipes,
  createRecipe,
  updateRecipe,
  deleteRecipe,
};
