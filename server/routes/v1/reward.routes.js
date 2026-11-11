const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { validateRequest } = require('../../middleware/validateRequest');
const { normalizeMultipartFields, fileUpload } = require('../../middleware/upload');
const {
  listChildRewards,
  createReward,
  updateReward,
  deleteReward,
  redeemReward,
  listChildRedemptions,
  approveRedemption,
  rejectRedemption,
  fulfillRedemption,
  updateRedemptionNotes,
  listChildActivity
} = require('../../controllers/reward.controller');

const router = express.Router();
const rewardMultipartForm = [
  fileUpload('image', {
    maxBytes: 5 * 1024 * 1024,
    requireImage: true,
    tooLargeMessage: 'Uploaded image is too large'
  }),
  normalizeMultipartFields({
    numericFields: [
      'star_cost',
      'points_cost',
      'cash_cost',
      'requires_approval_threshold',
      'stock_quantity',
      'age_restriction'
    ],
    booleanFields: ['remove_image'],
    jsonFields: ['metadata']
  })
];

router.use(authenticate);

router.get(
  '/children/:childId/rewards',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    }
  }),
  listChildRewards
);

router.get(
  '/children/:childId/redemptions',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    },
    query: {
      status: { type: 'string', enum: ['available', 'pending', 'approved', 'rejected', 'fulfilled', 'cancelled', 'redeemed'] }
    }
  }),
  listChildRedemptions
);

router.get(
  '/children/:childId/activity',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    }
  }),
  listChildActivity
);

router.post(
  '/profiles/:profileId/rewards',
  rewardMultipartForm,
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    },
    body: {
      assigned_to_child_id: { required: true, type: 'string', uuid: true },
      title: { required: true, type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 10000 },
      star_cost: { required: true, type: 'number' },
      points_cost: { type: 'number' },
      cash_cost: { type: 'number' },
      category: { type: 'string', maxLength: 100 },
      icon: { type: 'string', maxLength: 100 },
      color: { type: 'string', maxLength: 32 },
      image_url: { type: 'string', maxLength: 2000 },
      requires_approval_threshold: { type: 'number' },
      stock_quantity: { type: 'number' },
      expires_at: { type: 'string' },
      age_restriction: { type: 'number' },
      status: { type: 'string', enum: ['available', 'pending', 'approved', 'rejected', 'fulfilled', 'cancelled', 'redeemed'] },
      metadata: { type: 'object' }
    }
  }),
  createReward
);

router.post(
  '/children/:childId/rewards/:rewardId/redeem',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true },
      rewardId: { required: true, type: 'string', uuid: true }
    }
  }),
  redeemReward
);

router.patch(
  '/:rewardId',
  rewardMultipartForm,
  validateRequest({
    params: {
      rewardId: { required: true, type: 'string', uuid: true }
    },
    body: {
      title: { type: 'string', minLength: 1, maxLength: 255 },
      description: { type: 'string', maxLength: 10000 },
      star_cost: { type: 'number' },
      points_cost: { type: 'number' },
      cash_cost: { type: 'number' },
      category: { type: 'string', maxLength: 100 },
      icon: { type: 'string', maxLength: 100 },
      color: { type: 'string', maxLength: 32 },
      image_url: { type: 'string', maxLength: 2000 },
      remove_image: { type: 'boolean' },
      requires_approval_threshold: { type: 'number' },
      stock_quantity: { type: 'number' },
      expires_at: { type: 'string' },
      age_restriction: { type: 'number' },
      status: { type: 'string', enum: ['available', 'pending', 'approved', 'rejected', 'fulfilled', 'cancelled', 'redeemed'] },
      metadata: { type: 'object' }
    }
  }),
  updateReward
);

router.delete(
  '/:rewardId',
  validateRequest({
    params: {
      rewardId: { required: true, type: 'string', uuid: true }
    }
  }),
  deleteReward
);

router.post(
  '/redemptions/:redemptionId/approve',
  validateRequest({
    params: {
      redemptionId: { required: true, type: 'string', uuid: true }
    }
  }),
  approveRedemption
);

router.post(
  '/redemptions/:redemptionId/reject',
  validateRequest({
    params: {
      redemptionId: { required: true, type: 'string', uuid: true }
    },
    body: {
      reason: { type: 'string', maxLength: 1000 }
    }
  }),
  rejectRedemption
);

router.post(
  '/redemptions/:redemptionId/fulfill',
  validateRequest({
    params: {
      redemptionId: { required: true, type: 'string', uuid: true }
    },
    body: {
      notes: { type: 'string', maxLength: 1000 }
    }
  }),
  fulfillRedemption
);

router.patch(
  '/redemptions/:redemptionId/notes',
  validateRequest({
    params: {
      redemptionId: { required: true, type: 'string', uuid: true }
    },
    body: {
      notes: { type: 'string', maxLength: 1000 }
    }
  }),
  updateRedemptionNotes
);

module.exports = router;
