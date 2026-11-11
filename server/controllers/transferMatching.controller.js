const { ok } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  findTransferMatchesForProfile,
  pairTransfersForProfile,
  matchAndPostTransfersForProfile,
  unmatchTransferForProfile,
  autoMatchTransfersForProfile
} = require('../services/transferMatching.service');

const findTransferMatches = asyncHandler(async (req, res) => {
  return ok(res, {
    matches: await findTransferMatchesForProfile(req.profileAccess.profileId, req.params.transactionId)
  });
});

const pairTransfers = asyncHandler(async (req, res) => {
  const shouldPost = req.body.post !== false;
  return ok(res, await pairTransfersForProfile(
    req.profileAccess.profileId,
    req.body.transactionId,
    req.body.matchedTransactionId,
    { post: shouldPost, userId: req.auth.sub }
  ));
});

const unmatchTransfer = asyncHandler(async (req, res) => {
  return ok(res, await unmatchTransferForProfile(req.profileAccess.profileId, req.params.transactionId, req.auth.sub));
});

const autoMatchTransfers = asyncHandler(async (req, res) => {
  return ok(res, await autoMatchTransfersForProfile(
    req.profileAccess.profileId,
    req.body.minConfidence
  ));
});

module.exports = {
  findTransferMatches,
  pairTransfers,
  unmatchTransfer,
  autoMatchTransfers
};
