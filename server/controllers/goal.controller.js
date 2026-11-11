const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listGoalsForProfile,
  getGoalSummaryForProfile,
  getGoalForProfile,
  createGoalForProfile,
  updateGoalForProfile,
  deleteGoalForProfile,
  listContributionsForGoal,
  createContributionForGoal,
  updateContributionForGoal,
  deleteContributionForGoal
} = require('../services/goal.service');

const listGoals = asyncHandler(async (req, res) => {
  return ok(res, await listGoalsForProfile(req.profileAccess.profileId, req.query));
});

const getGoalSummary = asyncHandler(async (req, res) => {
  return ok(res, await getGoalSummaryForProfile(req.profileAccess.profileId));
});

const getGoal = asyncHandler(async (req, res) => {
  return ok(res, {
    goal: await getGoalForProfile(req.profileAccess.profileId, req.params.goalId, {
      includeContributions: req.query.includeContributions === 'true'
    })
  });
});

const createGoal = asyncHandler(async (req, res) => {
  return created(res, {
    goal: await createGoalForProfile(req.profileAccess.profileId, req.body, {
      userId: req.auth?.sub
    })
  });
});

const updateGoal = asyncHandler(async (req, res) => {
  return ok(res, {
    goal: await updateGoalForProfile(req.profileAccess.profileId, req.params.goalId, req.body, {
      userId: req.auth?.sub
    })
  });
});

const deleteGoal = asyncHandler(async (req, res) => {
  return ok(res, await deleteGoalForProfile(req.profileAccess.profileId, req.params.goalId, {
    userId: req.auth?.sub
  }));
});


// Contributions handlers
const listContributions = asyncHandler(async (req, res) => {
  return ok(res, await listContributionsForGoal(
    req.profileAccess.profileId,
    req.params.goalId,
    req.query
  ));
});

const createContribution = asyncHandler(async (req, res) => {
  return created(res, await createContributionForGoal(
    req.profileAccess.profileId,
    req.params.goalId,
    req.body,
    { userId: req.auth?.sub }
  ));
});

const updateContribution = asyncHandler(async (req, res) => {
  return ok(res, await updateContributionForGoal(
      req.profileAccess.profileId,
      req.params.goalId,
      req.params.contributionId,
      req.body,
      { userId: req.auth?.sub }
  ));
});

const deleteContribution = asyncHandler(async (req, res) => {
  return ok(res, await deleteContributionForGoal(
    req.profileAccess.profileId,
    req.params.goalId,
    req.params.contributionId,
    { userId: req.auth?.sub }
  ));
});

module.exports = {
  listGoals,
  getGoalSummary,
  getGoal,
  createGoal,
  updateGoal,
  deleteGoal,
  listContributions,
  createContribution,
  updateContribution,
  deleteContribution
};
