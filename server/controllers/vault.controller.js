const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
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
  cleanupExpiredVaultTrash
} = require('../services/vault.service');

const listItems = asyncHandler(async (req, res) => {
  return ok(res, await listVaultItemsForProfile(req.profileAccess.profileId, req.auth.sub, req.query));
});

const getItem = asyncHandler(async (req, res) => {
  return ok(res, {
    item: await getVaultItemForUser(req.params.itemId, req.auth.sub)
  });
});

const createItem = asyncHandler(async (req, res) => {
  return created(res, {
    item: await createVaultItemForProfile(req.profileAccess.profileId, req.auth.sub, req.body)
  });
});

const updateItem = asyncHandler(async (req, res) => {
  return ok(res, {
    item: await updateVaultItemForUser(req.params.itemId, req.auth.sub, req.body)
  });
});

const deleteItem = asyncHandler(async (req, res) => {
  return ok(res, await softDeleteVaultItemForUser(req.params.itemId, req.auth.sub));
});

const restoreItem = asyncHandler(async (req, res) => {
  return ok(res, {
    item: await restoreVaultItemForUser(req.params.itemId, req.auth.sub)
  });
});

const permanentlyDeleteItem = asyncHandler(async (req, res) => {
  return ok(res, await permanentlyDeleteVaultItemForUser(req.params.itemId, req.auth.sub));
});

const listFolders = asyncHandler(async (req, res) => {
  return ok(res, await listVaultFoldersForProfile(req.profileAccess.profileId));
});

const createFolder = asyncHandler(async (req, res) => {
  return created(res, {
    folder: await createVaultFolderForProfile(req.profileAccess.profileId, req.body)
  });
});

const updateFolder = asyncHandler(async (req, res) => {
  return ok(res, {
    folder: await updateVaultFolderForProfile(req.profileAccess.profileId, req.params.folderId, req.body)
  });
});

const deleteFolder = asyncHandler(async (req, res) => {
  return ok(res, await deleteVaultFolderForProfile(req.profileAccess.profileId, req.params.folderId));
});

const shareItem = asyncHandler(async (req, res) => {
  return created(res, {
    share: await shareVaultItemForUser(req.params.itemId, req.auth.sub, req.body)
  });
});

const revokeShare = asyncHandler(async (req, res) => {
  return ok(res, await revokeVaultShareForUser(req.params.shareId, req.auth.sub));
});

const listItemShares = asyncHandler(async (req, res) => {
  return ok(res, await listVaultSharesForItem(req.params.itemId, req.auth.sub));
});

const listSharedWithMe = asyncHandler(async (req, res) => {
  return ok(res, await listVaultSharesForRecipient(req.auth.sub));
});

const cleanupTrash = asyncHandler(async (_req, res) => {
  return ok(res, await cleanupExpiredVaultTrash());
});

module.exports = {
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  restoreItem,
  permanentlyDeleteItem,
  listFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  shareItem,
  revokeShare,
  listItemShares,
  listSharedWithMe,
  cleanupTrash
};
