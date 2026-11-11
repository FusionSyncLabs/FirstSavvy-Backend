'use strict';
const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { seedDemoDataForProfile } = require('../services/demoSeed.service');

const seedDemoData = asyncHandler(async (req, res) => {
  return ok(res, await seedDemoDataForProfile(req.auth.sub, req.params.profileId));
});

module.exports = { seedDemoData };
