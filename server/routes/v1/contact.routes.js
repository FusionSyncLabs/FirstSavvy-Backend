const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { fileUpload, normalizeMultipartFields } = require('../../middleware/upload');
const {
  listContacts,
  getContact,
  listIncomingContactRequests,
  createContact,
  updateContact,
  deleteContact,
  withdrawContactRequest,
  detectContactAccount,
  requestContactConnection,
  inviteContact,
  acceptIncomingContactRequest
} = require('../../controllers/contact.controller');

const router = express.Router();

const contactBodySchema = {
  name: { type: 'string', minLength: 2, maxLength: 255 },
  displayName: { type: 'string', minLength: 2, maxLength: 255 },
  contact_type: { type: 'string', maxLength: 100 },
  email: { type: 'string', email: true, maxLength: 320 },
  phone: { type: 'string', maxLength: 50 },
  website: { type: 'string', maxLength: 2048 },
  avatar_url: { type: 'string', maxLength: 10000000 },
  group_name: { type: 'string', maxLength: 100 },
  notes: { type: 'string', maxLength: 10000 },
  address: { type: 'string', maxLength: 1000 },
  status: { type: 'string', maxLength: 50 },
  color: { type: 'string', maxLength: 32 },
  connection_status: { type: 'string', maxLength: 100 },
  metadata: { type: 'object' }
};

router.use(authenticate);

router.get('/incoming', listIncomingContactRequests);

router.get(
  '/',
  validateRequest({
    query: {
      page: { type: 'string' },
      limit: { type: 'string' },
      search: { type: 'string', maxLength: 255 },
      groupName: { type: 'string', maxLength: 100 },
      contactType: { type: 'string', maxLength: 100 },
      orderBy: { type: 'string', maxLength: 50 }
    }
  }),
  authorizeProfile(),
  listContacts
);

router.post(
  '/',
  validateRequest({
    body: {
      ...contactBodySchema,
      name: { required: true, type: 'string', minLength: 2, maxLength: 255 }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  createContact
);

router.get(
  '/account-detection',
  validateRequest({
    query: {
      email: { type: 'string', email: true, maxLength: 320 },
      phone: { type: 'string', maxLength: 50 }
    }
  }),
  authorizeProfile(),
  detectContactAccount
);

router.get(
  '/:contactId',
  validateRequest({
    params: {
      contactId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile(),
  getContact
);

router.patch(
  '/:contactId',
  fileUpload('avatar', {
    maxBytes: 5 * 1024 * 1024,
    requireImage: true,
    tooLargeMessage: 'Uploaded avatar is too large'
  }),
  normalizeMultipartFields({
    booleanFields: ['remove_avatar'],
    jsonFields: ['metadata', 'tags', 'relationship_metadata']
  }),
  validateRequest({
    params: {
      contactId: { required: true, type: 'string', uuid: true }
    },
    body: {
      ...contactBodySchema,
      remove_avatar: { type: 'boolean' }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  updateContact
);

router.post(
  '/:contactId/accept',
  validateRequest({
    params: {
      contactId: { required: true, type: 'string', uuid: true }
    }
  }),
  acceptIncomingContactRequest
);

router.post(
  '/:contactId/withdraw',
  validateRequest({
    params: {
      contactId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  withdrawContactRequest
);

router.post(
  '/:contactId/connection-request',
  validateRequest({
    params: {
      contactId: { required: true, type: 'string', uuid: true }
    },
    body: {
      targetUserId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  requestContactConnection
);

router.post(
  '/:contactId/invitation',
  validateRequest({
    params: {
      contactId: { required: true, type: 'string', uuid: true }
    },
    body: {
      email: { type: 'string', email: true, maxLength: 320 },
      phone: { type: 'string', maxLength: 50 }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  inviteContact
);

router.delete(
  '/:contactId',
  validateRequest({
    params: {
      contactId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  deleteContact
);

module.exports = router;
