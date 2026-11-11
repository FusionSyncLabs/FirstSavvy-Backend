const { prisma } = require('../config/database');
const { ApiError } = require('./errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

const ROLE_RANK = Object.freeze({
  viewer: 1,
  child: 1,
  editor: 2,
  admin: 3,
  owner: 4
});

function authorizeProfile(options = {}) {
  const requiredRole = options.requiredRole || 'viewer';
  const sourcePaths = options.sourcePaths || [
    'params.profileId',
    'params.profile_id',
    'body.profileId',
    'body.profile_id',
    'query.profileId',
    'query.profile_id',
    'headers.x-profile-id'
  ];

  return async (req, _res, next) => {
    try {
      if (!req.auth?.sub) {
        throw new ApiError(HTTP_STATUS.UNAUTHORIZED, 'Authentication required', {
          code: ERROR_CODES.UNAUTHORIZED
        });
      }

      const profileId = getFirstValue(req, sourcePaths);

      if (!profileId) {
        throw ApiError.badRequest('Profile ID is required', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'profile', field: 'profileId', message: 'Required field is missing' }]
        });
      }

      req.profileAccess = await verifyProfileAccess({
        userId: req.auth.sub,
        profileId,
        requiredRole
      });

      return next();
    } catch (error) {
      return next(error);
    }
  };
}

async function verifyProfileAccess({ userId, profileId, requiredRole = 'viewer' }) {
  let membership = await prisma.profileMembership.findFirst({
    where: {
      user_id: userId,
      profile_id: profileId
    },
    include: {
      profile: true
    }
  });

  if (!membership) {
    const childProfile = await prisma.childProfile.findFirst({
      where: {
        id: profileId,
        deleted_at: null,
        is_active: true
      },
      include: {
        parent_profile: {
          include: {
            memberships: {
              where: {
                user_id: userId
              }
            }
          }
        }
      }
    });

    if (childProfile && childProfile.parent_profile?.memberships?.length > 0) {
      const parentMembership = childProfile.parent_profile.memberships[0];
      return {
        profileId: childProfile.parent_profile_id,
        childProfileId: childProfile.id,
        role: parentMembership.role,
        profile: childProfile.parent_profile
      };
    }

    try {
      const spouseLink = await prisma.childProfile.findFirst({
        where: {
          auth_user_id: userId,
          parent_profile_id: profileId,
          family_role: { in: ['spouse_partner', 'spouse', 'partner', 'co_owner', 'parent', 'co_parent', 'other'] },
          deleted_at: null,
          is_active: true
        },
        include: {
          parent_profile: true
        }
      });
      if (spouseLink && spouseLink.parent_profile) {
        return {
          profileId: spouseLink.parent_profile_id,
          role: 'owner',
          profile: spouseLink.parent_profile
        };
      }
    } catch (e) {}
  }

  if (!membership || membership.profile.deleted_at || !membership.profile.is_active) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'Profile not found', {
      code: ERROR_CODES.PROFILE_NOT_FOUND
    });
  }

  if (!roleMeetsRequirement(membership.role, requiredRole)) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Profile access denied', {
      code: ERROR_CODES.PROFILE_ACCESS_DENIED
    });
  }

  return {
    profileId: membership.profile_id,
    role: membership.role,
    profile: membership.profile
  };
}

function roleMeetsRequirement(actualRole, requiredRole) {
  return roleRank(actualRole) >= roleRank(requiredRole);
}

function roleRank(role) {
  return ROLE_RANK[role] || 0;
}

function getFirstValue(req, sourcePaths) {
  for (const sourcePath of sourcePaths) {
    const value = getValueAtPath(req, sourcePath);

    if (value) {
      return String(value);
    }
  }

  return null;
}

function getValueAtPath(source, path) {
  return path.split('.').reduce((value, key) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    return value[key];
  }, source);
}

module.exports = {
  authorizeProfile,
  verifyProfileAccess,
  roleMeetsRequirement
};
