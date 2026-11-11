const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { validateRequest } = require('../../middleware/validateRequest');
const controller = require('../../controllers/collaboration.controller');

const router = express.Router();
const uuid = { required: true, type: 'string', uuid: true };
const permissionLevels = ['view_only', 'editor', 'co_parent'];
const childFamilyRoles = ['child', 'spouse_partner', 'parent', 'sibling', 'grandparent', 'other'];

router.get(
  '/invitations/token/:token',
  validateRequest({
    params: {
      token: { required: true, type: 'string', maxLength: 255 }
    }
  }),
  controller.getInvitationByToken
);

router.post(
  '/invitations/:token/accept',
  validateRequest({
    params: {
      token: { required: true, type: 'string', maxLength: 255 }
    },
    body: {
      password: { required: true, type: 'string', minLength: 8 },
      fullName: { type: 'string', maxLength: 255 },
      full_name: { type: 'string', maxLength: 255 }
    }
  }),
  controller.acceptInvitation
);

router.post('/invitations/expire-old', controller.expireOldInvitations);

router.use(authenticate);

router.get(
  '/children/:childId/invitations/active',
  validateRequest({ params: { childId: uuid } }),
  controller.getActiveInvitationForChild
);

router.post(
  '/children/:childId/invitations',
  validateRequest({
    params: { childId: uuid },
    body: {
      invitedEmail: { type: 'string', email: true, maxLength: 320 },
      invited_email: { type: 'string', email: true, maxLength: 320 },
      inviterName: { type: 'string', maxLength: 255 },
      inviter_name: { type: 'string', maxLength: 255 },
      familyRole: { type: 'string', enum: childFamilyRoles },
      family_role: { type: 'string', enum: childFamilyRoles }
    }
  }),
  controller.createInvitationForChild
);

router.patch(
  '/invitations/:invitationId/resend',
  validateRequest({
    params: { invitationId: uuid },
    body: {
      inviterName: { type: 'string', maxLength: 255 },
      inviter_name: { type: 'string', maxLength: 255 },
      familyRole: { type: 'string', enum: childFamilyRoles },
      family_role: { type: 'string', enum: childFamilyRoles }
    }
  }),
  controller.resendInvitation
);

router.patch(
  '/invitations/:invitationId/revoke',
  validateRequest({ params: { invitationId: uuid } }),
  controller.revokeInvitation
);

router.get(
  '/children/:childId/shares',
  validateRequest({ params: { childId: uuid } }),
  controller.listSharesForChild
);

router.post(
  '/children/:childId/shares',
  validateRequest({
    params: { childId: uuid },
    body: {
      email: { type: 'string', email: true, maxLength: 320 },
      sharedWithProfileId: { type: 'string', uuid: true },
      shared_with_profile_id: { type: 'string', uuid: true },
      permissionLevel: { type: 'string', enum: permissionLevels },
      permission_level: { type: 'string', enum: permissionLevels }
    }
  }),
  controller.createShareForChild
);

router.patch(
  '/shares/:shareId/revoke',
  validateRequest({ params: { shareId: uuid } }),
  controller.revokeShare
);

module.exports = router;