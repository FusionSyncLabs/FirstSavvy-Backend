const express = require("express");
const { validateRequest } = require("../../middleware/validateRequest");
const { authenticate } = require("../../middleware/authenticate");
const {
  listAllReferrals,
  createNewReferral,
  generateReferralLink,
  sendReferralEmailToUser,
  sendInvitationWithAutoVerificationToUser,
  sendInvitationWithAcceptButtonToUser,
} = require("../../controllers/referral.controller");

const router = express.Router();

const referralCreateSchema = {
  code: { type: "string", minLength: 1, maxLength: 50 },
  short_id: { type: "string", minLength: 1, maxLength: 20 },
  max_uses: { type: "number", min: 1 },
  status: {
    type: "string",
    enum: ["active", "inactive", "expired", "disabled"],
  },
  expires_at: { type: "string", format: "date" },
  description: { type: "string", maxLength: 500 },
};

const sendReferralEmailSchema = {
  email: { type: "string", format: "email" },
  inviterName: { type: "string", minLength: 1, maxLength: 100 },
};

const sendInvitationWithAutoVerificationSchema = {
  email: { type: "string", format: "email" },
  userData: { type: "object" },
  inviterName: { type: "string", minLength: 1, maxLength: 100 },
};

const sendInvitationWithAcceptButtonSchema = {
  email: { type: "string", format: "email" },
  userData: { type: "object" },
  inviterName: { type: "string", minLength: 1, maxLength: 100 },
  relationRole: { type: "string", minLength: 1, maxLength: 50 },
};

router.use(authenticate);

router.get(
  "/",
  validateRequest({
    query: {
      status: {
        type: "string",
        enum: ["active", "inactive", "expired", "disabled"],
      },
      referred_by_id: { type: "string", uuid: true },
    },
  }),
  listAllReferrals,
);

router.post(
  "/generate",
  validateRequest({ body: referralCreateSchema }),
  generateReferralLink,
);

router.post(
  "/",
  validateRequest({ body: referralCreateSchema }),
  createNewReferral,
);

router.post(
  "/send-email",
  validateRequest({ body: sendReferralEmailSchema }),
  sendReferralEmailToUser,
);

router.post(
  "/send-invitation-auto-verify",
  validateRequest({ body: sendInvitationWithAutoVerificationSchema }),
  sendInvitationWithAutoVerificationToUser,
);

router.post(
  "/send-invitation-with-button",
  validateRequest({ body: sendInvitationWithAcceptButtonSchema }),
  sendInvitationWithAcceptButtonToUser,
);

module.exports = router;
