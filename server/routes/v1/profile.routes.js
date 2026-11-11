const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { fileUpload, normalizeMultipartFields } = require('../../middleware/upload');
const {
  listProfiles,
  getActiveProfile,
  getProfile,
  createProfile,
  updateProfile,
  deleteProfile,
  switchProfile,
  getDirectChildProfile,
  listProfileChildren,
  listAccessibleChildren,
  getChildProfile,
  listChildAchievements,
  deleteChildProfile,
  createChildProfile,
  updateChildProfile,
  verifyChildPin,
  unlockChildAccount,
  resetFinancialData,
  resetUserData,
  checkUsernameAvailability,
} = require('../../controllers/profile.controller');
const { seedDemoData } = require('../../controllers/demoSeed.controller');

const router = express.Router();

const childFamilyRoles = ['child', 'spouse_partner', 'parent', 'sibling', 'grandparent', 'other'];
const childAvatarUpload = [
  fileUpload('avatar', {
    maxBytes: 5 * 1024 * 1024,
    requireImage: true,
    tooLargeMessage: 'Uploaded image is too large'
  }),
  normalizeMultipartFields({
    booleanFields: ['login_enabled', 'remove_avatar', 'removeAvatar'],
    jsonFields: ['avatar', 'metadata']
  })
];

router.use(authenticate);

router.get('/', listProfiles);

router.get('/active', getActiveProfile);

router.get('/children/direct', getDirectChildProfile);

router.get('/children/username-check', checkUsernameAvailability);

router.get(
  '/children/accessible',
  validateRequest({
    query: {
      profileId: { type: 'string' }
    }
  }),
  listAccessibleChildren
);

router.get(
  '/children/:childId',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    },
    query: {
      includeStats: { type: 'string' }
    }
  }),
  getChildProfile
);

router.delete(
  '/children/:childId',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    }
  }),
  deleteChildProfile
);

router.patch(
  '/children/:childId',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    }
  }),
  ...childAvatarUpload,
  validateRequest({
    body: {
      first_name: { type: 'string', minLength: 2, maxLength: 50 },
      last_name: { type: 'string', minLength: 2, maxLength: 50 },
      child_name: { type: 'string', maxLength: 255 },
      display_name: { type: 'string', maxLength: 255 },
      date_of_birth: { type: 'string', maxLength: 10 },
      birth_date: { type: 'string', maxLength: 10 },
      sex: { type: 'string', maxLength: 50 },
      gender: { type: 'string', maxLength: 50 },
      username: { type: 'string', minLength: 3, maxLength: 100 },
      email: { type: 'string', email: true, maxLength: 320 },
      family_role: { type: 'string', enum: childFamilyRoles },
      notes: { type: 'string', maxLength: 10000 },
      login_enabled: { type: 'boolean' },
      pin: { type: 'string', minLength: 4, maxLength: 4 },
      current_permission_level: { type: 'number' },
      permission_level: { type: 'number' },
      permission_level_change_reason: { type: 'string', maxLength: 10000 },
      avatar_url: { type: 'string', maxLength: 10000000 },
      remove_avatar: { type: 'boolean' },
      removeAvatar: { type: 'boolean' },
      avatar: { type: 'object' }
    }
  }),
  updateChildProfile
);

router.post(
  '/children/:childId/verify-pin',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    },
    body: {
      pin: { required: true, type: 'string', minLength: 4, maxLength: 4 }
    }
  }),
  verifyChildPin
);

router.post(
  '/children/:childId/unlock',
  validateRequest({
    params: {
      childId: { required: true, type: 'string', uuid: true }
    }
  }),
  unlockChildAccount
);

router.post(
  '/',
  validateRequest({
    body: {
      name: { type: 'string', maxLength: 255 },
      displayName: { type: 'string', maxLength: 255 },
      profileType: {
        type: 'string',
        enum: ['personal', 'household', 'business', 'real_estate', 'passive', 'holding_company']
      },
      familyRole: { type: 'string', maxLength: 100 },
      color: { type: 'string', maxLength: 32 }
    }
  }),
  createProfile
);

router.get(
  '/:profileId',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile(),
  getProfile
);

router.get(
  '/:profileId/children',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    },
    query: {
      activeOnly: { type: 'string' },
      includePendingTaskCounts: { type: 'string' }
    }
  }),
  listProfileChildren
);

router.post(
  '/:profileId/children',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    }
  }),
  ...childAvatarUpload,
  validateRequest({
    body: {
      first_name: { required: true, type: 'string', minLength: 2, maxLength: 50 },
      last_name: { required: true, type: 'string', minLength: 2, maxLength: 50 },
      child_name: { type: 'string', maxLength: 255 },
      display_name: { type: 'string', maxLength: 255 },
      date_of_birth: { type: 'string', maxLength: 10 },
      birth_date: { type: 'string', maxLength: 10 },
      sex: { type: 'string', maxLength: 50 },
      gender: { type: 'string', maxLength: 50 },
      username: { type: 'string', minLength: 3, maxLength: 100 },
      email: { type: 'string', email: true, maxLength: 320 },
      family_role: { type: 'string', enum: childFamilyRoles },
      notes: { type: 'string', maxLength: 10000 },
      login_enabled: { type: 'boolean' },
      pin: { type: 'string', minLength: 4, maxLength: 4 },
      avatar: { type: 'object' }
    }
  }),
  createChildProfile
);

router.patch(
  '/:profileId',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    },
    body: {
      name: { type: 'string', maxLength: 255 },
      first_name: { type: 'string', maxLength: 100 },
      last_name: { type: 'string', maxLength: 100 },
      displayName: { type: 'string', maxLength: 255 },
      display_name: { type: 'string', maxLength: 255 },
      familyRole: { type: 'string', maxLength: 100 },
      color: { type: 'string', maxLength: 32 },
      avatarUrl: { type: 'string', maxLength: 10000000 },
      avatar_url: { type: 'string', maxLength: 10000000 },
      removeAvatar: { type: 'boolean' },
      remove_avatar: { type: 'boolean' },
      phone: { type: 'string', maxLength: 50 },
      bio: { type: 'string', maxLength: 500 },
      dob: { type: 'string', maxLength: 10 },
      occupation: { type: 'string', maxLength: 255 },
      income_range: { type: 'string', maxLength: 100 },
      financial_goal: { type: 'string', maxLength: 255 },
      household_name: { type: 'string', maxLength: 255 },
      householdName: { type: 'string', maxLength: 255 },
      tabSortOrder: { type: 'number' }
    }
  }),
  authorizeProfile(),
  updateProfile
);

router.delete(
  '/:profileId',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'owner' }),
  deleteProfile
);

router.post(
  '/:profileId/switch',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    },
    body: {
      childProfileId: { type: 'string', uuid: true },
      child_profile_id: { type: 'string', uuid: true }
    }
  }),
  authorizeProfile(),
  switchProfile
);

router.post(
  '/:profileId/reset-financial-data',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'owner' }),
  resetFinancialData
);

router.post(
  '/:profileId/reset-user-data',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'owner' }),
  resetUserData
);

router.post(
  '/:profileId/seed-demo-data',
  validateRequest({
    params: {
      profileId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'owner' }),
  seedDemoData
);

module.exports = router;
