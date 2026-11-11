const express = require('express');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const { fileUpload } = require('../../middleware/upload');
const {
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
} = require('../../controllers/journalEntry.controller');

const router = express.Router();

router.use(authenticate);

router.get(
  '/',
  authorizeProfile(),
  listJournalEntries
);

router.get(
  '/lines',
  authorizeProfile(),
  listJournalEntryLines
);

router.get(
  '/audit-history',
  authorizeProfile(),
  listJournalEntryAuditHistory
);

router.get(
  '/next-number',
  authorizeProfile(),
  getNextJournalEntryNumber
);

router.post(
  '/',
  authorizeProfile({ requiredRole: 'editor' }),
  createJournalEntry
);

router.post(
  '/opening-balance',
  authorizeProfile({ requiredRole: 'editor' }),
  createOpeningBalanceJournalEntry
);

router.post(
  '/:entryId/attachments',
  authorizeProfile({ requiredRole: 'editor' }),
  fileUpload('file', {
    maxBytes: 10 * 1024 * 1024,
    requireImage: true,
    tooLargeMessage: "Uploaded image is too large. Max size acceptable: 10MB"
  }),
  createJournalEntryAttachment
);

router.get(
  '/:entryId/attachments',
  authorizeProfile(),
  listJournalEntryAttachments
);

router.delete(
  '/attachments/:attachmentId',
  authorizeProfile({ requiredRole: 'editor' }),
  deleteJournalEntryAttachment
);

router.get(
  '/:entryId',
  authorizeProfile(),
  getJournalEntry
);


router.patch(
  '/:entryId',
  authorizeProfile({ requiredRole: 'editor' }),
  updateJournalEntry
);

router.delete(
  '/:entryId',
  authorizeProfile({ requiredRole: 'editor' }),
  deleteJournalEntry
);

module.exports = router;
