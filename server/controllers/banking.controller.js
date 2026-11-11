const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { listRecurringPaymentsForProfile } = require('../services/banking.service');

const listRecurringPayments = asyncHandler(async (req, res) => {
  return ok(res, await listRecurringPaymentsForProfile(req.profileAccess.profileId));
});

module.exports = {
  listRecurringPayments
};
