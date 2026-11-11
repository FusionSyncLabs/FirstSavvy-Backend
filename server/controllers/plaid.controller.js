const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  getPlaidStatusForProfile,
  createLinkTokenForProfile,
  createUpdateLinkTokenForProfile,
  exchangePublicTokenForProfile,
  syncPlaidItemForProfile,
  disconnectPlaidItemForProfile,
  unlinkPlaidAccountForProfile,
  mapPlaidAccountsForProfile,
  refreshPlaidAccountBalance
} = require('../services/plaid.service');

const getStatus = asyncHandler(async (req, res) => {
  return ok(res, await getPlaidStatusForProfile(req.profileAccess.profileId));
});

const createLinkToken = asyncHandler(async (req, res) => {
  return ok(res, await createLinkTokenForProfile(req.profileAccess.profileId, req.auth.sub));
});

const createUpdateLinkToken = asyncHandler(async (req, res) => {
  return ok(res, await createUpdateLinkTokenForProfile(
    req.profileAccess.profileId,
    req.auth.sub,
    req.params.itemId
  ));
});

const exchangePublicToken = asyncHandler(async (req, res) => {
  return ok(res, await exchangePublicTokenForProfile(
    req.profileAccess.profileId,
    req.body.publicToken ?? req.body.public_token,
    req.body.metadata || {}
  ));
});

const syncPlaidItem = asyncHandler(async (req, res) => {
  return ok(res, await syncPlaidItemForProfile(
    req.profileAccess.profileId,
    req.body.itemId ?? req.body.item_id ?? null
  ));
});

const disconnectItem = asyncHandler(async (req, res) => {
  return ok(res, await disconnectPlaidItemForProfile(
    req.profileAccess.profileId,
    req.params.itemId
  ));
});

const unlinkAccount = asyncHandler(async (req, res) => {
  return ok(res, await unlinkPlaidAccountForProfile(
    req.profileAccess.profileId,
    req.params.accountId
  ));
});

const mapAccounts = asyncHandler(async (req, res) => {
  return ok(res, await mapPlaidAccountsForProfile(
    req.profileAccess.profileId,
    req.body.mappings || []
  ));
});

const refreshBalance = asyncHandler(async (req, res) => {
  return ok(res, await refreshPlaidAccountBalance(
    req.profileAccess.profileId,
    req.params.accountId
  ));
});

module.exports = {
  getStatus,
  createLinkToken,
  createUpdateLinkToken,
  exchangePublicToken,
  syncPlaidItem,
  disconnectItem,
  unlinkAccount,
  mapAccounts,
  refreshBalance
};
