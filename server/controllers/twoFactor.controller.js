const {
  enableTwoFactor,
  confirmTwoFactorSetup,
  disableTwoFactor,
  requestTwoFactorVerification,
  verifyTwoFactorCode,
  verifyTotpCode,
  getTwoFactorStatus,
  regenerateBackupCodes,
} = require('../services/twoFactor.service');
const { ok } = require('../utils/apiResponse');
const { resolveChallengeUserId, issueCompletionToken } = require('../utils/twoFactorTokens');

async function setupTwoFactor(req, res, next) {
  try {
    const { method, phoneNumber, email } = req.body;
    const userId = req.auth.sub;

    const result = await enableTwoFactor(userId, method, { phoneNumber, email });
    return ok(res, result);
  } catch (error) {
    next(error);
  }
}

async function confirmSetupTwoFactor(req, res, next) {
  try {
    const { method, code } = req.body;
    const userId = req.auth.sub;

    const result = await confirmTwoFactorSetup(userId, method, code);
    return ok(res, result);
  } catch (error) {
    next(error);
  }
}

async function disableTwoFactorHandler(req, res, next) {
  try {
    const { password } = req.body;
    const userId = req.auth.sub;

    const result = await disableTwoFactor(userId, password);
    return ok(res, result);
  } catch (error) {
    next(error);
  }
}

async function requestVerification(req, res, next) {
  try {
    const userId = req.auth?.sub || (req.body?.challengeToken ? resolveChallengeUserId(req.body.challengeToken) : req.body?.userId);

    const result = await requestTwoFactorVerification(userId);
    return ok(res, result);
  } catch (error) {
    next(error);
  }
}

async function verifyCode(req, res, next) {
  try {
    const { code, backupCode, userId: bodyUserId, challengeToken } = req.body;
    const userId = req.auth?.sub || (challengeToken ? resolveChallengeUserId(challengeToken) : bodyUserId);

    const result = await verifyTwoFactorCode(userId, code, backupCode);
    return ok(res, {
      ...result,
      completionToken: issueCompletionToken(userId),
    });
  } catch (error) {
    next(error);
  }
}

async function verifyTotp(req, res, next) {
  try {
    const { code, userId: bodyUserId, challengeToken } = req.body;
    const userId = req.auth?.sub || (challengeToken ? resolveChallengeUserId(challengeToken) : bodyUserId);

    const result = await verifyTotpCode(userId, code);
    return ok(res, {
      ...result,
      completionToken: issueCompletionToken(userId),
    });
  } catch (error) {
    next(error);
  }
}

async function getStatus(req, res, next) {
  try {
    const userId = req.auth.sub;

    const result = await getTwoFactorStatus(userId);
    return ok(res, result);
  } catch (error) {
    next(error);
  }
}

async function regenerateBackupCodesHandler(req, res, next) {
  try {
    const { password } = req.body;
    const userId = req.auth.sub;

    const result = await regenerateBackupCodes(userId, password);
    return ok(res, result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  setupTwoFactor,
  confirmSetupTwoFactor,
  disableTwoFactorHandler,
  requestVerification,
  verifyCode,
  verifyTotp,
  getStatus,
  regenerateBackupCodesHandler,
};
