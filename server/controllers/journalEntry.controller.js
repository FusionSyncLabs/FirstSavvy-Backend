const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listJournalEntriesForProfile,
  listJournalEntryLinesForProfile,
  listJournalEntryAuditHistoryForProfile,
  createJournalEntryForProfile,
  createOpeningBalanceJournalEntryForProfile,
  getJournalEntryForProfile,
  listJournalEntryAttachmentsForProfile,
  createJournalEntryAttachmentForProfile,
  deleteJournalEntryAttachmentForProfile,
  updateJournalEntryWithLinesForProfile,
  deleteJournalEntryForProfile,
  getNextJournalEntryNumberForProfile
} = require('../services/journalEntry.service');

const listJournalEntries = asyncHandler(async (req, res) => {
  return ok(res, await listJournalEntriesForProfile(
    req.profileAccess.profileId,
    req.query
  ));
});

const listJournalEntryLines = asyncHandler(async (req, res) => {
  return ok(res, await listJournalEntryLinesForProfile(
    req.profileAccess.profileId,
    req.query
  ));
});

const listJournalEntryAuditHistory = asyncHandler(async (req, res) => {
  return ok(res, await listJournalEntryAuditHistoryForProfile(
    req.profileAccess.profileId,
    req.query
  ));
});

const createJournalEntry = asyncHandler(async (req, res) => {
  return created(res, await createJournalEntryForProfile(
    req.profileAccess.profileId,
    req.auth.sub,
    req.body
  ));
});

const createOpeningBalanceJournalEntry = asyncHandler(async (req, res) => {
  return created(res, {
    journalEntry: await createOpeningBalanceJournalEntryForProfile(
      req.profileAccess.profileId,
      req.auth.sub,
      req.body
    )
  });
});

const getJournalEntry = asyncHandler(async (req, res) => {
  return ok(res, await getJournalEntryForProfile(
    req.profileAccess.profileId,
    req.params.entryId
  ));
});

const listJournalEntryAttachments = asyncHandler(async (req, res) => {
  return ok(res, await listJournalEntryAttachmentsForProfile(
    req.profileAccess.profileId,
    req.params.entryId
  ));
});

const createJournalEntryAttachment = asyncHandler(async (req, res) => {
  return created(res, await createJournalEntryAttachmentForProfile(
    req.profileAccess.profileId,
    req.auth.sub,
    req.params.entryId,
    req.body,
    { file: req.file }
  ));
});

const deleteJournalEntryAttachment = asyncHandler(async (req, res) => {
  return ok(res, await deleteJournalEntryAttachmentForProfile(
    req.profileAccess.profileId,
    req.params.attachmentId
  ));
});

const updateJournalEntry = asyncHandler(async (req, res) => {
  return ok(res, await updateJournalEntryWithLinesForProfile(
    req.profileAccess.profileId,
    req.auth.sub,
    req.params.entryId,
    req.body
  ));
});

const deleteJournalEntry = asyncHandler(async (req, res) => {
  return ok(res, await deleteJournalEntryForProfile(
    req.profileAccess.profileId,
    req.auth.sub,
    req.params.entryId,
    req.body || {}
  ));
});

const getNextJournalEntryNumber = asyncHandler(async (req, res) => {
  return ok(res, {
    entryNumber: await getNextJournalEntryNumberForProfile(req.profileAccess.profileId)
  });
});

module.exports = {
  listJournalEntries,
  listJournalEntryLines,
  listJournalEntryAuditHistory,
  createJournalEntry,
  createOpeningBalanceJournalEntry,
  getJournalEntry,
  listJournalEntryAttachments,
  createJournalEntryAttachment,
  deleteJournalEntryAttachment,
  updateJournalEntry,
  deleteJournalEntry,
  getNextJournalEntryNumber
};
