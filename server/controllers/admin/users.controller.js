const { ok } = require('../../utils/apiResponse');
const { asyncHandler } = require('../../utils/asyncHandler');
const {
  listAdminUsers,
  listAdminReferralUsers
} = require('../../services/admin/users.service');

const listAdminUsersHandler = asyncHandler(async (req, res) => {
  return ok(res, await listAdminUsers(req.query));
});

const listAdminReferralUsersHandler = asyncHandler(async (req, res) => {
  const { userId, referralId } = req.params;
  return ok(res, await listAdminReferralUsers(userId, referralId, req.query));
});

module.exports = {
  listAdminUsersHandler,
  listAdminReferralUsersHandler
};
