const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { validateRequest } = require('../../middleware/validateRequest');
const {
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
} = require('../../controllers/task.controller');

const router = express.Router();

router.use(authenticate);

router.get(
  '/children/:childId/tasks',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    }
  }),
  listChildTasks
);

router.get(
  '/children/:childId/completions',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    },
    query: {
      status: { type: 'string', enum: ['pending', 'approved', 'rejected'] }
    }
  }),
  listChildCompletions
);

router.get(
  '/children/:childId/star-balance',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    }
  }),
  getChildStarBalance
);

router.post(
  '/children/:childId/award-stars',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    },
    body: {
      stars: { required: true, type: 'number' },
      note: { type: 'string', maxLength: 1000 },
      taskId: { type: 'string', uuid: true }
    }
  }),
  awardStarsDirectly
);

router.get(
  '/profiles/:profileId/tasks',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    }
  }),
  listProfileTasks
);

router.post(
  '/profiles/:profileId/tasks',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    },
    body: {
      assigned_to_child_id: { type: 'string', uuid: true },
      assignee_ids: { type: 'array' },
      title: { required: true, type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 10000 },
      points_value: { type: 'number' },
      star_reward: { type: 'number' },
      due_date: { type: 'string' },
      requires_approval: { type: 'boolean' },
      icon: { type: 'string', maxLength: 100 },
      color: { type: 'string', maxLength: 32 },
      metadata: { type: 'object' }
    }
  }),
  createTask
);

router.post(
  '/:taskId/completions',
  validateRequest({
    params: {
      taskId: { required: true, type: 'string', uuid: true }
    },
    body: {
      submissionNotes: { type: 'string', maxLength: 1000 },
      child_profile_id: { type: 'string', uuid: true },
      childProfileId: { type: 'string', uuid: true }
    }
  }),
  submitCompletion
);

router.patch(
  '/:taskId',
  validateRequest({
    params: {
      taskId: { required: true, type: 'string', uuid: true }
    },
    body: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 10000 },
      points_value: { type: 'number' },
      star_reward: { type: 'number' },
      status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'approved', 'rejected', 'active', 'archived'] },
      due_date: { type: 'string' },
      requires_approval: { type: 'boolean' },
      icon: { type: 'string', maxLength: 100 },
      color: { type: 'string', maxLength: 32 },
      metadata: { type: 'object' },
      assignee_ids: { type: 'array' },
      assigned_to_child_id: { type: 'string', uuid: true }
    }
  }),
  updateTask
);

router.delete(
  '/:taskId',
  validateRequest({
    params: {
      taskId: { required: true, type: 'string', uuid: true }
    }
  }),
  deleteTask
);

router.post(
  '/completions/:completionId/approve',
  validateRequest({
    params: {
      completionId: { required: true, type: 'string', uuid: true }
    },
    body: {
      reviewNotes: { type: 'string', maxLength: 1000 }
    }
  }),
  approveCompletion
);

router.post(
  '/completions/:completionId/reject',
  validateRequest({
    params: {
      completionId: { required: true, type: 'string', uuid: true }
    },
    body: {
      reviewNotes: { type: 'string', maxLength: 1000 }
    }
  }),
  rejectCompletion
);

module.exports = router;
