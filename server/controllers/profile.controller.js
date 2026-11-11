const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listProfilesForUser,
  getActiveProfileForUser,
  getProfileForUser,
  createProfileForUser,
  updateProfileForUser,
  deleteProfileForUser,
  switchProfileForUser,
  getDirectChildProfileForUser,
  listChildProfilesForProfile,
  listAccessibleChildProfilesForUser,
  getChildProfileForUser,
  deleteChildProfileForUser,
  createChildProfileForProfile,
  updateChildProfileForUser,
  verifyChildPinForParent,
  unlockChildAccountForUser,
  checkChildUsernameAvailability,
} = require('../services/profile.service');
const {
  resetFinancialDataForProfile,
  resetUserDataForProfile
} = require('../services/profileReset.service');

function getPublicFilesBaseUrl(req) {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = forwardedProto
    ? String(forwardedProto).split(',')[0].trim()
    : (req.secure ? 'https' : req.protocol);
  const host = req.headers['x-forwarded-host'] || req.get('host');
  if (!host) return '/api/v1/files/public';
  return `${proto}://${host}/api/v1/files/public`;
}

const listProfiles = asyncHandler(async (req, res) => {
  return ok(res, {
    profiles: await listProfilesForUser(req.auth.sub)
  });
});

const getProfile = asyncHandler(async (req, res) => {
  return ok(res, {
    profile: await getProfileForUser(req.auth.sub, req.params.profileId)
  });
});

const getActiveProfile = asyncHandler(async (req, res) => {
  return ok(res, {
    activeProfile: await getActiveProfileForUser(req.auth.sub)
  });
});

const createProfile = asyncHandler(async (req, res) => {
  return created(res, await createProfileForUser(req.auth.sub, req.body));
});

const updateProfile = asyncHandler(async (req, res) => {
  return ok(res, await updateProfileForUser(req.auth.sub, req.params.profileId, req.body));
});

const deleteProfile = asyncHandler(async (req, res) => {
  return ok(res, await deleteProfileForUser(req.auth.sub, req.params.profileId));
});

const switchProfile = asyncHandler(async (req, res) => {
  return ok(res, await switchProfileForUser(req.auth.sub, req.params.profileId, req.body || {}));
});

const getDirectChildProfile = asyncHandler(async (req, res) => {
  return ok(res, {
    childProfile: await getDirectChildProfileForUser(req.auth.sub)
  });
});

const listProfileChildren = asyncHandler(async (req, res) => {
  return ok(res, {
    children: await listChildProfilesForProfile(req.auth.sub, req.params.profileId, {
      activeOnly: req.query.activeOnly !== 'false',
      includePendingTaskCounts: req.query.includePendingTaskCounts === 'true'
    })
  });
});

const listAccessibleChildren = asyncHandler(async (req, res) => {
  const profileIds = Array.isArray(req.query.profileId)
    ? req.query.profileId
    : req.query.profileId
      ? [req.query.profileId]
      : [];

  return ok(res, {
    children: await listAccessibleChildProfilesForUser(req.auth.sub, profileIds)
  });
});

const getChildProfile = asyncHandler(async (req, res) => {
  return ok(res, {
    childProfile: await getChildProfileForUser(req.auth.sub, req.params.childId, {
      includeStats: req.query.includeStats === 'true'
    })
  });
});

const deleteChildProfile = asyncHandler(async (req, res) => {
  return ok(res, await deleteChildProfileForUser(req.auth.sub, req.params.childId));
});

const createChildProfile = asyncHandler(async (req, res) => {
  return created(res, {
    childProfile: await createChildProfileForProfile(req.auth.sub, req.params.profileId, req.body, {
      avatarFile: req.file,
      publicFilesBaseUrl: getPublicFilesBaseUrl(req)
    })
  });
});

const updateChildProfile = asyncHandler(async (req, res) => {
  return ok(res, {
    childProfile: await updateChildProfileForUser(req.auth.sub, req.params.childId, req.body, {
      avatarFile: req.file,
      publicFilesBaseUrl: getPublicFilesBaseUrl(req)
    })
  });
});

const verifyChildPin = asyncHandler(async (req, res) => {
  return ok(res, await verifyChildPinForParent(req.auth.sub, req.params.childId, req.body.pin));
});

const unlockChildAccount = asyncHandler(async (req, res) => {
  return ok(res, {
    childProfile: await unlockChildAccountForUser(req.auth.sub, req.params.childId)
  });
});

const resetFinancialData = asyncHandler(async (req, res) => {
  return ok(res, await resetFinancialDataForProfile(req.auth.sub, req.params.profileId));
});

const resetUserData = asyncHandler(async (req, res) => {
  return ok(res, await resetUserDataForProfile(req.auth.sub, req.params.profileId));
});

const checkUsernameAvailability = asyncHandler(async (req, res) => {
  return ok(res, await checkChildUsernameAvailability(req.query.username));
});

module.exports = {
  listProfiles,
  getActiveProfile,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  switchProfile,
  getDirectChildProfile,
  listProfileChildren,
  listAccessibleChildren,
  getChildProfile,
  deleteChildProfile,
  createChildProfile,
  updateChildProfile,
  verifyChildPin,
  unlockChildAccount,
  checkUsernameAvailability,
  resetFinancialData,
  resetUserData,
};
