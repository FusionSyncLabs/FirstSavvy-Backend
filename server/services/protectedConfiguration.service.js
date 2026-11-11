const crypto = require('crypto');
const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');

function generateHash(content) {
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

function normalizeEnvelope(configValue) {
  if (!configValue || typeof configValue !== 'object' || Array.isArray(configValue)) {
    return { configuration_data: configValue };
  }

  if (Object.prototype.hasOwnProperty.call(configValue, 'configuration_data')) {
    return configValue;
  }

  return { configuration_data: configValue };
}

function buildConfigValue(input = {}, existing = null) {
  const existingEnvelope = existing ? normalizeEnvelope(existing.config_value) : {};

  return {
    description: input.description ?? existingEnvelope.description ?? '',
    version: input.version ?? existingEnvelope.version ?? '1.0.0',
    file_paths: input.file_paths ?? existingEnvelope.file_paths ?? [],
    configuration_data: input.configuration_data ?? existingEnvelope.configuration_data ?? {},
    is_active: input.is_active ?? existingEnvelope.is_active ?? true
  };
}

function incrementVersion(currentVersion) {
  const parts = String(currentVersion || '1.0.0').split('.');
  const patch = Number.parseInt(parts[2] || '0', 10) + 1;
  return `${parts[0]}.${parts[1]}.${patch}`;
}

function pickPublicConfiguration(config) {
  if (!config) return null;

  const envelope = normalizeEnvelope(config.config_value);

  return {
    id: config.id,
    profile_id: config.profile_id,
    name: config.config_key,
    description: envelope.description || '',
    version: envelope.version || '1.0.0',
    content_hash: config.content_hash,
    configuration_data: envelope.configuration_data ?? {},
    file_paths: envelope.file_paths || [],
    is_locked: config.is_protected,
    is_active: envelope.is_active !== false,
    created_by: config.created_by,
    updated_by: config.updated_by,
    created_at: config.created_at,
    updated_at: config.updated_at
  };
}

function pickPublicChangeLog(entry) {
  const oldMeta = entry.old_value && typeof entry.old_value === 'object' ? entry.old_value : {};
  const newMeta = entry.new_value && typeof entry.new_value === 'object' ? entry.new_value : {};

  return {
    id: entry.id,
    configuration_id: entry.configuration_id,
    user_id: entry.changed_by,
    change_type: newMeta.change_type || oldMeta.change_type || 'update',
    old_version: oldMeta.version ?? null,
    new_version: newMeta.version ?? null,
    change_description: entry.reason,
    diff_data: newMeta.diff_data || (
      oldMeta.data || newMeta.data
        ? { old: oldMeta.data, new: newMeta.data }
        : null
    ),
    created_at: entry.created_at
  };
}

async function findConfiguration(profileId, configId) {
  const config = await prisma.protectedConfiguration.findFirst({
    where: {
      id: configId,
      profile_id: profileId
    }
  });

  if (!config) {
    throw ApiError.notFound('Configuration not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return config;
}

async function listConfigurationsForProfile(profileId) {
  const configs = await prisma.protectedConfiguration.findMany({
    where: { profile_id: profileId },
    orderBy: { config_key: 'asc' }
  });

  return {
    configurations: configs
      .map(pickPublicConfiguration)
      .filter((config) => config.is_active)
  };
}

async function getConfigurationByNameForProfile(profileId, name) {
  const config = await prisma.protectedConfiguration.findFirst({
    where: {
      profile_id: profileId,
      config_key: name
    }
  });

  const publicConfig = pickPublicConfiguration(config);
  if (!publicConfig || !publicConfig.is_active) {
    return { configuration: null };
  }

  return { configuration: publicConfig };
}

async function lockConfigurationForProfile(profileId, userId, configId) {
  await findConfiguration(profileId, configId);

  const config = await prisma.protectedConfiguration.update({
    where: { id: configId },
    data: {
      is_protected: true,
      updated_by: userId
    }
  });

  await createChangeLogEntry(profileId, userId, config, {
    change_type: 'lock',
    change_description: 'Configuration locked'
  });

  return { configuration: pickPublicConfiguration(config) };
}

async function unlockConfigurationForProfile(profileId, userId, configId) {
  await findConfiguration(profileId, configId);

  const config = await prisma.protectedConfiguration.update({
    where: { id: configId },
    data: {
      is_protected: false,
      updated_by: userId
    }
  });

  await createChangeLogEntry(profileId, userId, config, {
    change_type: 'unlock',
    change_description: 'Configuration unlocked'
  });

  return { configuration: pickPublicConfiguration(config) };
}

async function restoreConfigurationVersionForProfile(profileId, userId, configId, versionToRestore) {
  const oldConfig = await findConfiguration(profileId, configId);
  const oldPublic = pickPublicConfiguration(oldConfig);

  const changeLogs = await prisma.configurationChangeLog.findMany({
    where: {
      profile_id: profileId,
      configuration_id: configId
    },
    orderBy: { created_at: 'desc' }
  });

  const changeLog = changeLogs.find((entry) => {
    const publicEntry = pickPublicChangeLog(entry);
    return publicEntry.new_version === versionToRestore;
  });

  if (!changeLog) {
    throw ApiError.notFound('Version not found in change log', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  const publicEntry = pickPublicChangeLog(changeLog);
  const restoredData = publicEntry.diff_data?.new;
  if (!restoredData) {
    throw ApiError.notFound('Version not found in change log', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  const configValue = buildConfigValue({
    ...oldPublic,
    configuration_data: restoredData
  }, oldConfig);
  const newVersion = incrementVersion(oldPublic.version);
  const newHash = generateHash(restoredData);

  const config = await prisma.protectedConfiguration.update({
    where: { id: configId },
    data: {
      config_value: {
        ...configValue,
        version: newVersion
      },
      content_hash: newHash,
      updated_by: userId
    }
  });

  await createChangeLogEntry(profileId, userId, config, {
    change_type: 'restore',
    old_version: oldPublic.version,
    new_version: newVersion,
    change_description: `Restored to version ${versionToRestore}`,
    diff_data: {
      old: oldPublic.configuration_data,
      new: restoredData
    }
  });

  return { configuration: pickPublicConfiguration(config) };
}

async function getConfigurationHistoryForProfile(profileId, configId) {
  await findConfiguration(profileId, configId);

  const entries = await prisma.configurationChangeLog.findMany({
    where: {
      profile_id: profileId,
      configuration_id: configId
    },
    orderBy: { created_at: 'desc' }
  });

  return {
    history: entries.map(pickPublicChangeLog)
  };
}

async function logConfigurationChangeForProfile(profileId, userId, changeData = {}) {
  const config = changeData.configuration_id
    ? await findConfiguration(profileId, changeData.configuration_id)
    : null;

  await prisma.configurationChangeLog.create({
    data: {
      profile_id: profileId,
      configuration_id: changeData.configuration_id || null,
      config_key: config?.config_key || changeData.config_key || 'unknown',
      changed_by: userId,
      old_value: {
        change_type: changeData.change_type
      },
      new_value: {
        change_type: changeData.change_type,
        confirmed_at: changeData.confirmed_at || null
      },
      reason: changeData.change_description || null
    }
  });

  return { success: true };
}

async function createChangeLogEntry(profileId, userId, config, changeData = {}) {
  await prisma.configurationChangeLog.create({
    data: {
      profile_id: profileId,
      configuration_id: config.id,
      config_key: config.config_key,
      changed_by: userId,
      old_value: {
        version: changeData.old_version ?? null,
        data: changeData.diff_data?.old ?? null,
        change_type: changeData.change_type
      },
      new_value: {
        version: changeData.new_version ?? null,
        data: changeData.diff_data?.new ?? null,
        change_type: changeData.change_type,
        diff_data: changeData.diff_data ?? null
      },
      reason: changeData.change_description || null
    }
  });
}

module.exports = {
  listConfigurationsForProfile,
  getConfigurationByNameForProfile,
  lockConfigurationForProfile,
  unlockConfigurationForProfile,
  restoreConfigurationVersionForProfile,
  getConfigurationHistoryForProfile,
  logConfigurationChangeForProfile,
  incrementVersion
};
