const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listConfigurationsForProfile,
  getConfigurationByNameForProfile,
  lockConfigurationForProfile,
  unlockConfigurationForProfile,
  restoreConfigurationVersionForProfile,
  getConfigurationHistoryForProfile,
  logConfigurationChangeForProfile
} = require('../services/protectedConfiguration.service');

const listConfigurations = asyncHandler(async (req, res) => {
  return ok(res, await listConfigurationsForProfile(req.profileAccess.profileId));
});

const getConfigurationByName = asyncHandler(async (req, res) => {
  return ok(res, await getConfigurationByNameForProfile(
    req.profileAccess.profileId,
    req.params.name
  ));
});

const lockConfiguration = asyncHandler(async (req, res) => {
  return ok(res, await lockConfigurationForProfile(
    req.profileAccess.profileId,
    req.auth.sub,
    req.params.configId
  ));
});

const unlockConfiguration = asyncHandler(async (req, res) => {
  return ok(res, await unlockConfigurationForProfile(
    req.profileAccess.profileId,
    req.auth.sub,
    req.params.configId
  ));
});

const restoreConfigurationVersion = asyncHandler(async (req, res) => {
  return ok(res, await restoreConfigurationVersionForProfile(
    req.profileAccess.profileId,
    req.auth.sub,
    req.params.configId,
    req.body.version
  ));
});

const getConfigurationHistory = asyncHandler(async (req, res) => {
  return ok(res, await getConfigurationHistoryForProfile(
    req.profileAccess.profileId,
    req.params.configId
  ));
});

const logConfigurationChange = asyncHandler(async (req, res) => {
  return created(res, await logConfigurationChangeForProfile(
    req.profileAccess.profileId,
    req.auth.sub,
    req.body
  ));
});

module.exports = {
  listConfigurations,
  getConfigurationByName,
  lockConfiguration,
  unlockConfiguration,
  restoreConfigurationVersion,
  getConfigurationHistory,
  logConfigurationChange
};
