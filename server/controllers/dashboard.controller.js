const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { getDashboardDataForProfile } = require('../services/dashboard.service');

const getDashboardData = asyncHandler(async (req, res) => {
  return ok(res, await getDashboardDataForProfile(req.profileAccess.profileId));
});

module.exports = {
  getDashboardData
};
