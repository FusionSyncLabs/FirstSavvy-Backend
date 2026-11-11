const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { setRefreshCookie } = require('../utils/cookies');
const service = require('../services/collaboration.service');

const getActiveInvitationForChild = asyncHandler(async (req, res) => ok(res, {
  invitation: await service.getActiveInvitationForChild(req.auth.sub, req.params.childId)
}));

const getInvitationByToken = asyncHandler(async (req, res) => ok(res, {
  invitation: await service.getInvitationByToken(req.params.token)
}));

function getRequestClientOrigin(req) {
  const origin = req.get('origin');
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, '');
  const referer = req.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {}
  }
  return null;
}

const createInvitationForChild = asyncHandler(async (req, res) => created(res, {
  invitation: await service.createInvitationForChild(req.auth.sub, req.params.childId, {
    ...req.body,
    clientOrigin: getRequestClientOrigin(req)
  })
}));

const resendInvitation = asyncHandler(async (req, res) => ok(res, {
  invitation: await service.resendInvitation(req.auth.sub, req.params.invitationId, {
    ...req.body,
    clientOrigin: getRequestClientOrigin(req)
  })
}));

const revokeInvitation = asyncHandler(async (req, res) => ok(res, {
  invitation: await service.revokeInvitation(req.auth.sub, req.params.invitationId)
}));

const acceptInvitation = asyncHandler(async (req, res) => {
  const result = await service.acceptInvitation(req.params.token, req.body);
  setRefreshCookie(res, result.session.refreshToken);

  return created(res, withoutRefreshToken(result));
});

const expireOldInvitations = asyncHandler(async (_req, res) => ok(res,
  await service.expireOldInvitations()
));

const listSharesForChild = asyncHandler(async (req, res) => ok(res, {
  shares: await service.listSharesForChild(req.auth.sub, req.params.childId)
}));

const createShareForChild = asyncHandler(async (req, res) => created(res, {
  share: await service.createShareForChild(req.auth.sub, req.params.childId, req.body)
}));

const revokeShare = asyncHandler(async (req, res) => ok(res, {
  share: await service.revokeShare(req.auth.sub, req.params.shareId)
}));

module.exports = {
  getActiveInvitationForChild,
  getInvitationByToken,
  createInvitationForChild,
  resendInvitation,
  revokeInvitation,
  acceptInvitation,
  expireOldInvitations,
  listSharesForChild,
  createShareForChild,
  revokeShare
};

function withoutRefreshToken(result) {
  const { refreshToken: _refreshToken, ...session } = result.session;

  return {
    ...result,
    session
  };
}
