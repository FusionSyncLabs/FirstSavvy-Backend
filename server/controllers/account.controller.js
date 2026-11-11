const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listAccountsForProfile,
  listAccountTemplates,
  listAccountTypes,
  activateTemplateAccountForProfile,
  getAccountForProfile,
  createAccountForProfile,
  updateAccountForProfile,
  deleteAccountForProfile,
  getAccountDeletionSummaryForProfile,
  autoFixAccountVariance
} = require('../services/account.service');

const listAccounts = asyncHandler(async (req, res) => {
  return ok(res, await listAccountsForProfile(req.profileAccess.profileId, req.query));
});

const listTemplates = asyncHandler(async (req, res) => {
  return ok(res, await listAccountTemplates(req.query));
});

const listTypes = asyncHandler(async (req, res) => {
  return ok(res, await listAccountTypes());
});

const activateTemplate = asyncHandler(async (req, res) => {
  return created(res, {
    account: await activateTemplateAccountForProfile(req.profileAccess.profileId, req.body, req.user?.id)
  });
});

const getAccount = asyncHandler(async (req, res) => {
  return ok(res, {
    account: await getAccountForProfile(req.profileAccess.profileId, req.params.accountId)
  });
});

const getDeletionSummary = asyncHandler(async (req, res) => {
  return ok(res, await getAccountDeletionSummaryForProfile(req.profileAccess.profileId, req.params.accountId));
});

const createAccount = asyncHandler(async (req, res) => {
  return created(res, {
    account: await createAccountForProfile(req.profileAccess.profileId, req.body, req.user?.id)
  });
});

const updateAccount = asyncHandler(async (req, res) => {
  return ok(res, {
    account: await updateAccountForProfile(req.profileAccess.profileId, req.params.accountId, req.body, req.user?.id)
  });
});

const deleteAccount = asyncHandler(async (req, res) => {
  const options = {
    reassignToAccountId: req.body?.reassignToAccountId || req.body?.reassign_to_account_id || req.query?.reassignToAccountId || req.query?.reassign_to_account_id
  };
  return ok(res, await deleteAccountForProfile(req.profileAccess.profileId, req.params.accountId, options, req.user?.id));
});

const autoFixVariance = asyncHandler(async (req, res) => {
  return ok(res, await autoFixAccountVariance(req.profileAccess.profileId, req.params.accountId));
});

module.exports = {
  listAccounts,
  listTemplates,
  listTypes,
  activateTemplate,
  getAccount,
  getDeletionSummary,
  createAccount,
  updateAccount,
  deleteAccount,
  autoFixVariance
};

