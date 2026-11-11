const { randomUUID } = require('crypto');
const { prisma } = require('../config/database');
const { env } = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { sendEmail, generateEmailTemplate } = require('../utils/mail');
const { logServerError } = require('../utils/safeLogger');
const { pickPublicUser } = require('../utils/sanitize');
const { registerUserInTransaction, buildSession } = require('./auth.service');
const { verifyUserProvisioning } = require('./provisioning.service');
const {
  createNotificationForUser,
  createNotificationsForProfileMembers
} = require('./notification.service');

const SHARE_LIMIT = 3;
const VALID_SHARE_PERMISSIONS = new Set(['view_only', 'editor', 'co_parent']);
const MUTATING_ROLES = new Set(['owner', 'admin']);

async function getActiveInvitationForChild(userId, childProfileId) {
  await assertCanManageChild(userId, childProfileId);

  const invitation = await prisma.profileInvitation.findFirst({
    where: {
      child_profile_id: childProfileId,
      status: 'pending'
    },
    orderBy: { created_at: 'desc' }
  });

  return pickInvitation(invitation);
}

async function getInvitationByToken(token) {
  const invitation = await prisma.profileInvitation.findUnique({
    where: { invitation_token: token },
    include: {
      child_profile: true,
      invited_by_profile: true
    }
  });

  return pickInvitationWithDetails(invitation);
}

async function createInvitationForChild(userId, childProfileId, input = {}) {
  const childProfile = await assertCanManageChild(userId, childProfileId);
  const invitedEmail = normalizeEmail(input.invitedEmail || input.invited_email);

  if (!invitedEmail) {
    throw ApiError.badRequest('Invited email is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'invitedEmail', message: 'Required field is missing' }]
    });
  }

  const invitation = await prisma.$transaction(async (tx) => {
    const createdInvitation = await tx.profileInvitation.create({
      data: {
        child_profile_id: childProfile.id,
        invited_email: invitedEmail,
        invitation_token: randomUUID(),
        invitation_expires_at: daysFromNow(7),
        invited_by_profile_id: childProfile.parent_profile_id,
        status: 'pending'
      }
    });

    await notifyParentProfileMembers(childProfile.parent_profile_id, userId, {
      source_id: createdInvitation.id,
      event_type: 'collaboration.invitation_created',
      delivery_key: `collaboration:invitation_created:${createdInvitation.id}`,
      title: 'Invitation sent',
      body: `${displayChildName(childProfile)} was invited to claim their profile.`,
      action_url: `/Contacts/family/${childProfile.id}`,
      metadata: {
        child_profile_id: childProfile.id,
        invited_email: invitedEmail
      }
    }, { db: tx });

    return createdInvitation;
  });

  await sendInvitationEmail(invitation, {
    inviterName: input.inviterName || input.inviter_name,
    familyRole: input.familyRole || input.family_role,
    clientOrigin: input.clientOrigin
  });

  return pickInvitation(invitation);
}

async function resendInvitation(userId, invitationId, input = {}) {
  const existing = await getInvitationForManagement(userId, invitationId);

  const invitation = await prisma.$transaction(async (tx) => {
    const updatedInvitation = await tx.profileInvitation.update({
      where: { id: existing.id },
      data: {
        invitation_token: randomUUID(),
        invitation_expires_at: daysFromNow(7),
        status: 'pending'
      }
    });

    await notifyParentProfileMembers(existing.child_profile.parent_profile_id, userId, {
      source_id: updatedInvitation.id,
      event_type: 'collaboration.invitation_resent',
      delivery_key: `collaboration:invitation_resent:${updatedInvitation.id}:${updatedInvitation.invitation_token}`,
      title: 'Invitation resent',
      body: `${displayChildName(existing.child_profile)} was sent a fresh invitation link.`,
      action_url: `/Contacts/family/${existing.child_profile_id}`,
      metadata: {
        child_profile_id: existing.child_profile_id,
        invited_email: updatedInvitation.invited_email
      }
    }, { db: tx });

    return updatedInvitation;
  });

  await sendInvitationEmail(invitation, {
    inviterName: input.inviterName || input.inviter_name,
    familyRole: input.familyRole || input.family_role,
    clientOrigin: input.clientOrigin
  });

  return pickInvitation(invitation);
}

async function revokeInvitation(userId, invitationId) {
  const existing = await getInvitationForManagement(userId, invitationId);

  const invitation = await prisma.$transaction(async (tx) => {
    const updatedInvitation = await tx.profileInvitation.update({
      where: { id: existing.id },
      data: { status: 'revoked' }
    });

    await notifyParentProfileMembers(existing.child_profile.parent_profile_id, userId, {
      source_id: updatedInvitation.id,
      event_type: 'collaboration.invitation_revoked',
      delivery_key: `collaboration:invitation_revoked:${updatedInvitation.id}`,
      title: 'Invitation revoked',
      body: `${displayChildName(existing.child_profile)}'s invitation was revoked.`,
      action_url: `/Contacts/family/${existing.child_profile_id}`,
      metadata: {
        child_profile_id: existing.child_profile_id,
        invited_email: updatedInvitation.invited_email
      }
    }, { db: tx });

    return updatedInvitation;
  });

  return pickInvitation(invitation);
}

async function acceptInvitation(token, input = {}) {
  const password = String(input.password || '');
  const fullName = input.fullName || input.full_name;

  if (password.length < 8) {
    throw ApiError.badRequest('Password must be at least 8 characters', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'password', message: 'Must be at least 8 characters' }]
    });
  }

  const invitation = await prisma.profileInvitation.findUnique({
    where: { invitation_token: token },
    include: {
      child_profile: true
    }
  });

  if (!invitation || invitation.status !== 'pending') {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Invitation not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  if (invitation.invitation_expires_at <= new Date()) {
    await prisma.profileInvitation.update({
      where: { id: invitation.id },
      data: { status: 'expired' }
    });

    throw new ApiError(HTTP_STATUS.BAD_REQUEST, 'Invitation has expired', {
      code: ERROR_CODES.TOKEN_EXPIRED
    });
  }

  if (invitation.child_profile?.auth_user_id) {
    throw ApiError.badRequest('This profile has already been claimed', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const accepted = await prisma.$transaction(async (tx) => {
    const registered = await registerUserInTransaction(tx, {
      email: invitation.invited_email,
      fullName: fullName || displayChildName(invitation.child_profile),
      password
    });
    const user = registered.user;

    const childProfile = await tx.childProfile.update({
      where: { id: invitation.child_profile_id },
      data: {
        auth_user_id: user.id,
        email: user.email
      }
    });

    const userProfile = await tx.profile.findFirst({
      where: {
        memberships: {
          some: {
            user_id: user.id,
            role: { in: ['owner', 'admin'] }
          }
        },
        deleted_at: null,
        is_active: true
      },
      orderBy: [
        { is_default: 'desc' },
        { created_at: 'asc' }
      ]
    });

    if (userProfile) {
      await tx.profileShare.upsert({
        where: {
          child_profile_id_shared_with_profile_id: {
            child_profile_id: invitation.child_profile_id,
            shared_with_profile_id: userProfile.id
          }
        },
        create: {
          child_profile_id: invitation.child_profile_id,
          shared_with_profile_id: userProfile.id,
          permission_level: 'co_parent',
          granted_by_profile_id: invitation.invited_by_profile_id,
          is_active: true
        },
        update: {
          permission_level: 'co_parent',
          is_active: true,
          revoked_at: null,
          granted_by_profile_id: invitation.invited_by_profile_id
        }
      });

      await tx.parentAccessGrant.upsert({
        where: {
          child_profile_id_parent_profile_id: {
            child_profile_id: invitation.child_profile_id,
            parent_profile_id: userProfile.id
          }
        },
        create: {
          child_profile_id: invitation.child_profile_id,
          parent_profile_id: userProfile.id,
          granted_by_id: user.id,
          role: 'co_parent',
          is_active: true
        },
        update: {
          role: 'co_parent',
          is_active: true,
          revoked_at: null
        }
      });
    }

    const updatedInvitation = await tx.profileInvitation.update({
      where: { id: invitation.id },
      data: {
        status: 'accepted',
        accepted_at: new Date()
      }
    });

    await createNotificationsForProfileMembers(invitation.invited_by_profile_id, {
      source: 'collaboration',
      source_id: invitation.id,
      event_type: 'collaboration.invitation_accepted',
      delivery_key: `collaboration:invitation_accepted:${invitation.id}`,
      title: 'Invitation accepted',
      body: `${displayChildName(childProfile)} accepted their invitation.`,
      action_url: `/Contacts/family/${childProfile.id}`,
      priority: 'normal',
      metadata: {
        child_profile_id: childProfile.id,
        accepted_by_user_id: user.id,
        shared_profile_id: userProfile?.id || null
      }
    }, {
      db: tx,
      excludeUserIds: [user.id]
    });

    return {
      ...registered,
      childProfile,
      invitation: updatedInvitation,
      userProfile
    };
  });

  return {
    success: true,
    user: pickPublicUser(accepted.user),
    profile: accepted.profile,
    chartAccountCount: accepted.chartAccountCount,
    verification: await verifyUserProvisioning(accepted.user.id),
    session: buildSession(accepted.user),
    child_name: displayChildName(accepted.childProfile),
    childProfile: pickChildProfile(accepted.childProfile),
    invitation: pickInvitation(accepted.invitation),
    sharedProfileId: accepted.userProfile?.id || null
  };
}

async function expireOldInvitations() {
  const result = await prisma.profileInvitation.updateMany({
    where: {
      status: 'pending',
      invitation_expires_at: { lt: new Date() }
    },
    data: { status: 'expired' }
  });

  return { expiredCount: result.count };
}

async function listSharesForChild(userId, childProfileId) {
  await assertCanManageChild(userId, childProfileId);

  const shares = await prisma.profileShare.findMany({
    where: {
      child_profile_id: childProfileId,
      is_active: true
    },
    include: shareInclude(),
    orderBy: { created_at: 'desc' }
  });

  return shares.map(pickShare);
}

async function createShareForChild(userId, childProfileId, input = {}) {
  const childProfile = await assertCanManageChild(userId, childProfileId);
  const permissionLevel = normalizeSharePermission(input.permissionLevel || input.permission_level);
  const sharedWithProfile = input.sharedWithProfileId || input.shared_with_profile_id
    ? await getActiveProfileById(input.sharedWithProfileId || input.shared_with_profile_id)
    : await getOwnedProfileByEmail(input.email);

  if (!sharedWithProfile) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'No active profile was found for that user', {
      code: ERROR_CODES.PROFILE_NOT_FOUND
    });
  }

  if (sharedWithProfile.id === childProfile.parent_profile_id) {
    throw ApiError.badRequest('The owner profile already has access', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const activeShareCount = await prisma.profileShare.count({
    where: {
      child_profile_id: childProfile.id,
      is_active: true
    }
  });

  if (activeShareCount >= SHARE_LIMIT) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Maximum of 4 adults (1 owner + 3 shared) allowed per child profile', {
      code: ERROR_CODES.CONFLICT
    });
  }

  const share = await prisma.$transaction(async (tx) => {
    const upsertedShare = await tx.profileShare.upsert({
      where: {
        child_profile_id_shared_with_profile_id: {
          child_profile_id: childProfile.id,
          shared_with_profile_id: sharedWithProfile.id
        }
      },
      create: {
        child_profile_id: childProfile.id,
        shared_with_profile_id: sharedWithProfile.id,
        permission_level: permissionLevel,
        granted_by_profile_id: childProfile.parent_profile_id,
        is_active: true
      },
      update: {
        permission_level: permissionLevel,
        granted_by_profile_id: childProfile.parent_profile_id,
        is_active: true,
        revoked_at: null
      },
      include: shareInclude()
    });

    await notifyProfileShareCreated(upsertedShare, userId, { db: tx });
    return upsertedShare;
  });

  return pickShare(share);
}

async function revokeShare(userId, shareId) {
  const existing = await getShareForManagement(userId, shareId);

  const share = await prisma.$transaction(async (tx) => {
    const updatedShare = await tx.profileShare.update({
      where: { id: existing.id },
      data: {
        is_active: false,
        revoked_at: new Date()
      },
      include: shareInclude()
    });
    await notifyProfileShareRevoked(updatedShare, userId, { db: tx });
    return updatedShare;
  });

  return pickShare(share);
}

async function getInvitationForManagement(userId, invitationId) {
  const invitation = await prisma.profileInvitation.findUnique({
    where: { id: invitationId },
    include: {
      child_profile: true
    }
  });

  if (!invitation) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Invitation not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  await assertCanManageChild(userId, invitation.child_profile_id);
  return invitation;
}

async function getShareForManagement(userId, shareId) {
  const share = await prisma.profileShare.findUnique({
    where: { id: shareId },
    include: {
      child_profile: true
    }
  });

  if (!share) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Profile share not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  await assertCanManageChild(userId, share.child_profile_id);
  return share;
}

async function getGrantForManagement(userId, grantId) {
  const grant = await prisma.parentAccessGrant.findUnique({
    where: { id: grantId }
  });

  if (!grant) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Parent access grant not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  await assertCanManageChild(userId, grant.child_profile_id);
  return grant;
}

async function notifyParentProfileMembers(profileId, actorUserId, input, options = {}) {
  await createNotificationsForProfileMembers(profileId, {
    source: 'collaboration',
    priority: 'normal',
    ...input
  }, {
    ...options,
    excludeUserIds: [
      actorUserId,
      ...(options.excludeUserIds || [])
    ]
  });
}

async function notifyProfileShareCreated(share, actorUserId, options = {}) {
  await createNotificationForUser(share.shared_with_profile?.owner_user_id, {
    source: 'collaboration',
    source_id: share.id,
    event_type: 'collaboration.profile_shared',
    delivery_key: `collaboration:profile_shared:${share.id}`,
    title: 'Profile shared with you',
    body: `${displayChildName(share.child_profile)} was shared with ${share.shared_with_profile?.display_name || share.shared_with_profile?.name || 'your profile'}.`,
    action_url: `/Contacts/family/${share.child_profile_id}`,
    priority: 'normal',
    metadata: {
      child_profile_id: share.child_profile_id,
      shared_with_profile_id: share.shared_with_profile_id,
      permission_level: share.permission_level
    }
  }, {
    ...options,
    fallbackProfileId: share.shared_with_profile_id
  });

  await notifyParentProfileMembers(share.granted_by_profile_id, actorUserId, {
    source_id: share.id,
    event_type: 'collaboration.profile_share_created',
    delivery_key: `collaboration:profile_share_created:${share.id}`,
    title: 'Profile access shared',
    body: `${displayChildName(share.child_profile)} was shared with ${share.shared_with_profile?.display_name || 'another profile'}.`,
    action_url: `/Contacts/family/${share.child_profile_id}`,
    metadata: {
      child_profile_id: share.child_profile_id,
      shared_with_profile_id: share.shared_with_profile_id,
      permission_level: share.permission_level
    }
  }, options);
}

async function notifyProfileSharePermissionUpdated(share, actorUserId, options = {}) {
  await createNotificationForUser(share.shared_with_profile?.owner_user_id, {
    source: 'collaboration',
    source_id: share.id,
    event_type: 'collaboration.profile_share_updated',
    delivery_key: `collaboration:profile_share_updated:${share.id}:${share.permission_level}`,
    title: 'Shared profile access updated',
    body: `${displayChildName(share.child_profile)} access is now ${share.permission_level}.`,
    action_url: `/Contacts/family/${share.child_profile_id}`,
    priority: 'normal',
    metadata: {
      child_profile_id: share.child_profile_id,
      shared_with_profile_id: share.shared_with_profile_id,
      permission_level: share.permission_level
    }
  }, {
    ...options,
    fallbackProfileId: share.shared_with_profile_id
  });

  await notifyParentProfileMembers(share.granted_by_profile_id, actorUserId, {
    source_id: share.id,
    event_type: 'collaboration.profile_share_permission_updated',
    delivery_key: `collaboration:profile_share_permission_updated:${share.id}:${share.permission_level}`,
    title: 'Shared access updated',
    body: `${displayChildName(share.child_profile)} shared access was updated.`,
    action_url: `/Contacts/family/${share.child_profile_id}`,
    metadata: {
      child_profile_id: share.child_profile_id,
      shared_with_profile_id: share.shared_with_profile_id,
      permission_level: share.permission_level
    }
  }, options);
}

async function notifyProfileShareRevoked(share, actorUserId, options = {}) {
  await createNotificationForUser(share.shared_with_profile?.owner_user_id, {
    source: 'collaboration',
    source_id: share.id,
    event_type: 'collaboration.profile_share_revoked',
    delivery_key: `collaboration:profile_share_revoked:${share.id}`,
    title: 'Shared profile access revoked',
    body: `${displayChildName(share.child_profile)} is no longer shared with your profile.`,
    action_url: `/Contacts/family/${share.child_profile_id}`,
    priority: 'normal',
    metadata: {
      child_profile_id: share.child_profile_id,
      shared_with_profile_id: share.shared_with_profile_id
    }
  }, {
    ...options,
    fallbackProfileId: share.shared_with_profile_id
  });

  await notifyParentProfileMembers(share.granted_by_profile_id, actorUserId, {
    source_id: share.id,
    event_type: 'collaboration.profile_share_revoked_by_owner',
    delivery_key: `collaboration:profile_share_revoked_by_owner:${share.id}`,
    title: 'Shared access revoked',
    body: `${displayChildName(share.child_profile)} shared access was revoked.`,
    action_url: `/Contacts/family/${share.child_profile_id}`,
    metadata: {
      child_profile_id: share.child_profile_id,
      shared_with_profile_id: share.shared_with_profile_id
    }
  }, options);
}

async function notifyParentAccessGranted(grant, actorUserId, options = {}) {
  await createNotificationForUser(grant.parent_profile?.owner_user_id, {
    source: 'collaboration',
    source_id: grant.id,
    event_type: 'collaboration.parent_access_granted',
    delivery_key: `collaboration:parent_access_granted:${grant.id}`,
    title: 'Parent access granted',
    body: `Access was granted to ${grant.parent_profile?.display_name || grant.parent_profile?.name || 'your profile'}.`,
    action_url: `/Contacts/family/${grant.child_profile_id}`,
    priority: 'normal',
    metadata: {
      child_profile_id: grant.child_profile_id,
      parent_profile_id: grant.parent_profile_id,
      role: grant.role
    }
  }, {
    ...options,
    fallbackProfileId: grant.parent_profile_id
  });
  await notifyParentProfileMembersForGrant(grant, actorUserId, 'collaboration.parent_access_grant_created', 'Parent access granted', options);
}

async function notifyParentAccessUpdated(grant, actorUserId, options = {}) {
  await createNotificationForUser(grant.parent_profile?.owner_user_id, {
    source: 'collaboration',
    source_id: grant.id,
    event_type: 'collaboration.parent_access_updated',
    delivery_key: `collaboration:parent_access_updated:${grant.id}:${grant.role}:${grant.is_active}`,
    title: 'Parent access updated',
    body: `Access for ${grant.parent_profile?.display_name || grant.parent_profile?.name || 'your profile'} was updated.`,
    action_url: `/Contacts/family/${grant.child_profile_id}`,
    priority: 'normal',
    metadata: {
      child_profile_id: grant.child_profile_id,
      parent_profile_id: grant.parent_profile_id,
      role: grant.role
    }
  }, {
    ...options,
    fallbackProfileId: grant.parent_profile_id
  });
  await notifyParentProfileMembersForGrant(grant, actorUserId, 'collaboration.parent_access_grant_updated', 'Parent access updated', options);
}

async function notifyParentAccessRevoked(grant, actorUserId, options = {}) {
  await createNotificationForUser(grant.parent_profile?.owner_user_id, {
    source: 'collaboration',
    source_id: grant.id,
    event_type: 'collaboration.parent_access_revoked',
    delivery_key: `collaboration:parent_access_revoked:${grant.id}`,
    title: 'Parent access revoked',
    body: `Access for ${grant.parent_profile?.display_name || grant.parent_profile?.name || 'your profile'} was revoked.`,
    action_url: `/Contacts/family/${grant.child_profile_id}`,
    priority: 'normal',
    metadata: {
      child_profile_id: grant.child_profile_id,
      parent_profile_id: grant.parent_profile_id
    }
  }, {
    ...options,
    fallbackProfileId: grant.parent_profile_id
  });
  await notifyParentProfileMembersForGrant(grant, actorUserId, 'collaboration.parent_access_grant_revoked', 'Parent access revoked', options);
}

async function notifyParentProfileMembersForGrant(grant, actorUserId, eventType, title, options = {}) {
  const db = options.db || prisma;
  const childProfile = await db.childProfile.findFirst({
    where: { id: grant.child_profile_id },
    select: {
      parent_profile_id: true,
      display_name: true,
      name: true,
      first_name: true,
      last_name: true,
      email: true
    }
  });

  if (!childProfile?.parent_profile_id) return;

  await notifyParentProfileMembers(childProfile.parent_profile_id, actorUserId, {
    source_id: grant.id,
    event_type: eventType,
    delivery_key: `collaboration:${eventType}:${grant.id}:${grant.role}:${grant.is_active}`,
    title,
    body: `${displayChildName(childProfile)} access changed for ${grant.parent_profile?.display_name || 'another profile'}.`,
    action_url: `/Contacts/family/${grant.child_profile_id}`,
    metadata: {
      child_profile_id: grant.child_profile_id,
      parent_profile_id: grant.parent_profile_id,
      role: grant.role
    }
  }, options);
}

async function assertCanManageChild(userId, childProfileId) {
  const childProfile = await prisma.childProfile.findFirst({
    where: {
      id: childProfileId,
      deleted_at: null,
      is_active: true
    },
    include: {
      parent_profile: {
        include: {
          memberships: {
            where: { user_id: userId }
          }
        }
      }
    }
  });

  const membership = childProfile?.parent_profile?.memberships?.[0];

  if (!childProfile || !membership || !MUTATING_ROLES.has(membership.role)) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Profile admin access is required', {
      code: ERROR_CODES.PROFILE_ACCESS_DENIED
    });
  }

  return childProfile;
}

async function assertProfileMembership(userId, profileId) {
  const membership = await prisma.profileMembership.findFirst({
    where: {
      user_id: userId,
      profile_id: profileId,
      profile: {
        deleted_at: null,
        is_active: true
      }
    }
  });

  if (!membership) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Profile not found', {
      code: ERROR_CODES.PROFILE_NOT_FOUND
    });
  }

  return membership;
}

async function getActiveProfileById(profileId) {
  const profile = await prisma.profile.findFirst({
    where: {
      id: profileId,
      deleted_at: null,
      is_active: true
    },
    include: {
      owner: true
    }
  });

  if (!profile) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Profile not found', {
      code: ERROR_CODES.PROFILE_NOT_FOUND
    });
  }

  return profile;
}

async function getOwnedProfileByEmail(email) {
  const normalizedEmail = normalizeEmail(email);

  if (!normalizedEmail) {
    throw ApiError.badRequest('Email is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'email', message: 'Required field is missing' }]
    });
  }

  return prisma.profile.findFirst({
    where: {
      owner: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive'
        },
        deleted_at: null
      },
      deleted_at: null,
      is_active: true
    },
    include: {
      owner: true
    },
    orderBy: [
      { is_default: 'desc' },
      { created_at: 'asc' }
    ]
  });
}

function shareInclude() {
  return {
    child_profile: true,
    shared_with_profile: {
      include: {
        owner: true
      }
    },
    granted_by_profile: true
  };
}

async function sendInvitationEmail(invitation, options = {}) {
  const configuredOrigin = String(env.clientSiteUrl || env.corsOrigin || '').trim();
  const isLocalConfigured = !configuredOrigin || configuredOrigin.includes('localhost') || configuredOrigin.includes('127.0.0.1');
  const baseOrigin = (options.clientOrigin && isLocalConfigured) ? options.clientOrigin : (configuredOrigin || 'http://localhost:5173');
  const inviteUrl = new URL(`/invite/${invitation.invitation_token}`, baseOrigin).toString();
  const inviterName = options.inviterName || 'A FirstSavvy member';
  const familyRole = options.familyRole ? ` as ${options.familyRole}` : '';

  const emailText = [
    `${inviterName} invited you to FirstSavvy${familyRole}.`,
    '',
    `Accept the invitation: ${inviteUrl}`,
    '',
    'This invitation expires in 7 days.'
  ].join('\n');

  const emailHtml = generateEmailTemplate({
    title: 'You have been invited to FirstSavvy',
    content: `
      <p style="margin: 0 0 20px 0;">${escapeHtml(inviterName)} invited you to join FirstSavvy${escapeHtml(familyRole)}.</p>
      <p style="margin: 20px 0;">Click the button below to accept this invitation and join the family financial network.</p>
    `,
    buttonText: 'Accept Invitation',
    buttonLink: inviteUrl,
    footerText: 'This invitation expires in 7 days.'
  });

  try {
    await sendEmail(invitation.invited_email, 'You have been invited to FirstSavvy', emailText, emailHtml);
  } catch (error) {
    logServerError('profile-invitation-email', error);
    throw new ApiError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'The invitation was saved, but the email could not be sent. Try resending it.', {
      code: ERROR_CODES.SERVICE_UNAVAILABLE
    });
  }
}

function normalizeSharePermission(permissionLevel) {
  const value = String(permissionLevel).trim();

  if (!VALID_SHARE_PERMISSIONS.has(value)) {
    throw ApiError.badRequest('Unsupported permission level', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'permissionLevel', message: 'Unsupported permission level' }]
    });
  }

  return value;
}

function pickInvitation(invitation) {
  if (!invitation) return null;

  return {
    id: invitation.id,
    child_profile_id: invitation.child_profile_id,
    invited_email: invitation.invited_email,
    invitation_token: invitation.invitation_token,
    invitation_expires_at: invitation.invitation_expires_at,
    invited_by_profile_id: invitation.invited_by_profile_id,
    status: invitation.status,
    created_at: invitation.created_at,
    accepted_at: invitation.accepted_at
  };
}

function pickInvitationWithDetails(invitation) {
  if (!invitation) return null;

  return {
    ...pickInvitation(invitation),
    child_profile: pickChildProfile(invitation.child_profile),
    invited_by: invitation.invited_by_profile ? {
      id: invitation.invited_by_profile.id,
      display_name: invitation.invited_by_profile.display_name || invitation.invited_by_profile.name,
      profile_name: invitation.invited_by_profile.display_name || invitation.invited_by_profile.name
    } : null
  };
}

function pickShare(share) {
  if (!share) return null;

  return {
    id: share.id,
    child_profile_id: share.child_profile_id,
    shared_with_profile_id: share.shared_with_profile_id,
    permission_level: share.permission_level,
    granted_by_profile_id: share.granted_by_profile_id,
    is_active: share.is_active,
    created_at: share.created_at,
    revoked_at: share.revoked_at,
    child_profile: pickChildProfile(share.child_profile),
    shared_with_profile: pickProfileWithUser(share.shared_with_profile),
    granted_by_profile: pickProfileWithUser(share.granted_by_profile)
  };
}

function pickGrant(grant) {
  if (!grant) return null;

  return {
    id: grant.id,
    child_profile_id: grant.child_profile_id,
    parent_profile_id: grant.parent_profile_id,
    granted_by_id: grant.granted_by_id,
    role: grant.role,
    is_active: grant.is_active,
    created_at: grant.created_at,
    revoked_at: grant.revoked_at,
    profiles: pickProfileWithUser(grant.parent_profile),
    parent_profile: pickProfileWithUser(grant.parent_profile)
  };
}

function pickProfileWithUser(profile) {
  if (!profile) return null;

  return {
    id: profile.id,
    display_name: profile.display_name || profile.name,
    name: profile.name,
    avatar_url: profile.avatar_url,
    user_id: profile.owner_user_id,
    user: profile.owner ? {
      id: profile.owner.id,
      email: profile.owner.email,
      full_name: profile.owner.full_name
    } : undefined
  };
}

function pickChildProfile(childProfile) {
  if (!childProfile) return null;
  const metadata = childProfile.metadata && typeof childProfile.metadata === 'object' && !Array.isArray(childProfile.metadata)
    ? childProfile.metadata
    : {};

  return {
    id: childProfile.id,
    parent_profile_id: childProfile.parent_profile_id,
    auth_user_id: childProfile.auth_user_id,
    user_id: childProfile.auth_user_id,
    child_name: displayChildName(childProfile),
    name: displayChildName(childProfile),
    display_name: childProfile.display_name || displayChildName(childProfile),
    email: childProfile.email,
    avatar_url: childProfile.avatar_url,
    date_of_birth: childProfile.birth_date ? childProfile.birth_date.toISOString().slice(0, 10) : null,
    current_permission_level: Number(metadata.current_permission_level || metadata.permission_level || 1),
    cash_balance: Number(childProfile.cash_balance || 0),
    family_role: childProfile.family_role
  };
}

function displayChildName(childProfile) {
  return childProfile?.display_name ||
    childProfile?.name ||
    [childProfile?.first_name, childProfile?.last_name].filter(Boolean).join(' ').trim() ||
    childProfile?.email ||
    'Profile';
}

function daysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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
