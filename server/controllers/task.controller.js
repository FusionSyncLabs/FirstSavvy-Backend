const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listTasksForChild,
  listTasksForProfile,
  createTaskForProfile,
  updateTaskForUser,
  deleteTaskForUser,
  listCompletionsForChild,
  submitCompletionForUser,
  approveCompletionForUser,
  rejectCompletionForUser,
  getChildStarBalanceForUser,
  awardStarsDirectlyForUser
} = require('../services/task.service');

const listChildTasks = asyncHandler(async (req, res) => {
  return ok(res, {
    tasks: await listTasksForChild(req.auth.sub, req.params.childId)
  });
});

const listProfileTasks = asyncHandler(async (req, res) => {
  return ok(res, {
    tasks: await listTasksForProfile(req.auth.sub, req.params.profileId)
  });
});

const createTask = asyncHandler(async (req, res) => {
  return created(res, {
    task: await createTaskForProfile(req.auth.sub, req.params.profileId, req.body)
  });
});

const updateTask = asyncHandler(async (req, res) => {
  return ok(res, {
    task: await updateTaskForUser(req.auth.sub, req.params.taskId, req.body)
  });
});

const deleteTask = asyncHandler(async (req, res) => {
  return ok(res, await deleteTaskForUser(req.auth.sub, req.params.taskId));
});

const listChildCompletions = asyncHandler(async (req, res) => {
  return ok(res, {
    completions: await listCompletionsForChild(req.auth.sub, req.params.childId, {
      status: req.query.status
    })
  });
});

const submitCompletion = asyncHandler(async (req, res) => {
  return created(res, {
    completion: await submitCompletionForUser(req.auth.sub, req.params.taskId, req.body)
  });
});

const approveCompletion = asyncHandler(async (req, res) => {
  return ok(res, await approveCompletionForUser(req.auth.sub, req.params.completionId, req.body.reviewNotes));
});

const rejectCompletion = asyncHandler(async (req, res) => {
  return ok(res, await rejectCompletionForUser(req.auth.sub, req.params.completionId, req.body.reviewNotes));
});

const getChildStarBalance = asyncHandler(async (req, res) => {
  return ok(res, await getChildStarBalanceForUser(req.auth.sub, req.params.childId));
});

const awardStarsDirectly = asyncHandler(async (req, res) => {
  return ok(res, await awardStarsDirectlyForUser(req.auth.sub, req.params.childId, req.body));
});

module.exports = {
  listChildTasks,
  listProfileTasks,
  createTask,
  updateTask,
  deleteTask,
  listChildCompletions,
  submitCompletion,
  approveCompletion,
  rejectCompletion,
  getChildStarBalance,
  awardStarsDirectly
};
