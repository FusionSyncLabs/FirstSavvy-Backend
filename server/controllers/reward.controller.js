const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listRewardsForChild,
  createRewardForProfile,
  updateRewardForUser,
  deleteRewardForUser,
  redeemRewardForChild,
  listRedemptionsForChild,
  approveRedemptionForUser,
  rejectRedemptionForUser,
  fulfillRedemptionForUser,
  updateRedemptionNotesForUser,
  listActivityForChild
} = require('../services/reward.service');

function getPublicFilesBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}/api/v1/files/public`;
}

const listChildRewards = asyncHandler(async (req, res) => {
  return ok(res, {
    rewards: await listRewardsForChild(req.auth.sub, req.params.childId)
  });
});

const createReward = asyncHandler(async (req, res) => {
  return created(res, {
    reward: await createRewardForProfile(req.auth.sub, req.params.profileId, req.body, {
      imageFile: req.file,
      publicFilesBaseUrl: getPublicFilesBaseUrl(req)
    })
  });
});

const updateReward = asyncHandler(async (req, res) => {
  return ok(res, {
    reward: await updateRewardForUser(req.auth.sub, req.params.rewardId, req.body, {
      imageFile: req.file,
      publicFilesBaseUrl: getPublicFilesBaseUrl(req)
    })
  });
});

const deleteReward = asyncHandler(async (req, res) => {
  return ok(res, await deleteRewardForUser(req.auth.sub, req.params.rewardId));
});

const redeemReward = asyncHandler(async (req, res) => {
  return ok(res, await redeemRewardForChild(req.auth.sub, req.params.childId, req.params.rewardId, req.body));
});

const listChildRedemptions = asyncHandler(async (req, res) => {
  return ok(res, {
    redemptions: await listRedemptionsForChild(req.auth.sub, req.params.childId, {
      status: req.query.status
    })
  });
});

const approveRedemption = asyncHandler(async (req, res) => {
  return ok(res, {
    redemption: await approveRedemptionForUser(req.auth.sub, req.params.redemptionId)
  });
});

const rejectRedemption = asyncHandler(async (req, res) => {
  return ok(res, {
    redemption: await rejectRedemptionForUser(req.auth.sub, req.params.redemptionId, req.body.reason)
  });
});

const fulfillRedemption = asyncHandler(async (req, res) => {
  return ok(res, {
    redemption: await fulfillRedemptionForUser(req.auth.sub, req.params.redemptionId, req.body.notes)
  });
});

const updateRedemptionNotes = asyncHandler(async (req, res) => {
  return ok(res, {
    redemption: await updateRedemptionNotesForUser(req.auth.sub, req.params.redemptionId, req.body.notes)
  });
});

const listChildActivity = asyncHandler(async (req, res) => {
  return ok(res, await listActivityForChild(req.auth.sub, req.params.childId));
});

module.exports = {
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
};
