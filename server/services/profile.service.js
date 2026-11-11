const bcrypt = require('bcrypt');
const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { provisionProfileForUser } = require('./provisioning.service');
const { buildDefaultDisplayName } = require('./provisioning.helpers');
const {
  deleteObject,
  extractKeyFromPublicUrl,
  uploadPublicObject,
  normalizePublicFileUrl
} = require('./fileStorage.service');
const { createNotificationsForProfile } = require('./notification.service');
const { generateUniqueId } = require('../utils/uniqueId');

const PROFILE_TYPES = new Set([
  'personal',
  'household',
  'business',
  'real_estate',
  'passive',
  'holding_company'
]);
const BCRYPT_ROUNDS = 12;
const CHILD_FAMILY_ROLES = new Set([
  'child',
  'spouse_partner',
  'spouse',
  'partner',
  'co_parent',
  'parent',
  'sibling',
  'grandparent',
  'dependent',
  'other'
]);
const ADULT_FAMILY_ROLES = new Set([
  'spouse_partner',
  'spouse',
  'partner',
  'co_parent',
  'parent',
  'grandparent',
  'other'
]);
const CHILD_AVATAR_MAX_BYTES = 5 * 1024 * 1024;

async function listProfilesForUser(userId) {
  const memberships = await prisma.profileMembership.findMany({
    where: {
      user_id: userId,
      profile: {
        deleted_at: null,
        is_active: true
      }
    },
    include: {
      profile: true
    },
    orderBy: [
      { profile: { is_default: 'desc' } },
      { profile: { created_at: 'asc' } }
    ]
  });

  const linkByProfileId = new Map();

  // Check if user is linked as an adult/family member to any household profile
  try {
    const householdLinks = await prisma.childProfile.findMany({
      where: {
        auth_user_id: userId,
        deleted_at: null,
        is_active: true,
        parent_profile: {
          deleted_at: null,
          is_active: true
        }
      },
      include: {
        parent_profile: true
      }
    });

    for (const link of householdLinks) {
      if (link.parent_profile_id) {
        linkByProfileId.set(link.parent_profile_id, link);
      }
      if (link.parent_profile && !memberships.some(m => m.profile_id === link.parent_profile_id)) {
        const isAdultCoOwner = [
          'spouse_partner',
          'spouse',
          'partner',
          'co_owner',
          'co_parent',
          'parent',
          'grandparent',
          'other'
        ].includes(String(link.family_role || '').toLowerCase());
        const assignedRole = isAdultCoOwner ? 'owner' : 'editor';

        try {
          await prisma.profileMembership.upsert({
            where: {
              user_id_profile_id: {
                user_id: userId,
                profile_id: link.parent_profile_id
              }
            },
            update: { role: assignedRole },
            create: {
              user_id: userId,
              profile_id: link.parent_profile_id,
              role: assignedRole
            }
          });
        } catch (e) {
          // ignore duplicate race condition
        }

        memberships.push({
          profile_id: link.parent_profile_id,
          user_id: userId,
          role: assignedRole,
          profile: link.parent_profile
        });
      }
    }
  } catch (err) {
    console.warn('Could not query household links for user profiles:', err?.message);
  }

  const mapped = memberships.map((membership) => {
    const isActualOwner = membership.profile.owner_user_id === userId;
    const linkedRecord = linkByProfileId.get(membership.profile_id);
    const linkedRole = !isActualOwner
      ? (linkedRecord?.family_role || membership.profile.family_role || 'other')
      : null;

    return {
      ...pickPublicProfile(membership.profile),
      is_owner: isActualOwner,
      is_default: Boolean(membership.profile.is_default && isActualOwner),
      linked_family_role: linkedRole,
      membershipRole: membership.role,
      role: membership.role
    };
  });

  // Ensure the user's own default profile comes first, then other owned profiles, then linked households
  mapped.sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
    return 0;
  });

  return mapped;
}

async function getProfileForUser(userId, profileId) {
  const membership = await findMembership(userId, profileId);
  const isActualOwner = membership.profile.owner_user_id === userId;

  return {
    ...pickPublicProfile(membership.profile),
    is_owner: isActualOwner,
    is_default: Boolean(membership.profile.is_default && isActualOwner),
    membershipRole: membership.role
  };
}

async function createProfileForUser(userId, input = {}) {
  if (!input.name?.trim() && !input.displayName?.trim()) {
    throw ApiError.badRequest('Profile name is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'name', message: 'Required field is missing' }]
    });
  }

  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deleted_at: null
    }
  });

  if (!user) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.USER_NOT_FOUND
    });
  }

  const profileType = input.profileType || 'personal';

  if (!PROFILE_TYPES.has(profileType)) {
    throw ApiError.badRequest('Unsupported profile type', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'profileType', message: 'Unsupported profile type' }]
    });
  }

  const sortOrder = await prisma.profileTab.count({
    where: {
      owner_user_id: userId
    }
  });

  const result = await prisma.$transaction(async (tx) => {
    const provisioned = await provisionProfileForUser(tx, user, {
      displayName: input?.displayName || input.name,
      profileType,
      isDefault: false,
      sortOrder
    });

    const updates = {};

    if (input.color) {
      updates.color = input.color;
    }

    if (input.familyRole) {
      updates.family_role = input.familyRole;
    }

    const profile = Object.keys(updates).length > 0
      ? await tx.profile.update({
        where: { id: provisioned.profile.id },
        data: updates
      })
      : provisioned.profile;

    return {
      profile,
      chartAccountCount: provisioned.chartAccountCount
    };
  });

  return {
    profile: {
      ...pickPublicProfile(result.profile),
      membershipRole: 'owner'
    },
    chartAccountCount: result.chartAccountCount
  };
}

async function updateProfileForUser(userId, profileId, input = {}) {
  const membership = await findMembership(userId, profileId);
  const profileUpdates = {};
  const tabUpdates = {};
  const metadataUpdates = {};
  const userUpdates = {};

  if (input.first_name !== undefined) {
    if (normalizeNullableString(input.first_name)) {
      profileUpdates.name = normalizeNullableString(input.first_name);
      if (membership.profile.is_default) {
        userUpdates.full_name = normalizeNullableString(input.first_name);
      }
    } else {
      throw ApiError.badRequest('Profile first name cannot be blank', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'first_name', message: 'Must not be blank' }]
      });
    }
  }

  if (normalizeNullableString(input.last_name)) {
    profileUpdates.name = (profileUpdates.name || membership.profile.name || '') + ' ' + normalizeNullableString(input.last_name);
    if (membership.profile.is_default) {
      userUpdates.full_name = (userUpdates.full_name || membership.profile.name || '') + ' ' + normalizeNullableString(input.last_name);
    }
  }

  const displayNameInput = input.displayName ?? input.display_name;
  if (normalizeNullableString(displayNameInput)) {
    profileUpdates.display_name = normalizeNullableString(displayNameInput);
    tabUpdates.display_name = profileUpdates.display_name;
  } else if (profileUpdates.name) {
    profileUpdates.display_name = profileUpdates.name;
    tabUpdates.display_name = profileUpdates.name;
  }

  if (normalizeNullableString(input.avatarUrl) || normalizeNullableString(input.avatar_url)) {
    profileUpdates.avatar_url = normalizeNullableString(input.avatarUrl) || normalizeNullableString(input.avatar_url);
    if (membership.profile.is_default || membership.profile.profile_type === 'personal') {
      userUpdates.avatar_url = profileUpdates.avatar_url;
    }
  }

  if (input.remove_avatar == true || input.removeAvatar == true) {
    profileUpdates.avatar_url = null;
    if (membership.profile.is_default || membership.profile.profile_type === 'personal') {
      userUpdates.avatar_url = null;
    }
  }

  if (normalizeNullableString(input.color)) profileUpdates.color = normalizeNullableString(input.color);
  if (normalizeNullableString(input.familyRole)) profileUpdates.family_role = normalizeNullableString(input.familyRole);
  if (normalizeNullableString(input.bio)) metadataUpdates.bio = normalizeNullableString(input.bio);
  if (normalizeNullableString(input.dob)) {
    const dobStr = normalizeNullableString(input.dob);
    const parsedDob = parseDateOnly(dobStr);
    if (!parsedDob || parsedDob > new Date() || parsedDob.getUTCFullYear() < 1900) {
      throw ApiError.badRequest('Date of birth cannot be in the future', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'dob', message: 'Date of birth cannot be in the future' }]
      });
    }
    metadataUpdates.dob = dobStr;
  }
  if (normalizeNullableString(input.occupation)) metadataUpdates.occupation = normalizeNullableString(input.occupation);
  if (normalizeNullableString(input.income_range)) metadataUpdates.income_range = normalizeNullableString(input.income_range);
  if (normalizeNullableString(input.financial_goal)) metadataUpdates.financial_goal = normalizeNullableString(input.financial_goal);
  if (input.household_name !== undefined || input.householdName !== undefined) {
    const householdName = normalizeNullableString(input.household_name ?? input.householdName);
    if (!householdName) {
      throw ApiError.badRequest('Household name cannot be blank', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'household_name', message: 'Must not be blank' }]
      });
    }
    metadataUpdates.household_name = householdName;
  }
  if (input.phone !== undefined) {
    userUpdates.phone_number = normalizeNullableString(input.phone);
  }

  if (Object.keys(metadataUpdates).length > 0) {
    const existingMetadata = membership.profile.metadata &&
      typeof membership.profile.metadata === 'object' &&
      !Array.isArray(membership.profile.metadata)
      ? membership.profile.metadata
      : {};

    profileUpdates.metadata = {
      ...existingMetadata,
      ...metadataUpdates
    };
  }

  if (input.tabSortOrder !== undefined) tabUpdates.sort_order = input.tabSortOrder;

  const canUpdateProfile = ['owner', 'admin'].includes(membership.role);

  if (Object.keys(profileUpdates).length > 0 && !canUpdateProfile) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Profile admin access is required', {
      code: ERROR_CODES.PROFILE_ACCESS_DENIED
    });
  }

  if (Object.keys(profileUpdates).length === 0 && Object.keys(tabUpdates).length === 0) {
    throw ApiError.badRequest('No profile updates were provided', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const profile = Object.keys(profileUpdates).length > 0
      ? await tx.profile.update({
        where: { id: profileId },
        data: profileUpdates
      })
      : membership.profile;

    Object.keys(userUpdates).length > 0
      ? await tx.user.update({
        where: { id: userId },
        data: userUpdates
      })
      : null;

    // Keep the user's household member cards (child_profiles linked to this account) in sync with the new profile picture
    if (Object.prototype.hasOwnProperty.call(userUpdates, 'avatar_url')) {
      await tx.childProfile.updateMany({
        where: { auth_user_id: userId, deleted_at: null },
        data: { avatar_url: userUpdates.avatar_url }
      });
    }

    if (Object.keys(tabUpdates).length > 0) {
      await tx.profileTab.upsert({
        where: {
          owner_user_id_profile_id: {
            owner_user_id: userId,
            profile_id: profileId
          }
        },
        create: {
          owner_user_id: userId,
          profile_id: profileId,
          display_name: tabUpdates?.display_name || profile?.display_name || profile.name,
          is_active: true,
          sort_order: tabUpdates.sort_order ?? 0
        },
        update: tabUpdates
      });
    }

    return profile;
  });

  return {
    profile: {
      ...pickPublicProfile(result),
      membershipRole: membership.role,
      profileTabOrder: tabUpdates.sort_order ?? undefined
    }
  };
}

async function deleteProfileForUser(userId, profileId) {
  const membership = await findMembership(userId, profileId);

  if (membership.role !== 'owner') {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only the profile owner can delete this profile', {
      code: ERROR_CODES.PROFILE_ACCESS_DENIED
    });
  }

  if (membership.profile.is_default) {
    throw ApiError.badRequest('Your default personal profile cannot be deleted', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const otherMemberCount = await prisma.profileMembership.count({
    where: {
      profile_id: profileId,
      user_id: { not: userId }
    }
  });
  if (otherMemberCount > 0) {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'This profile is shared with other household members. Remove those members or transfer ownership before deleting it.', {
      code: ERROR_CODES.CONFLICT
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.profileTab.deleteMany({
      where: {
        profile_id: profileId
      }
    });

    await tx.profile.update({
      where: { id: profileId },
      data: {
        is_active: false,
        deleted_at: new Date()
      }
    });
  });

  const defaultProfile = await findDefaultProfile(userId);
  if (defaultProfile) {
    await setActiveProfileForUser(userId, defaultProfile.id);
  } else {
    await clearActiveProfileForUser(userId);
  }

  return {
    deleted: true,
    activeProfile: defaultProfile ? pickPublicProfile(defaultProfile) : null,
    profiles: await listProfilesForUser(userId)
  };
}

async function switchProfileForUser(userId, profileId, input = {}) {
  let profile;
  try {
    profile = await getProfileForUser(userId, profileId);
  } catch (error) {
    const child = await findAccessibleChildProfile(userId, profileId);
    profile = await getProfileForUser(userId, child.parent_profile_id);
    input = { ...input, childProfileId: child.id };
  }
  await setActiveProfileForUser(userId, profile.id, input.childProfileId || input.child_profile_id || null);

  return {
    activeProfile: profile,
    profiles: await listProfilesForUser(userId)
  };
}

async function getActiveProfileForUser(userId) {
  const settings = await prisma.userSetting.findUnique({
    where: { user_id: userId }
  });
  const activeProfileId = settings?.settings?.activeProfileId;
  const activeChildProfileId = settings?.settings?.activeChildProfileId;

  if (activeChildProfileId) {
    try {
      const child = await findAccessibleChildProfile(userId, activeChildProfileId);
      const parent = await getProfileForUser(userId, child.parent_profile_id);
      return {
        ...parent,
        active_child_profile_id: child.id,
        viewing_child_profile_id: child.id
      };
    } catch {
      await setActiveProfileForUser(userId, activeProfileId || null, null);
    }
  }

  if (activeProfileId) {
    try {
      return await getProfileForUser(userId, activeProfileId);
    } catch {
      await clearActiveProfileForUser(userId);
    }
  }

  const memberships = await prisma.profileMembership.findMany({
    where: {
      user_id: userId,
      profile: {
        deleted_at: null,
        is_active: true
      }
    },
    include: {
      profile: true
    },
    orderBy: [
      { created_at: 'desc' }
    ]
  });

  const sharedMembership = memberships.find((membership) => membership.profile?.owner_user_id && membership.profile.owner_user_id !== userId);
  if (!activeProfileId && sharedMembership) {
    return {
      ...pickPublicProfile(sharedMembership.profile),
      membershipRole: sharedMembership.role
    };
  }

  const householdMembership = memberships.find((m) => m.profile?.profile_type === 'household');
  if (householdMembership) {
    return {
      ...pickPublicProfile(householdMembership.profile),
      membershipRole: householdMembership.role
    };
  }

  const defaultProfile = await findDefaultProfile(userId);
  return defaultProfile
    ? {
      ...pickPublicProfile(defaultProfile),
      membershipRole: 'owner'
    }
    : null;
}

async function getDirectChildProfileForUser(userId) {
  const childProfile = await prisma.childProfile.findFirst({
    where: {
      auth_user_id: userId,
      is_active: true,
      deleted_at: null
    }
  });

  if (!childProfile) return null;

  if (childProfile.family_role && ADULT_FAMILY_ROLES.has(String(childProfile.family_role).toLowerCase())) {
    return null;
  }

  return pickPublicChildProfile(childProfile);
}

async function listChildProfilesForProfile(userId, profileId, options = {}) {
  await findMembership(userId, profileId);

  const children = await prisma.childProfile.findMany({
    where: {
      parent_profile_id: profileId,
      is_active: options.activeOnly === false ? undefined : true,
      deleted_at: null
    },
    orderBy: [
      { first_name: 'asc' },
      { name: 'asc' },
      { created_at: 'asc' }
    ]
  });

  if (options.includePendingTaskCounts) {
    const pendingCounts = await getPendingTaskCompletionCounts(children.map((child) => child.id));
    return children.map((child) => ({
      ...pickPublicChildProfile(child),
      pending_task_completion_count: pendingCounts[child.id] || 0
    }));
  }

  return children.map(pickPublicChildProfile);
}

async function listAccessibleChildProfilesForUser(userId, profileIds = []) {
  const requestedProfileIds = Array.isArray(profileIds)
    ? profileIds.filter(Boolean)
    : [];

  const memberships = await prisma.profileMembership.findMany({
    where: {
      user_id: userId,
      role: { in: ['owner', 'admin', 'editor'] },
      profile: {
        deleted_at: null,
        is_active: true,
        ...(requestedProfileIds.length ? { id: { in: requestedProfileIds } } : {})
      }
    },
    select: {
      profile_id: true
    }
  });

  const ownerProfileIds = memberships.map((membership) => membership.profile_id);

  if (ownerProfileIds.length === 0) {
    return [];
  }

  const [ownedChildren, grants] = await Promise.all([
    prisma.childProfile.findMany({
      where: {
        parent_profile_id: { in: ownerProfileIds },
        is_active: true,
        deleted_at: null
      },
      orderBy: [
        { first_name: 'asc' },
        { name: 'asc' },
        { created_at: 'asc' }
      ]
    }),
    prisma.parentAccessGrant.findMany({
      where: {
        parent_profile_id: { in: ownerProfileIds },
        is_active: true,
        revoked_at: null,
        child_profile: {
          is_active: true,
          deleted_at: null
        }
      },
      include: {
        child_profile: true
      }
    })
  ]);

  const uniqueChildren = new Map();
  ownedChildren.forEach((child) => uniqueChildren.set(child.id, child));
  grants.forEach((grant) => uniqueChildren.set(grant.child_profile.id, grant.child_profile));

  return Array.from(uniqueChildren.values()).map(pickPublicChildProfile);
}

async function getChildProfileForUser(userId, childProfileId, options = {}) {
  const childProfile = await findAccessibleChildProfile(userId, childProfileId);
  const publicChildProfile = pickPublicChildProfile(childProfile);

  if (options.includeStats) {
    publicChildProfile.stats = await getChildStatsForChildProfile(childProfileId);
  }

  return publicChildProfile;
}

async function getChildStatsForChildProfile(childProfileId) {
  const [
    completedTasks,
    pendingTasks,
    totalRedemptions,
    achievementsEarned
  ] = await Promise.all([
    prisma.task.count({
      where: {
        assigned_to_child_id: childProfileId,
        is_active: true,
        status: 'approved'
      }
    }),
    prisma.task.count({
      where: {
        assigned_to_child_id: childProfileId,
        is_active: true,
        status: 'completed'
      }
    }),
    prisma.rewardRedemption.count({
      where: {
        child_profile_id: childProfileId
      }
    }),
    prisma.childAchievement.count({
      where: {
        child_profile_id: childProfileId
      }
    })
  ]);

  return {
    completedTasks,
    pendingTasks,
    totalRedemptions,
    achievementsEarned
  };
}

async function deleteChildProfileForUser(userId, childProfileId) {
  const childProfile = await findAccessibleChildProfile(userId, childProfileId, {
    requiredRoles: ['owner', 'admin']
  });

  const authUserId = childProfile.auth_user_id;

  await prisma.$transaction(async (tx) => {
    // 1. Delete associated records (cascade/cleanup)
    await tx.childLoginAuditLog.deleteMany({ where: { child_profile_id: childProfile.id } });
    await tx.childAchievement.deleteMany({ where: { child_profile_id: childProfile.id } });
    await tx.childTransaction.deleteMany({ where: { child_profile_id: childProfile.id } });
    await tx.allowanceSchedule.deleteMany({ where: { child_profile_id: childProfile.id } });
    await tx.rewardRedemption.deleteMany({ where: { child_profile_id: childProfile.id } });
    await tx.taskCompletion.deleteMany({ where: { child_profile_id: childProfile.id } });
    await tx.task.deleteMany({ where: { assigned_to_child_id: childProfile.id } });
    await tx.reward.deleteMany({
      where: {
        OR: [
          { assigned_to_child_id: childProfile.id },
          { redeemed_by_child_id: childProfile.id }
        ]
      }
    });
    await tx.financialGoal.deleteMany({ where: { child_profile_id: childProfile.id } });
    await tx.parentAccessGrant.deleteMany({ where: { child_profile_id: childProfile.id } });
    await tx.profileShare.deleteMany({ where: { child_profile_id: childProfile.id } });
    await tx.profileInvitation.deleteMany({
      where: {
        OR: [
          { child_profile_id: childProfile.id },
          ...(childProfile.email ? [{ invited_email: childProfile.email, invited_by_profile_id: childProfile.parent_profile_id }] : [])
        ]
      }
    });

    // 2. If this was an adult member/co-owner linked to a profile membership on this household, remove the membership
    if (authUserId && childProfile.parent_profile_id) {
      await tx.profileMembership.deleteMany({
        where: {
          user_id: authUserId,
          profile_id: childProfile.parent_profile_id
        }
      });
    }

    // 3. HARD DELETE the childProfile row
    await tx.childProfile.delete({
      where: { id: childProfile.id }
    });

    // 4. Delete auth user record ONLY IF it was a child account created solely for child PIN login!
    // Never delete registered adult user accounts (spouses, partners, parents, or users with their own profiles)
    if (authUserId) {
      const isAdultRole = [
        'spouse_partner', 'spouse', 'partner', 'parent', 'co_parent', 'grandparent', 'sibling', 'other'
      ].includes(String(childProfile.family_role || '').toLowerCase());

      const userOwnedProfilesCount = await tx.profile.count({
        where: { owner_user_id: authUserId }
      });

      const userOtherMembershipsCount = await tx.profileMembership.count({
        where: { user_id: authUserId }
      });

      if (!isAdultRole && userOwnedProfilesCount === 0 && userOtherMembershipsCount === 0) {
        await tx.user.deleteMany({ where: { id: authUserId } });
      }
    }
  });

  await deleteChildAvatar(childProfile.avatar_url);

  return {
    deleted: true
  };
}

async function createChildProfileForProfile(userId, profileId, input = {}, options = {}) {
  await findMembership(userId, profileId);

  const firstName = normalizeNullableString(input.first_name);
  const lastName = normalizeNullableString(input.last_name);
  let username = normalizeChildUsername(input.username);
  if (!username || username.length < 3) {
    const base = (firstName || 'member').toLowerCase().replace(/[^a-z0-9]/g, '') || 'member';
    username = `${base}_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).substring(2, 5)}`;
  }

  if (!firstName || firstName.length < 2 || firstName.length > 50) {
    throw ApiError.badRequest('First name must be between 2 and 50 characters', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'first_name', message: 'Must be between 2 and 50 characters' }]
    });
  }

  if (!lastName || lastName.length < 2 || lastName.length > 50) {
    throw ApiError.badRequest('Last name must be between 2 and 50 characters', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'last_name', message: 'Must be between 2 and 50 characters' }]
    });
  }

  if (username.length < 3) {
    throw ApiError.badRequest('Username must be at least 3 characters', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'username', message: 'Must be at least 3 characters' }]
    });
  }

  // Purge any stale soft-deleted child profiles matching this username to free unique constraints
  const staleDeleted = await prisma.childProfile.findMany({
    where: {
      username: {
        equals: username,
        mode: 'insensitive'
      },
      deleted_at: { not: null }
    }
  });

  for (const stale of staleDeleted) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.childLoginAuditLog.deleteMany({ where: { child_profile_id: stale.id } });
        await tx.childAchievement.deleteMany({ where: { child_profile_id: stale.id } });
        await tx.childTransaction.deleteMany({ where: { child_profile_id: stale.id } });
        await tx.allowanceSchedule.deleteMany({ where: { child_profile_id: stale.id } });
        await tx.rewardRedemption.deleteMany({ where: { child_profile_id: stale.id } });
        await tx.taskCompletion.deleteMany({ where: { child_profile_id: stale.id } });
        await tx.task.deleteMany({ where: { assigned_to_child_id: stale.id } });
        await tx.reward.deleteMany({
          where: {
            OR: [
              { assigned_to_child_id: stale.id },
              { redeemed_by_child_id: stale.id }
            ]
          }
        });
        await tx.financialGoal.deleteMany({ where: { child_profile_id: stale.id } });
        await tx.parentAccessGrant.deleteMany({ where: { child_profile_id: stale.id } });
        await tx.profileShare.deleteMany({ where: { child_profile_id: stale.id } });
        await tx.profileInvitation.deleteMany({ where: { child_profile_id: stale.id } });
        await tx.childProfile.delete({ where: { id: stale.id } });
        if (stale.auth_user_id) {
          await tx.user.deleteMany({ where: { id: stale.auth_user_id } });
        }
      });
    } catch (e) {
      console.warn('Could not purge stale soft-deleted child profile:', e);
    }
  }

  const usernameCheck = await checkChildUsernameAvailability(username);
  if (!usernameCheck.available) {
    throw new ApiError(HTTP_STATUS.CONFLICT, usernameCheck.message, {
      code: ERROR_CODES.CONFLICT
    });
  }

  const rawBirthDate = input.date_of_birth || input.birth_date;
  if (rawBirthDate) {
    const parsedBirthDate = parseDateOnly(rawBirthDate);
    if (!parsedBirthDate || parsedBirthDate > new Date() || parsedBirthDate.getUTCFullYear() < 1900) {
      throw ApiError.badRequest('Date of birth cannot be in the future', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'date_of_birth', message: 'Date of birth cannot be in the future' }]
      });
    }
  }

  const fullName = normalizeNullableString(input.child_name) || `${firstName} ${lastName}`;
  const uploadedAvatar = options.avatarFile
    ? await uploadChildAvatar(options.avatarFile, {
      userId,
      profileId,
      publicFilesBaseUrl: options.publicFilesBaseUrl
    })
    : null;
  const avatarUrl = uploadedAvatar?.publicUrl || resolveChildAvatarUrl(input.avatar, input.avatar_url);
  const metadata = {
    current_permission_level: Number(input.current_permission_level || 1),
    login_enabled: Boolean(input.login_enabled),
    notes: input.notes || null,
    visible_for_everyone: Boolean(input.visible_for_everyone || input.is_visible_by_unique_id || false),
    is_visible_by_unique_id: Boolean(input.visible_for_everyone || input.is_visible_by_unique_id || false),
    daily_spending_limit: input.daily_spending_limit ?? null,
    weekly_spending_limit: input.weekly_spending_limit ?? null,
    monthly_spending_limit: input.monthly_spending_limit ?? null,
    avatar: avatarUrl || null,
    ...(input.metadata && typeof input.metadata === 'object' ? input.metadata : {}),
    ...(input.invitation_status ? { invitation_status: input.invitation_status } : {})
  };

  const targetEmailForDuplicate = normalizeNullableString(input.email);
  if (targetEmailForDuplicate) {
    const existingMember = await prisma.childProfile.findFirst({
      where: {
        parent_profile_id: profileId,
        deleted_at: null,
        email: { equals: targetEmailForDuplicate, mode: 'insensitive' }
      }
    });
    if (existingMember) {
      throw new ApiError(HTTP_STATUS.CONFLICT, 'This email is already a member of this household', {
        code: ERROR_CODES.CONFLICT
      });
    }
  }

  let childProfile;
  try {
    childProfile = await prisma.$transaction(async (tx) => {
      const createdChild = await tx.childProfile.create({
        data: {
          parent_profile_id: profileId,
          parent_user_id: userId,
          unique_id: generateUniqueId(),
          first_name: firstName,
          last_name: lastName,
          display_name: normalizeNullableString(input.display_name) ?? fullName,
          name: fullName,
          birth_date: parseDateOnly(input.date_of_birth || input.birth_date),
          gender: normalizeNullableString(input.sex || input.gender),
          avatar_url: avatarUrl,
          username,
          email: normalizeNullableString(input.email),
          family_role: normalizeChildFamilyRole(input.family_role),
          auth_user_id: input.auth_user_id || input.authUserId || null,
          metadata
        }
      });

      // If user with this email already exists, link their auth_user_id and grant profile membership ONLY if not pending invitation
      const targetEmail = normalizeNullableString(input.email);
      let existingAuthUser = null;
      if (input.auth_user_id) {
        existingAuthUser = await tx.user.findUnique({ where: { id: input.auth_user_id } });
      } else if (targetEmail) {
        existingAuthUser = await tx.user.findUnique({
          where: { email: targetEmail.toLowerCase() }
        });
      }

      const isPendingInvitation =
        metadata.invitation_status === 'pending' ||
        input.metadata?.invitation_status === 'pending' ||
        input.invitation_status === 'pending' ||
        metadata.invitation_status === 'invited';

      if (existingAuthUser && !isPendingInvitation) {
        await tx.childProfile.update({
          where: { id: createdChild.id },
          data: { auth_user_id: existingAuthUser.id }
        });

        const adultRoles = ['spouse_partner', 'spouse', 'partner', 'parent', 'grandparent', 'other'];
        const role = String(input.family_role || '').toLowerCase();
        if (adultRoles.includes(role)) {
          await tx.profileMembership.upsert({
            where: {
              user_id_profile_id: {
                user_id: existingAuthUser.id,
                profile_id: profileId
              }
            },
            update: { role: 'admin' },
            create: {
              user_id: existingAuthUser.id,
              profile_id: profileId,
              role: 'admin'
            }
          });

          const ownedDefault = await tx.profile.findFirst({
            where: {
              owner_user_id: existingAuthUser.id,
              is_default: true,
              deleted_at: null
            },
            select: { id: true }
          });
          const existingLedgerCount = ownedDefault
            ? await tx.transaction.count({
              where: { profile_id: ownedDefault.id, deleted_at: null }
            })
            : 0;
          if (existingLedgerCount === 0) {
            const existingSettings = await tx.userSetting.findUnique({
              where: { user_id: existingAuthUser.id }
            });
            const currentSettings = existingSettings?.settings && typeof existingSettings.settings === 'object'
              ? existingSettings.settings
              : {};
            await tx.userSetting.upsert({
              where: { user_id: existingAuthUser.id },
              create: {
                user_id: existingAuthUser.id,
                settings: { ...currentSettings, activeProfileId: profileId, activeChildProfileId: null }
              },
              update: {
                settings: { ...currentSettings, activeProfileId: profileId, activeChildProfileId: null }
              }
            });
          }
        }
      }

      if (!input.pin) {
        return createdChild;
      }

      if (!/^\d{4}$/.test(String(input.pin))) {
        throw ApiError.badRequest('PIN must be exactly 4 digits', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: 'pin', message: 'Must be exactly 4 digits' }]
        });
      }

      const pinHash = await bcrypt.hash(String(input.pin), BCRYPT_ROUNDS);
      const childAuthUser = await upsertChildAuthUser(tx, createdChild, pinHash);

      return tx.childProfile.update({
        where: { id: createdChild.id },
        data: {
          pin_hash: pinHash,
          pin_length: String(input.pin).length,
          auth_user_id: childAuthUser.id,
          metadata: {
            ...metadata,
            login_enabled: true,
            pin_last_changed_at: new Date().toISOString()
          }
        }
      });
    });
  } catch (error) {
    if (uploadedAvatar?.publicUrl) {
      await deleteChildAvatar(uploadedAvatar.publicUrl);
    }
    throw error;
  }

  return pickPublicChildProfile(childProfile);
}

async function updateChildProfileForUser(userId, childProfileId, input = {}, options = {}) {
  const existingChild = await findAccessibleChildProfile(userId, childProfileId, {
    requiredRoles: ['owner', 'admin', 'editor']
  });

  const updates = {};
  const metadataUpdates = {};

  if (input.first_name !== undefined) {
    const firstName = normalizeNullableString(input.first_name);
    if (!firstName || firstName.length < 2 || firstName.length > 50) {
      throw ApiError.badRequest('First name must be between 2 and 50 characters', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'first_name', message: 'Must be between 2 and 50 characters' }]
      });
    }
    updates.first_name = firstName;
  }

  if (input.last_name !== undefined) {
    const lastName = normalizeNullableString(input.last_name);
    if (!lastName || lastName.length < 2 || lastName.length > 50) {
      throw ApiError.badRequest('Last name must be between 2 and 50 characters', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'last_name', message: 'Must be between 2 and 50 characters' }]
      });
    }
    updates.last_name = lastName;
  }

  if (input.child_name !== undefined || updates.first_name || updates.last_name) {
    updates.name = normalizeNullableString(input.child_name) ||
      `${updates.first_name || existingChild.first_name || ''} ${updates.last_name || existingChild.last_name || ''}`.trim();
  }

  if (input.display_name !== undefined) updates.display_name = normalizeNullableString(input.display_name);
  if (input.date_of_birth !== undefined || input.birth_date !== undefined) {
    const rawBirthDate = input.date_of_birth || input.birth_date;
    const parsedBirthDate = parseDateOnly(rawBirthDate);
    if (rawBirthDate && (!parsedBirthDate || parsedBirthDate > new Date() || parsedBirthDate.getUTCFullYear() < 1900)) {
      throw ApiError.badRequest('Date of birth cannot be in the future', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'date_of_birth', message: 'Date of birth cannot be in the future' }]
      });
    }
    updates.birth_date = parsedBirthDate;
  }
  if (input.sex !== undefined || input.gender !== undefined) updates.gender = normalizeNullableString(input.sex || input.gender);
  if (input.email !== undefined) updates.email = normalizeNullableString(input.email);
  if (input.family_role !== undefined) updates.family_role = normalizeChildFamilyRole(input.family_role);

  if (input.username !== undefined) {
    const username = normalizeChildUsername(input.username);
    if (username.length < 3) {
      throw ApiError.badRequest('Username must be at least 3 characters', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'username', message: 'Must be at least 3 characters' }]
      });
    }

    if (username.toLowerCase() !== String(existingChild.username || '').toLowerCase()) {
      const usernameCheck = await checkChildUsernameAvailability(username);
      if (!usernameCheck.available) {
        throw new ApiError(HTTP_STATUS.CONFLICT, usernameCheck.message, {
          code: ERROR_CODES.CONFLICT
        });
      }
    }
    updates.username = username;
  }

  if (input.pin !== undefined) {
    if (!/^\d{4}$/.test(String(input.pin))) {
      throw ApiError.badRequest('PIN must be exactly 4 digits', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'pin', message: 'Must be exactly 4 digits' }]
      });
    }

    updates.pin_hash = await bcrypt.hash(String(input.pin), BCRYPT_ROUNDS);
  }

  ['notes', 'daily_spending_limit', 'weekly_spending_limit', 'monthly_spending_limit', 'phone', 'address', 'group_name', 'tags', 'visible_for_everyone', 'is_visible_by_unique_id'].forEach((field) => {
    if (input[field] !== undefined) metadataUpdates[field] = input[field] ?? null;
  });

  if (input.login_enabled !== undefined) metadataUpdates.login_enabled = Boolean(input.login_enabled);

  if (input.current_permission_level !== undefined || input.permission_level !== undefined) {
    const permissionLevel = Number(input.current_permission_level ?? input.permission_level);
    if (!Number.isInteger(permissionLevel) || permissionLevel < 1 || permissionLevel > 3) {
      throw ApiError.badRequest('Permission level must be between 1 and 3', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'current_permission_level', message: 'Must be between 1 and 3' }]
      });
    }

    metadataUpdates.current_permission_level = permissionLevel;
    if (input.permission_level_change_reason !== undefined) {
      metadataUpdates.permission_level_change_reason = input.permission_level_change_reason || null;
      metadataUpdates.permission_level_changed_at = new Date().toISOString();
    }
  }

  const uploadedAvatar = options.avatarFile
    ? await uploadChildAvatar(options.avatarFile, {
      userId,
      profileId: existingChild.parent_profile_id,
      publicFilesBaseUrl: options.publicFilesBaseUrl
    })
    : null;
  const shouldRemoveAvatar = input.remove_avatar === true || input.removeAvatar === true;
  const avatarInput = uploadedAvatar?.publicUrl || (!shouldRemoveAvatar ? resolveChildAvatarUrl(input.avatar, input.avatar_url) : null);
  const hasAvatarUpdate = Boolean(uploadedAvatar) || shouldRemoveAvatar || input.avatar !== undefined || input.avatar_url !== undefined;

  if (hasAvatarUpdate) {
    updates.avatar_url = avatarInput || null;
    metadataUpdates.avatar = shouldRemoveAvatar ? null : avatarInput || null;
  }

  if (Object.keys(metadataUpdates).length > 0) {
    const existingMetadata = existingChild.metadata && typeof existingChild.metadata === 'object' && !Array.isArray(existingChild.metadata)
      ? existingChild.metadata
      : {};
    updates.metadata = {
      ...existingMetadata,
      ...metadataUpdates
    };
  }

  if (Object.keys(updates).length === 0) {
    throw ApiError.badRequest('No child profile updates were provided', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  let updatedChild;
  try {
    updatedChild = await prisma.$transaction(async (tx) => {
      const child = await tx.childProfile.update({
        where: { id: existingChild.id },
        data: updates
      });

      if (updates.pin_hash) await upsertChildAuthUser(tx, child, updates.pin_hash);

      await createNotificationsForProfile([{
        profile_id: child.parent_profile_id,
        recipient_user_id: child.auth_user_id,
        source: "child_profile",
        source_id: child.id,
        event_type: "child_profile.updated",
        delivery_key: `child_profile:updated:${child.id}:${Date.now()}:parent:${child.parent_profile_id}`,
        title: "Child Profile Updated",
        body: "The profile has been updated. Please review the changes.",
        action_url: "/Dashboard",
        priority: "normal",
        metadata: {
          child_profile_id: child.id,
          parent_profile_id: child.parent_profile_id,
          updated_fields: Object.keys(updates)
        }
      }], { tx });

      return child;
    });
  } catch (error) {
    if (uploadedAvatar?.publicUrl) {
      await deleteChildAvatar(uploadedAvatar.publicUrl);
    }
    throw error;
  }

  if (hasAvatarUpdate && existingChild.avatar_url && existingChild.avatar_url !== updatedChild.avatar_url) {
    await deleteChildAvatar(existingChild.avatar_url);
  }

  return pickPublicChildProfile(updatedChild);
}

async function verifyChildPinForParent(userId, childProfileId, pin) {
  const childProfile = await findAccessibleChildProfile(userId, childProfileId, {
    requiredRoles: ['owner', 'admin', 'editor']
  });
  const metadata = childProfile.metadata && typeof childProfile.metadata === 'object' && !Array.isArray(childProfile.metadata)
    ? childProfile.metadata
    : {};

  if (!metadata.login_enabled) {
    await logChildLoginAttempt(childProfile.id, false, 'Login not enabled');
    throw ApiError.badRequest('Login is not enabled for this account');
  }

  if (childProfile.locked_until && childProfile.locked_until > new Date()) {
    await logChildLoginAttempt(childProfile.id, false, 'Account locked');
    throw ApiError.badRequest('Account is locked');
  }

  if (!childProfile.pin_hash) {
    await logChildLoginAttempt(childProfile.id, false, 'No PIN set');
    throw ApiError.badRequest('No PIN has been set for this account');
  }

  const pinMatches = await bcrypt.compare(String(pin || ''), childProfile.pin_hash);
  let childProfileUpdates;
  let failedAttempts = 0;

  const result = await prisma.$transaction(async (tx) => {
    if (!pinMatches) {
      failedAttempts = childProfile.failed_login_attempts + 1;
      childProfileUpdates = {
        failed_login_attempts: failedAttempts,
        locked_until: failedAttempts >= 5 ? new Date(Date.now() + 24 * 60 * 60 * 1000) : null
      }
      await logChildLoginAttempt(childProfile.id, false, `Invalid PIN attempt ${failedAttempts}`, tx);

    } else {
      childProfileUpdates = {
        failed_login_attempts: 0,
        locked_until: null,
        last_login_at: new Date()
      }
      await logChildLoginAttempt(childProfile.id, true, null, tx);
    }

    await tx.childProfile.update({
      where: { id: childProfile.id },
      data: childProfileUpdates
    });

    return {
      verified: pinMatches,
      failedAttempts: failedAttempts,
      accountLocked: pinMatches
    };
  });

  return { ...result };
}

async function unlockChildAccountForUser(userId, childProfileId) {
  const childProfile = await findAccessibleChildProfile(userId, childProfileId, {
    requiredRoles: ['owner', 'admin', 'editor']
  });

  const updatedChild = await prisma.childProfile.update({
    where: { id: childProfile.id },
    data: {
      failed_login_attempts: 0,
      locked_until: null
    }
  });

  return pickPublicChildProfile(updatedChild);
}

async function checkChildUsernameAvailability(username) {
  const normalizedUsername = normalizeChildUsername(username);

  if (normalizedUsername.length < 3) {
    return {
      available: false,
      message: 'Username must be at least 3 characters'
    };
  }

  const existing = await prisma.childProfile.findFirst({
    where: {
      username: {
        equals: normalizedUsername,
        mode: 'insensitive'
      },
      deleted_at: null
    },
    select: {
      id: true
    }
  });

  return {
    available: !existing,
    message: existing ? 'Username is already taken' : 'Username is available'
  };
}

async function setActiveProfileForUser(userId, profileId, childProfileId = undefined) {
  const existing = await prisma.userSetting.findUnique({
    where: { user_id: userId }
  });
  const settings = {
    ...(existing?.settings && typeof existing.settings === 'object' && !Array.isArray(existing.settings)
      ? existing.settings
      : {}),
    activeProfileId: profileId
  };
  if (childProfileId !== undefined) {
    settings.activeChildProfileId = childProfileId || null;
  }

  await prisma.userSetting.upsert({
    where: { user_id: userId },
    create: {
      user_id: userId,
      settings
    },
    update: {
      settings
    }
  });
}

async function clearActiveProfileForUser(userId) {
  const existing = await prisma.userSetting.findUnique({
    where: { user_id: userId }
  });

  if (!existing?.settings || typeof existing.settings !== 'object' || Array.isArray(existing.settings)) {
    return;
  }

  const { activeProfileId: _activeProfileId, ...settings } = existing.settings;

  await prisma.userSetting.update({
    where: { user_id: userId },
    data: { settings }
  });
}

async function findDefaultProfile(userId) {
  return prisma.profile.findFirst({
    where: {
      owner_user_id: userId,
      deleted_at: null,
      is_default: true,
      is_active: true
    }
  });
}

async function findMembership(userId, profileId) {
  const membership = await prisma.profileMembership.findFirst({
    where: {
      user_id: userId,
      profile_id: profileId
    },
    include: {
      profile: true
    }
  });

  if (!membership || membership.profile.deleted_at || !membership.profile.is_active) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Profile not found', {
      code: ERROR_CODES.PROFILE_NOT_FOUND
    });
  }

  return membership;
}

async function findAccessibleChildProfile(userId, childProfileId, options = {}) {
  const roleFilter = options.requiredRoles
    ? { role: { in: options.requiredRoles } }
    : {};
  const childCanAccess = options.childCanAccess !== false && !options.requiredRoles;

  const childProfile = await prisma.childProfile.findFirst({
    where: {
      id: childProfileId,
      deleted_at: null,
      is_active: true,
      OR: [
        {
          parent_profile: {
            deleted_at: null,
            is_active: true,
            memberships: {
              some: {
                user_id: userId,
                ...roleFilter
              }
            }
          }
        },
        ...(childCanAccess ? [{ auth_user_id: userId }] : [])
      ]
    }
  });

  if (!childProfile) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Child profile not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  if (
    childProfile &&
    childCanAccess &&
    childProfile.auth_user_id === userId &&
    childProfile.parent_profile_id
  ) {
    const parentProfile = await prisma.profile.findFirst({
      where: {
        id: childProfile.parent_profile_id,
        deleted_at: null,
        is_active: true
      },
      select: {
        id: true
      }
    });

    if (!parentProfile) {
      throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Child profile not found', {
        code: ERROR_CODES.NOT_FOUND
      });
    }
  }

  return childProfile;
}

function pickPublicProfile(profile) {
  if (!profile) {
    return null;
  }

  return {
    id: profile.id,
    owner_user_id: profile.owner_user_id,
    unique_id: profile.unique_id,
    name: profile.name,
    display_name: profile.display_name,
    profile_type: profile.profile_type,
    family_role: profile.family_role,
    avatar_url: normalizePublicFileUrl(profile.avatar_url),
    color: profile.color,
    is_default: profile.is_default,
    is_active: profile.is_active,
    metadata: profile.metadata,
    created_at: profile.created_at,
    updated_at: profile.updated_at
  };
}

async function upsertChildAuthUser(db, childProfile, passwordHash) {
  const childEmail = `child_${childProfile.id}@firstsavvy.internal`;
  const fullName = childProfile.display_name || childProfile.name ||
    [childProfile.first_name, childProfile.last_name].filter(Boolean).join(' ').trim() ||
    childProfile.username ||
    'Child';
  const userName = (childProfile.username || `child_${childProfile.id.replace(/-/g, '').slice(0, 12)}`).slice(0, 40);

  if (childProfile.auth_user_id) {
    return db.user.update({
      where: { id: childProfile.auth_user_id },
      data: {
        email: childEmail,
        user_name: userName,
        full_name: fullName,
        password_hash: passwordHash,
        verified_at: new Date(),
        deleted_at: null
      }
    });
  }

  return db.user.upsert({
    where: { email: childEmail },
    create: {
      unique_id: generateUniqueId(),
      email: childEmail,
      user_name: userName,
      full_name: fullName,
      password_hash: passwordHash,
      verified_at: new Date()
    },
    update: {
      user_name: userName,
      full_name: fullName,
      password_hash: passwordHash,
      verified_at: new Date(),
      deleted_at: null
    }
  });
}

async function getPendingTaskCompletionCounts(childProfileIds) {
  if (!childProfileIds.length) {
    return {};
  }

  const groups = await prisma.taskCompletion.groupBy({
    by: ['child_profile_id'],
    where: {
      child_profile_id: { in: childProfileIds },
      status: 'pending'
    },
    _count: {
      _all: true
    }
  });

  return groups.reduce((counts, group) => {
    counts[group.child_profile_id] = group._count._all;
    return counts;
  }, {});
}

function normalizeChildUsername(username) {
  return String(username || '').trim().toLowerCase();
}

function normalizeNullableString(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeChildFamilyRole(value) {
  const role = normalizeNullableString(value) || 'child';

  if (!CHILD_FAMILY_ROLES.has(role)) {
    throw ApiError.badRequest('Unsupported family role', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'family_role', message: 'Unsupported family role' }]
    });
  }

  return role;
}

function parseDateOnly(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function resolveChildAvatarUrl(avatar, fallbackAvatarUrl) {
  if (fallbackAvatarUrl && !String(fallbackAvatarUrl).startsWith('data:')) return fallbackAvatarUrl;
  if (!avatar || typeof avatar !== 'object') return null;
  // Never persist base64 data URLs in the DB; images must be uploaded to S3 as files
  const isDataUrl = (v) => typeof v === 'string' && v.startsWith('data:');
  if (avatar.imageUrl && !isDataUrl(avatar.imageUrl)) return avatar.imageUrl;
  if (avatar.value && !isDataUrl(avatar.value) && avatar.type !== 'color' && avatar.type !== 'preset') return avatar.value;
  if (avatar.type === 'color' && avatar.value) return `color:${avatar.value}`;
  if (avatar.type === 'preset' && avatar.value) return `preset:${avatar.value}`;
  if (avatar.color) return `color:${avatar.color}`;
  return null;
}

async function uploadChildAvatar(file, context) {
  if (!file?.buffer?.length) return null;

  const contentType = file.mimetype || file.contentType || 'application/octet-stream';
  const fileName = file.originalname || file.originalName || 'child-avatar';

  if (!String(contentType).toLowerCase().startsWith('image/')) {
    throw ApiError.badRequest('Child avatar must be an image file', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'avatar', message: 'Must be an image file' }]
    });
  }

  if (file.size > CHILD_AVATAR_MAX_BYTES) {
    throw ApiError.badRequest('Child avatar is too large', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'avatar', message: 'Must be 5MB or smaller' }]
    });
  }

  return uploadPublicObject({
    category: 'child-avatars',
    profileId: context.profileId,
    fileName,
    contentType,
    fileSize: file.size,
    body: file.buffer
  }, {
    userId: context.userId,
    publicFilesBaseUrl: context.publicFilesBaseUrl
  });
}

async function deleteChildAvatar(avatarUrl) {
  const key = extractKeyFromPublicUrl(avatarUrl);
  if (!key) return;

  try {
    await deleteObject(key);
  } catch (error) {
    console.error('Failed to delete child avatar:', error);
  }
}

async function logChildLoginAttempt(childProfileId, success, failureReason = null, db = prisma) {
  await db.childLoginAuditLog.create({
    data: {
      child_profile_id: childProfileId,
      success,
      failure_reason: failureReason
    }
  });
}

function pickPublicChildProfile(childProfile) {
  if (!childProfile) {
    return null;
  }

  const metadata = childProfile.metadata && typeof childProfile.metadata === 'object' && !Array.isArray(childProfile.metadata)
    ? childProfile.metadata
    : {};
  const fullName = childProfile.name ||
    [childProfile.first_name, childProfile.last_name].filter(Boolean).join(' ').trim() ||
    childProfile.display_name ||
    childProfile.username ||
    'Child';
  const permissionLevel = Number(metadata.current_permission_level || metadata.permission_level || 1);
  const birthDate = childProfile.birth_date
    ? childProfile.birth_date.toISOString().slice(0, 10)
    : null;

  return {
    id: childProfile.id,
    parent_profile_id: childProfile.parent_profile_id,
    parent_user_id: childProfile.parent_user_id,
    unique_id: childProfile.unique_id,
    auth_user_id: childProfile.auth_user_id,
    user_id: childProfile.auth_user_id,
    first_name: childProfile.first_name,
    last_name: childProfile.last_name,
    name: fullName,
    child_name: fullName,
    display_name: childProfile.display_name || fullName,
    email: childProfile.email,
    username: childProfile.username,
    birth_date: birthDate,
    date_of_birth: birthDate,
    gender: childProfile.gender,
    sex: childProfile.gender,
    avatar_url: normalizePublicFileUrl(childProfile.avatar_url),
    profile_level: childProfile.profile_level,
    current_permission_level: permissionLevel,
    permission_level: permissionLevel,
    family_role: childProfile.family_role,
    points_balance: childProfile.points_balance,
    cash_balance: Number(childProfile.cash_balance || 0),
    stars_balance: childProfile.stars_balance,
    stars_pending: childProfile.stars_pending,
    notes: metadata.notes || '',
    login_enabled: Boolean(metadata.login_enabled),
    visible_for_everyone: Boolean(metadata.visible_for_everyone || metadata.is_visible_by_unique_id || false),
    is_visible_by_unique_id: Boolean(metadata.visible_for_everyone || metadata.is_visible_by_unique_id || false),
    account_locked: Boolean(childProfile.locked_until && childProfile.locked_until > new Date()),
    is_active: childProfile.is_active,
    metadata,
    created_at: childProfile.created_at,
    updated_at: childProfile.updated_at
  };
}

module.exports = {
  listProfilesForUser,
  getProfileForUser,
  createProfileForUser,
  updateProfileForUser,
  deleteProfileForUser,
  switchProfileForUser,
  getActiveProfileForUser,
  getDirectChildProfileForUser,
  listChildProfilesForProfile,
  listAccessibleChildProfilesForUser,
  getChildProfileForUser,
  deleteChildProfileForUser,
  createChildProfileForProfile,
  updateChildProfileForUser,
  verifyChildPinForParent,
  unlockChildAccountForUser,
  checkChildUsernameAvailability,
};
