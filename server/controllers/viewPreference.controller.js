const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  getViewPreferenceForProfile,
  saveViewPreferenceForProfile,
  deleteViewPreferenceForProfile,
  deleteAllViewPreferencesForProfile
} = require('../services/viewPreference.service');

const getViewPreference = asyncHandler(async (req, res) => {
  return ok(res, {
    preferences: await getViewPreferenceForProfile(req.profileAccess.profileId, req.params.viewName)
  });
});

const saveViewPreference = asyncHandler(async (req, res) => {
  return ok(res, {
    preferences: await saveViewPreferenceForProfile(
      req.profileAccess.profileId,
      req.params.viewName,
      req.body.preferences || {}
    )
  });
});

const deleteViewPreference = asyncHandler(async (req, res) => {
  return ok(res, await deleteViewPreferenceForProfile(req.profileAccess.profileId, req.params.viewName));
});

const deleteAllViewPreferences = asyncHandler(async (req, res) => {
  return ok(res, await deleteAllViewPreferencesForProfile(req.profileAccess.profileId));
});

module.exports = {
  getViewPreference,
  saveViewPreference,
  deleteViewPreference,
  deleteAllViewPreferences
};
