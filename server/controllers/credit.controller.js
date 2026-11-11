const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  initiateVerification,
  getCreditStatus,
  getCreditScore,
  getCreditHistory,
  refreshCreditScore
} = require('../services/credit.service');

const verifyCreditIdentity = asyncHandler(async (req, res) => {
  const result = await initiateVerification(
    req.profileAccess.profileId,
    req.auth.sub,
    req.body
  );

  return created(res, result);
});

const getCreditStatusHandler = asyncHandler(async (req, res) => {
  return ok(res, await getCreditStatus(req.profileAccess.profileId));
});

const getCreditScoreHandler = asyncHandler(async (req, res) => {
  return ok(res, await getCreditScore(req.profileAccess.profileId));
});

const getCreditHistoryHandler = asyncHandler(async (req, res) => {
  const months = req.query.months;
  const history = await getCreditHistory(req.profileAccess.profileId, months);
  return ok(res, { history });
});

const refreshCreditScoreHandler = asyncHandler(async (req, res) => {
  return ok(res, await refreshCreditScore(req.profileAccess.profileId, 'manual_refresh'));
});

module.exports = {
  verifyCreditIdentity,
  getCreditStatusHandler,
  getCreditScoreHandler,
  getCreditHistoryHandler,
  refreshCreditScoreHandler
};
