const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listContactsForProfile,
  getContactForProfile,
  listIncomingContactRequestsForUser,
  createContactForProfile,
  updateContactForProfile,
  deleteContactForProfile,
  withdrawContactRequestForProfile,
  detectContactAccountForProfile,
  requestContactConnectionForProfile,
  inviteContactForProfile,
  acceptIncomingContactRequestForUser
} = require('../services/contact.service');

const listContacts = asyncHandler(async (req, res) => {
  return ok(res, await listContactsForProfile(req.profileAccess.profileId, req.query));
});

const getContact = asyncHandler(async (req, res) => {
  return ok(res, {
    contact: await getContactForProfile(req.profileAccess.profileId, req.params.contactId)
  });
});

const listIncomingContactRequests = asyncHandler(async (req, res) => {
  return ok(res, await listIncomingContactRequestsForUser(req.auth.sub));
});

const createContact = asyncHandler(async (req, res) => {
  return created(res, {
    contact: await createContactForProfile(req.profileAccess.profileId, req.body, req.auth.sub)
  });
});

const updateContact = asyncHandler(async (req, res) => {
  return ok(res, {
    contact: await updateContactForProfile(
      req.profileAccess.profileId,
      req.params.contactId,
      req.body,
      req.auth.sub,
      {
        avatarFile: req.file,
        publicFilesBaseUrl: `${req.protocol}://${req.get('host')}/api/v1/files/public`
      }
    )
  });
});

const deleteContact = asyncHandler(async (req, res) => {
  return ok(res, await deleteContactForProfile(req.profileAccess.profileId, req.params.contactId));
});

const withdrawContactRequest = asyncHandler(async (req, res) => {
  return ok(res, await withdrawContactRequestForProfile(
    req.profileAccess.profileId,
    req.params.contactId,
    req.auth.sub
  ));
});

const detectContactAccount = asyncHandler(async (req, res) => {
  return ok(res, await detectContactAccountForProfile(
    req.profileAccess.profileId,
    req.query,
    req.auth.sub
  ));
});

const requestContactConnection = asyncHandler(async (req, res) => {
  return ok(res, await requestContactConnectionForProfile(
    req.profileAccess.profileId,
    req.params.contactId,
    req.body,
    req.auth.sub
  ));
});

const inviteContact = asyncHandler(async (req, res) => {
  return ok(res, await inviteContactForProfile(
    req.profileAccess.profileId,
    req.params.contactId,
    req.body,
    req.auth.sub
  ));
});

const acceptIncomingContactRequest = asyncHandler(async (req, res) => {
  return ok(res, await acceptIncomingContactRequestForUser(req.params.contactId, req.auth.sub));
});

module.exports = {
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
};
