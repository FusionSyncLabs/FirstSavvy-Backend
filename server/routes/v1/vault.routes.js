const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { requireVaultElevation } = require('../../middleware/requireVaultElevation');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const {
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
} = require('../../controllers/vault.controller');

const router = express.Router();

const itemBodySchema = {
  category: { type: 'string', enum: ['login', 'card', 'note', 'identity'] },
  name: { type: 'string', maxLength: 255 },
  url: { type: 'string', maxLength: 2048 },
  username: { type: 'string', maxLength: 10000 },
  password: { type: 'string', maxLength: 10000 },
  notes: { type: 'string', maxLength: 50000 },
  custom_fields: { type: 'string', maxLength: 50000 },
  folder_id: { type: 'string', uuid: true },
  tags: { type: 'array' },
  is_favorite: { type: 'boolean' }
};

const folderBodySchema = {
  name: { type: 'string', maxLength: 255 },
  icon: { type: 'string', maxLength: 100 },
  color: { type: 'string', maxLength: 32 },
  parent_folder_id: { type: 'string', uuid: true },
  sort_order: { type: 'number' }
};

router.use(authenticate);

router.get(
  '/items',
  validateRequest({
    query: {
      includeShared: { type: 'string' },
      includeDeleted: { type: 'string' }
    }
  }),
  authorizeProfile(),
  listItems
);

router.post(
  '/items',
  validateRequest({
    body: {
      ...itemBodySchema,
      category: { required: true, type: 'string', enum: ['login', 'card', 'note', 'identity'] },
      name: { required: true, type: 'string', maxLength: 255 }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  createItem
);

router.get('/shared-with-me', listSharedWithMe);
router.post('/trash/cleanup', cleanupTrash);

router.get(
  '/items/:itemId',
  validateRequest({ params: { itemId: { required: true, type: 'string', uuid: true } } }),
  getItem
);

router.patch(
  '/items/:itemId',
  validateRequest({
    params: { itemId: { required: true, type: 'string', uuid: true } },
    body: itemBodySchema
  }),
  requireVaultElevation({ onlyIfSensitiveBody: true }),
  updateItem
);

router.delete(
  '/items/:itemId',
  validateRequest({ params: { itemId: { required: true, type: 'string', uuid: true } } }),
  requireVaultElevation(),
  deleteItem
);

router.post(
  '/items/:itemId/restore',
  validateRequest({ params: { itemId: { required: true, type: 'string', uuid: true } } }),
  restoreItem
);

router.delete(
  '/items/:itemId/permanent',
  validateRequest({ params: { itemId: { required: true, type: 'string', uuid: true } } }),
  permanentlyDeleteItem
);

router.get(
  '/items/:itemId/shares',
  validateRequest({ params: { itemId: { required: true, type: 'string', uuid: true } } }),
  listItemShares
);

router.post(
  '/items/:itemId/shares',
  validateRequest({
    params: { itemId: { required: true, type: 'string', uuid: true } },
    body: {
      userId: { type: 'string', uuid: true },
      email: { type: 'string', email: true, maxLength: 320 },
      permission: { required: true, type: 'string', enum: ['view', 'edit'] },
      expires_at: { type: 'string', maxLength: 64 }
    }
  }),
  shareItem
);

router.post(
  '/shares/:shareId/revoke',
  validateRequest({ params: { shareId: { required: true, type: 'string', uuid: true } } }),
  revokeShare
);

router.get('/folders', authorizeProfile(), listFolders);

router.post(
  '/folders',
  validateRequest({
    body: {
      ...folderBodySchema,
      name: { required: true, type: 'string', maxLength: 255 }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  createFolder
);

router.patch(
  '/folders/:folderId',
  validateRequest({
    params: { folderId: { required: true, type: 'string', uuid: true } },
    body: folderBodySchema
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  updateFolder
);

router.delete(
  '/folders/:folderId',
  validateRequest({ params: { folderId: { required: true, type: 'string', uuid: true } } }),
  authorizeProfile({ requiredRole: 'editor' }),
  deleteFolder
);

module.exports = router;
