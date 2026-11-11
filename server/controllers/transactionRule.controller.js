const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listRulesForProfile,
  getRuleForProfile,
  createRuleForProfile,
  updateRuleForProfile,
  deleteRuleForProfile,
  duplicateRuleForProfile,
  getRuleMatchPreview,
  applyRuleToPendingTransactions
} = require('../services/transactionRule.service');

const listRules = asyncHandler(async (req, res) => {
  const data = await listRulesForProfile(req.profileAccess.profileId, req.query);
  return ok(res, data);
});

const getRule = asyncHandler(async (req, res) => {
  return ok(res, {
    rule: await getRuleForProfile(req.profileAccess.profileId, req.params.ruleId)
  });
});

const createRule = asyncHandler(async (req, res) => {
  return created(res, {
    rule: await createRuleForProfile(req.profileAccess.profileId, req.body)
  });
});

const updateRule = asyncHandler(async (req, res) => {
  return ok(res, {
    rule: await updateRuleForProfile(req.profileAccess.profileId, req.params.ruleId, req.body)
  });
});

const deleteRule = asyncHandler(async (req, res) => {
  return ok(res, await deleteRuleForProfile(req.profileAccess.profileId, req.params.ruleId));
});

const duplicateRule = asyncHandler(async (req, res) => {
  return created(res, {
    rule: await duplicateRuleForProfile(req.profileAccess.profileId, req.params.ruleId)
  });
});

const getMatchPreview = asyncHandler(async (req, res) => {
  return ok(res, await getRuleMatchPreview(req.profileAccess.profileId, req.body));
});

const applyRule = asyncHandler(async (req, res) => {
  return ok(res, await applyRuleToPendingTransactions(req.profileAccess.profileId, req.params.ruleId));
});

module.exports = {
  listRules,
  getRule,
  createRule,
  updateRule,
  deleteRule,
  duplicateRule,
  getMatchPreview,
  applyRule
};
