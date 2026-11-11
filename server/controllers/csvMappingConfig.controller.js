const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { getCsvMappingConfigForProfile, saveCsvMappingConfigForProfile } = require('../services/csvMappingConfig.service');

const getCsvMappingConfig = asyncHandler(async (req, res) => {
  return ok(res, await getCsvMappingConfigForProfile(
    req.profileAccess.profileId,
    req.query.institutionName
  ));
});

const saveCsvMappingConfig = asyncHandler(async (req, res) => {
  return created(res, await saveCsvMappingConfigForProfile(req.profileAccess.profileId, req.body));
});

module.exports = {
  getCsvMappingConfig,
  saveCsvMappingConfig,
};
