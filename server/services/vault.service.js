const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { createNotificationForUser } = require('./notification.service');

const VAULT_CATEGORIES = new Set(['login', 'card', 'note', 'identity']);
const SHARE_PERMISSIONS = new Set(['view', 'edit']);
const ENCRYPTED_VALUE_PREFIX = 'fs-vault:v1:';
const ENCRYPTED_FIELDS = ['username', 'password', 'notes', 'custom_fields'];

async function listVaultItemsForProfile(profileId, userId, query = {}) {
  const includeShared = parseBoolean(query.includeShared, true);
  const includeDeleted = parseBoolean(query.includeDeleted, true);

  const ownWhere = {
    profile_id: profileId,
    user_id: userId,
    ...(includeDeleted ? {} : { deleted_at: null })
  };

  const sharedWhere = {
    shared_with_user_id: userId,
    revoked_at: null,
    OR: [
      { expires_at: null },
      { expires_at: { gt: new Date() } }
    ],
    vault_item: {
      deleted_at: null
    }
  };

  const [items, shares] = await Promise.all([
    prisma.vaultItem.findMany({
      where: ownWhere,
      orderBy: { created_at: 'desc' }
    }),
    includeShared
      ? prisma.vaultShare.findMany({
        where: sharedWhere,
        include: { vault_item: true },
        orderBy: { created_at: 'desc' }
      })
      : []
  ]);

  return {
    items: [
      ...items.map((item) => pickPublicVaultItem(item)),
      ...shares.map((share) => pickPublicVaultItem(share.vault_item, share))
    ]
  };
}

async function getVaultItemForUser(itemId, userId) {
  const { item, share } = await findAccessibleVaultItem(itemId, userId);
  return pickPublicVaultItem(item, share);
}

async function createVaultItemForProfile(profileId, userId, input = {}) {
  const data = buildVaultItemData(input);
  requireEncryptedPayload(data);

  if (!data.name) {
    throwValidationError('name', 'Vault item name is required');
  }

  if (!VAULT_CATEGORIES.has(data.category)) {
    throwValidationError('category', 'Vault category must be login, card, note, or identity');
  }

  await ensureFolderBelongsToProfile(profileId, data.folder_id);

  const item = await prisma.vaultItem.create({
    data: {
      profile_id: profileId,
      user_id: userId,
      ...data
    }
  });

  return pickPublicVaultItem(item);
}

async function updateVaultItemForUser(itemId, userId, input = {}) {
  const { item, share } = await findAccessibleVaultItem(itemId, userId);

  if (item.user_id !== userId && share?.permission !== 'edit') {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Vault item access denied', {
      code: ERROR_CODES.FORBIDDEN
    });
  }

  const data = buildVaultItemData(input, { partial: true });
  requireEncryptedPayload(data);

  if (data.category && !VAULT_CATEGORIES.has(data.category)) {
    throwValidationError('category', 'Vault category must be login, card, note, or identity');
  }

  if (data.name !== undefined && !data.name) {
    throwValidationError('name', 'Vault item name cannot be blank');
  }

  await ensureFolderBelongsToProfile(item.profile_id, data.folder_id);

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest('No vault item updates were provided', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const updatedItem = await prisma.vaultItem.update({
    where: { id: itemId },
    data
  });

  return pickPublicVaultItem(updatedItem, share);
}

async function softDeleteVaultItemForUser(itemId, userId) {
  await findOwnedVaultItem(itemId, userId);
  await prisma.vaultItem.update({
    where: { id: itemId },
    data: { deleted_at: new Date() }
  });

  return { deleted: true };
}

async function restoreVaultItemForUser(itemId, userId) {
  const item = await findOwnedVaultItem(itemId, userId, { includeDeleted: true });
  const restoredItem = await prisma.vaultItem.update({
    where: { id: item.id },
    data: { deleted_at: null }
  });

  return pickPublicVaultItem(restoredItem);
}

async function permanentlyDeleteVaultItemForUser(itemId, userId) {
  await findOwnedVaultItem(itemId, userId, { includeDeleted: true });
  await prisma.vaultItem.delete({ where: { id: itemId } });

  return { deleted: true, permanent: true };
}

async function listVaultFoldersForProfile(profileId) {
  const folders = await prisma.vaultFolder.findMany({
    where: { profile_id: profileId },
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }]
  });

  return { folders: folders.map(pickPublicVaultFolder) };
}

async function createVaultFolderForProfile(profileId, input = {}) {
  const data = buildVaultFolderData(input);

  if (!data.name) {
    throwValidationError('name', 'Folder name is required');
  }

  await ensureFolderBelongsToProfile(profileId, data.parent_folder_id);

  const folder = await prisma.vaultFolder.create({
    data: {
      profile_id: profileId,
      ...data
    }
  });

  return pickPublicVaultFolder(folder);
}

async function updateVaultFolderForProfile(profileId, folderId, input = {}) {
  await findVaultFolder(profileId, folderId);
  const data = buildVaultFolderData(input, { partial: true });

  if (data.name !== undefined && !data.name) {
    throwValidationError('name', 'Folder name cannot be blank');
  }

  await ensureFolderBelongsToProfile(profileId, data.parent_folder_id, { excludeFolderId: folderId });

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest('No folder updates were provided', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const folder = await prisma.vaultFolder.update({
    where: { id: folderId },
    data
  });

  return pickPublicVaultFolder(folder);
}

async function deleteVaultFolderForProfile(profileId, folderId) {
  await findVaultFolder(profileId, folderId);
  await prisma.vaultFolder.delete({ where: { id: folderId } });

  return { deleted: true };
}

async function shareVaultItemForUser(itemId, userId, input = {}) {
  const item = await findOwnedVaultItem(itemId, userId);

  const shareEmail = normalizeNullableString(input.email)?.toLowerCase();
  let sharedWithUserId = input.userId || input.user_id || input.shared_with_user_id;
  const permission = input.permission || 'view';

  if (!sharedWithUserId && !shareEmail) {
    throwValidationError('email', 'User email or ID to share with is required');
  }

  if (!SHARE_PERMISSIONS.has(permission)) {
    throwValidationError('permission', 'Share permission must be view or edit');
  }

  const targetUser = await prisma.user.findFirst({
    where: {
      deleted_at: null,
      ...(sharedWithUserId
        ? { id: sharedWithUserId }
        : { email: { equals: shareEmail, mode: 'insensitive' } })
    },
    select: { id: true, email: true, full_name: true, avatar_url: true }
  });

  if (!targetUser) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.USER_NOT_FOUND
    });
  }

  sharedWithUserId = targetUser.id;

  if (sharedWithUserId === userId) {
    throw ApiError.badRequest('Vault items cannot be shared with yourself', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const share = await prisma.$transaction(async (tx) => {
    const upsertedShare = await tx.vaultShare.upsert({
      where: {
        vault_item_id_shared_with_user_id: {
          vault_item_id: itemId,
          shared_with_user_id: sharedWithUserId
        }
      },
      update: {
        permission,
        expires_at: input.expires_at ? new Date(input.expires_at) : null,
        revoked_at: null
      },
      create: {
        vault_item_id: itemId,
        shared_by_user_id: userId,
        shared_with_user_id: sharedWithUserId,
        permission,
        expires_at: input.expires_at ? new Date(input.expires_at) : null
      }
    });

    await createNotificationForUser(sharedWithUserId, {
      source: 'vault',
      source_id: itemId,
      event_type: 'vault.item_shared',
      delivery_key: `vault:item_shared:${itemId}:${sharedWithUserId}`,
      title: 'Vault item shared',
      body: `${item.name} was shared with you.`,
      action_url: '/PasswordVault',
      priority: 'high',
      metadata: {
        vault_item_id: itemId,
        shared_by_user_id: userId,
        permission
      }
    }, { db: tx });

    return upsertedShare;
  });

  return pickPublicVaultShare({
    ...share,
    shared_with: targetUser
  });
}

async function revokeVaultShareForUser(shareId, userId) {
  const share = await prisma.vaultShare.findFirst({
    where: {
      id: shareId,
      shared_by_user_id: userId,
      revoked_at: null
    },
    include: { vault_item: true }
  });

  if (!share) {
    throw ApiError.notFound('Vault share not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.vaultShare.update({
      where: { id: shareId },
      data: { revoked_at: new Date() }
    });

    await createNotificationForUser(share.shared_with_user_id, {
      source: 'vault',
      source_id: share.vault_item_id,
      event_type: 'vault.share_revoked',
      delivery_key: `vault:share_revoked:${shareId}`,
      title: 'Vault access removed',
      body: `Access to ${share.vault_item?.name || 'a vault item'} was removed.`,
      action_url: '/PasswordVault',
      priority: 'normal',
      metadata: {
        vault_item_id: share.vault_item_id,
        share_id: shareId,
        revoked_by_user_id: userId
      }
    }, { db: tx });
  });

  return { revoked: true };
}

async function listVaultSharesForItem(itemId, userId) {
  await findOwnedVaultItem(itemId, userId);

  const shares = await prisma.vaultShare.findMany({
    where: {
      vault_item_id: itemId,
      revoked_at: null
    },
    include: {
      shared_with: {
        select: {
          id: true,
          email: true,
          full_name: true,
          avatar_url: true
        }
      }
    },
    orderBy: { created_at: 'desc' }
  });

  return { shares: shares.map(pickPublicVaultShare) };
}

async function listVaultSharesForRecipient(userId) {
  const shares = await prisma.vaultShare.findMany({
    where: {
      shared_with_user_id: userId,
      revoked_at: null,
      OR: [
        { expires_at: null },
        { expires_at: { gt: new Date() } }
      ],
      vault_item: {
        deleted_at: null
      }
    },
    include: {
      vault_item: true,
      shared_by: {
        select: {
          id: true,
          email: true,
          full_name: true,
          avatar_url: true
        }
      }
    },
    orderBy: { created_at: 'desc' }
  });

  return { shares: shares.map(pickPublicVaultShare) };
}

async function cleanupExpiredVaultTrash() {
  const result = await prisma.vaultItem.deleteMany({
    where: {
      deleted_at: {
        lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      }
    }
  });

  return { deletedCount: result.count };
}

async function findAccessibleVaultItem(itemId, userId) {
  const item = await prisma.vaultItem.findFirst({
    where: {
      id: itemId,
      deleted_at: null
    }
  });

  if (!item) {
    throw ApiError.notFound('Vault item not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  if (item.user_id === userId) {
    return { item, share: null };
  }

  const share = await prisma.vaultShare.findFirst({
    where: {
      vault_item_id: itemId,
      shared_with_user_id: userId,
      revoked_at: null,
      OR: [
        { expires_at: null },
        { expires_at: { gt: new Date() } }
      ]
    }
  });

  if (!share) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Vault item access denied', {
      code: ERROR_CODES.FORBIDDEN
    });
  }

  return { item, share };
}

async function findOwnedVaultItem(itemId, userId, options = {}) {
  const item = await prisma.vaultItem.findFirst({
    where: {
      id: itemId,
      user_id: userId,
      ...(options.includeDeleted ? {} : { deleted_at: null })
    }
  });

  if (!item) {
    throw ApiError.notFound('Vault item not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return item;
}

async function findVaultFolder(profileId, folderId) {
  const folder = await prisma.vaultFolder.findFirst({
    where: {
      id: folderId,
      profile_id: profileId
    }
  });

  if (!folder) {
    throw ApiError.notFound('Vault folder not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return folder;
}

async function ensureFolderBelongsToProfile(profileId, folderId, options = {}) {
  if (folderId === undefined || folderId === null) return;

  if (folderId === options.excludeFolderId) {
    throw ApiError.badRequest('A folder cannot be its own parent', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  await findVaultFolder(profileId, folderId);
}

function buildVaultItemData(input = {}, options = {}) {
  const data = {};
  const stringFields = ['category', 'name', 'url', 'username', 'password', 'notes', 'folder_id'];

  stringFields.forEach((field) => {
    if (input[field] !== undefined) {
      data[field] = normalizeNullableString(input[field]);
    }
  });

  if (input.custom_fields !== undefined) {
    data.custom_fields = input.custom_fields === null ? {} : input.custom_fields;
  }

  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) {
      throwValidationError('tags', 'Tags must be an array');
    }
    data.tags = input.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 50);
  } else if (!options.partial) {
    data.tags = [];
  }

  if (input.is_favorite !== undefined) {
    data.is_favorite = Boolean(input.is_favorite);
  } else if (!options.partial) {
    data.is_favorite = false;
  }

  return data;
}

function buildVaultFolderData(input = {}, options = {}) {
  const data = {};
  const stringFields = ['name', 'icon', 'color', 'parent_folder_id'];

  stringFields.forEach((field) => {
    if (input[field] !== undefined) {
      data[field] = normalizeNullableString(input[field]);
    }
  });

  if (input.sort_order !== undefined) {
    const sortOrder = Number(input.sort_order);
    data.sort_order = Number.isFinite(sortOrder) ? sortOrder : 0;
  } else if (!options.partial) {
    data.sort_order = 0;
  }

  return data;
}

function requireEncryptedPayload(data) {
  ENCRYPTED_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(data, field)) return;
    if (data[field] === null || data[field] === undefined) return;

    if (field === 'custom_fields') {
      if (data[field] === '{}') return;
      if (typeof data[field] === 'object' && !Array.isArray(data[field]) && Object.keys(data[field]).length === 0) return;
    }

    if (typeof data[field] !== 'string' || !data[field].startsWith(ENCRYPTED_VALUE_PREFIX)) {
      throw ApiError.badRequest('Vault payload fields must be encrypted before reaching the API', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{
          location: 'body',
          field,
          message: `Expected ${ENCRYPTED_VALUE_PREFIX} encrypted value`
        }]
      });
    }
  });
}

function pickPublicVaultItem(item, share = null) {
  return {
    id: item.id,
    profile_id: item.profile_id,
    user_id: item.user_id,
    folder_id: item.folder_id,
    category: item.category,
    name: item.name,
    url: item.url,
    username: item.username,
    password: item.password,
    notes: item.notes,
    custom_fields: item.custom_fields,
    tags: Array.isArray(item.tags) ? item.tags : [],
    is_favorite: Boolean(item.is_favorite),
    last_used_at: item.last_used_at,
    created_at: item.created_at,
    updated_at: item.updated_at,
    deleted_at: item.deleted_at,
    is_shared: Boolean(share),
    shared_permission: share?.permission || null
  };
}

function pickPublicVaultFolder(folder) {
  return {
    id: folder.id,
    profile_id: folder.profile_id,
    name: folder.name,
    icon: folder.icon,
    color: folder.color,
    parent_folder_id: folder.parent_folder_id,
    sort_order: folder.sort_order,
    created_at: folder.created_at,
    updated_at: folder.updated_at
  };
}

function pickPublicVaultShare(share) {
  return {
    id: share.id,
    vault_item_id: share.vault_item_id,
    shared_by_user_id: share.shared_by_user_id,
    shared_with_user_id: share.shared_with_user_id,
    permission: share.permission,
    expires_at: share.expires_at,
    revoked_at: share.revoked_at,
    created_at: share.created_at,
    vault_items: share.vault_item ? pickPublicVaultItem(share.vault_item, share) : undefined,
    shared_by: share.shared_by || undefined,
    shared_with: share.shared_with || undefined
  };
}

function parseBoolean(value, defaultValue) {
  if (value === undefined || value === null || value === '') return defaultValue;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes'].includes(String(value).toLowerCase());
}

function normalizeNullableString(value) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function throwValidationError(field, message) {
  throw ApiError.badRequest(message, {
    code: ERROR_CODES.VALIDATION_FAILED,
    details: [{ location: 'body', field, message }]
  });
}

module.exports = {
  listVaultItemsForProfile,
  getVaultItemForUser,
  createVaultItemForProfile,
  updateVaultItemForUser,
  softDeleteVaultItemForUser,
  restoreVaultItemForUser,
  permanentlyDeleteVaultItemForUser,
  listVaultFoldersForProfile,
  createVaultFolderForProfile,
  updateVaultFolderForProfile,
  deleteVaultFolderForProfile,
  shareVaultItemForUser,
  revokeVaultShareForUser,
  listVaultSharesForItem,
  listVaultSharesForRecipient,
  cleanupExpiredVaultTrash,
  pickPublicVaultItem
};
