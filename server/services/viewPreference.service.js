const { prisma } = require('../config/database');

async function getViewPreferenceForProfile(profileId, viewName) {
  const row = await prisma.profileViewPreference.findUnique({
    where: {
      profile_id_view_name: {
        profile_id: profileId,
        view_name: viewName
      }
    }
  });

  return row?.preferences || null;
}

async function saveViewPreferenceForProfile(profileId, viewName, preferences = {}) {
  const row = await prisma.profileViewPreference.upsert({
    where: {
      profile_id_view_name: {
        profile_id: profileId,
        view_name: viewName
      }
    },
    create: {
      profile_id: profileId,
      view_name: viewName,
      preferences
    },
    update: {
      preferences
    }
  });

  return row.preferences;
}

async function deleteViewPreferenceForProfile(profileId, viewName) {
  await prisma.profileViewPreference.deleteMany({
    where: {
      profile_id: profileId,
      view_name: viewName
    }
  });
  return { deleted: true };
}

async function deleteAllViewPreferencesForProfile(profileId) {
  await prisma.profileViewPreference.deleteMany({
    where: { profile_id: profileId }
  });
  return { deleted: true };
}

module.exports = {
  getViewPreferenceForProfile,
  saveViewPreferenceForProfile,
  deleteViewPreferenceForProfile,
  deleteAllViewPreferencesForProfile
};
