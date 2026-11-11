const { ok, created } = require("../utils/apiResponse");
const { asyncHandler } = require("../utils/asyncHandler");
const {
  listReferrals,
  createReferral,
  getReferralLink,
  sendReferralEmail,
  sendInvitationWithAutoVerification,
  sendInvitationWithAcceptButton,
} = require("../services/referral.service");
const { env } = require("../config/env");

function getRequestClientOrigin(req) {
  const origin = req.get("origin");
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/+$/, "");
  const referer = req.get("referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {}
  }
  return null;
}

const listAllReferrals = asyncHandler(async (req, res) => {
  const filters = {
    status: req.query.status,
    referred_by_id: req.query.referred_by_id,
  };
  return ok(res, {
    referrals: await listReferrals(filters),
  });
});

const createNewReferral = asyncHandler(async (req, res) => {
  const referral = await createReferral(req.auth.sub, req.body);
  return created(res, { referral });
});

const generateReferralLink = asyncHandler(async (req, res) => {
  const payload = { ...req.body };
  const referral = await createReferral(req.auth.sub, {
    payload,
    status: "active",
  });
  return created(res, {
    referral: null,
    link: getReferralLink(referral.short_id, getRequestClientOrigin(req) || env.clientSiteUrl),
  });
});

const sendReferralEmailToUser = asyncHandler(async (req, res) => {
  const { email, inviterName } = req.body;

  if (!email) {
    throw new Error('Email is required');
  }

  const result = await sendReferralEmail(req.auth.sub, email, { inviterName, clientOrigin: getRequestClientOrigin(req) });
  return created(res, result);
});

const sendInvitationWithAutoVerificationToUser = asyncHandler(async (req, res) => {
  const { email, userData, inviterName } = req.body;

  if (!email || !userData) {
    throw new Error('Email and user data are required');
  }

  const result = await sendInvitationWithAutoVerification(req.auth.sub, email, userData, { inviterName, clientOrigin: getRequestClientOrigin(req) });
  return created(res, result);
});

const sendInvitationWithAcceptButtonToUser = asyncHandler(async (req, res) => {
  const { email, userData, inviterName, relationRole } = req.body;

  if (!email || !userData) {
    throw new Error('Email and user data are required');
  }

  const result = await sendInvitationWithAcceptButton(req.auth.sub, email, userData, { inviterName, relationRole, clientOrigin: getRequestClientOrigin(req) });
  return created(res, result);
});

module.exports = {
  listAllReferrals,
  createNewReferral,
  generateReferralLink,
  sendReferralEmailToUser,
  sendInvitationWithAutoVerificationToUser,
  sendInvitationWithAcceptButtonToUser,
};
