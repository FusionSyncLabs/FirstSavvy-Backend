const { ok, created } = require("../utils/apiResponse");
const { asyncHandler } = require("../utils/asyncHandler");
const {
  listMealPlansForProfile,
  setMealPlanForProfile,
  removeMealPlanForProfile,
} = require("../services/meal.service");

const listMealPlans = asyncHandler(async (req, res) => {
  const profileId = req.headers["x-profile-id"] || req.query?.profileId || req.query?.profile_id;
  const mealPlans = await listMealPlansForProfile(req.auth?.sub, profileId, req.query);
  return ok(res, { mealPlans, meal_plans: mealPlans });
});

const setMealPlan = asyncHandler(async (req, res) => {
  const profileId = req.body?.profile_id || req.headers["x-profile-id"] || req.query?.profileId || req.query?.profile_id;
  const mealPlan = await setMealPlanForProfile(req.auth?.sub, profileId, req.body || {});
  return created(res, { mealPlan, meal_plan: mealPlan });
});

const removeMealPlan = asyncHandler(async (req, res) => {
  const profileId = req.body?.profile_id || req.headers["x-profile-id"] || req.query?.profileId || req.query?.profile_id;
  const payload = {
    ...(req.query || {}),
    ...(req.body || {}),
    ...(req.params?.mealId ? { id: req.params.mealId } : {}),
  };
  const result = await removeMealPlanForProfile(req.auth?.sub, profileId, payload);
  return ok(res, result);
});

module.exports = {
  listMealPlans,
  setMealPlan,
  removeMealPlan,
};
