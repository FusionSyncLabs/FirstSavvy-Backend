const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { searchForProfile } = require('../services/globalSearch.service');

const search = asyncHandler(async (req, res) => {
  return ok(res, await searchForProfile(
    req.profileAccess.profileId,
    req.auth.sub,
    req.query
  ));
});

module.exports = {
  search
};
