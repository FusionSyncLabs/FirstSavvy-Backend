const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const {
  listTransactions,
  getTransaction,
  listTransactionSplits,
  replaceTransactionSplits,
  deleteTransactionSplits,
  createTransaction,
  createTransactions,
  updateTransaction,
  deleteTransaction,
  undoPostedTransaction,
  postTransaction,
  findDuplicateTransactions,
  resolveDuplicateTransactions
} = require('../../controllers/transaction.controller');

const router = express.Router();

const TRANSACTION_STATUSES = ['pending', 'posted', 'reviewed', 'excluded', 'deleted'];
const TRANSACTION_TYPES = ['income', 'expense', 'transfer', 'asset_purchase', 'liability_payment', 'adjustment'];

const transactionBodySchema = {
  bank_account_id: { type: 'string', uuid: true },
  bankAccountId: { type: 'string', uuid: true },
  category_account_id: { type: 'string', uuid: true },
  categoryAccountId: { type: 'string', uuid: true },
  contact_id: { type: 'string', uuid: true },
  contactId: { type: 'string', uuid: true },
  date: { type: 'string', maxLength: 50 },
  posted_date: { type: 'string', maxLength: 50 },
  description: { type: 'string', maxLength: 500 },
  original_description: { type: 'string', maxLength: 500 },
  amount: { type: 'number' },
  transaction_type: { type: 'string', enum: TRANSACTION_TYPES },
  transactionType: { type: 'string', enum: TRANSACTION_TYPES },
  status: { type: 'string', enum: TRANSACTION_STATUSES },
  memo: { type: 'string', maxLength: 10000 },
  check_number: { type: 'string', maxLength: 50 },
  source: { type: 'string', maxLength: 100 },
  external_id: { type: 'string', maxLength: 255 },
  imported_at: { type: 'string', maxLength: 50 },
  splits: { type: 'array' },
  metadata: { type: 'object' }
};

router.use(authenticate);

router.get(
  '/',
  validateRequest({
    query: {
      page: { type: 'string' },
      limit: { type: 'string' },
      search: { type: 'string', maxLength: 255 },
      status: { type: 'string', enum: TRANSACTION_STATUSES },
      transactionType: { type: 'string', enum: TRANSACTION_TYPES },
      bankAccountId: { type: 'string', uuid: true },
      categoryAccountId: { type: 'string', uuid: true },
      contactId: { type: 'string', uuid: true },
      dateFrom: { type: 'string', maxLength: 50 },
      dateTo: { type: 'string', maxLength: 50 },
      includeDeleted: { type: 'string', enum: ['true', 'false'] },
      orderBy: { type: 'string', maxLength: 50 }
    }
  }),
  authorizeProfile(),
  listTransactions
);

router.post(
  '/',
  validateRequest({
    body: {
      ...transactionBodySchema,
      date: { required: true, type: 'string', maxLength: 50 },
      description: { required: true, type: 'string', maxLength: 500 },
      amount: { required: true, type: 'number' }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  createTransaction
);

router.post(
  '/bulk',
  authorizeProfile({ requiredRole: 'editor' }),
  createTransactions
);

router.get(
  '/duplicates',
  validateRequest({
    query: {
      bankAccountId: { type: 'string', uuid: true },
      daysWindow: { type: 'string' }
    }
  }),
  authorizeProfile(),
  findDuplicateTransactions
);

router.post(
  '/duplicates/resolve',
  validateRequest({
    body: {
      deleteTransactionIds: { required: true, type: 'array' }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  resolveDuplicateTransactions
);

router.get(
  '/:transactionId/splits',
  validateRequest({
    params: {
      transactionId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile(),
  listTransactionSplits
);

router.put(
  '/:transactionId/splits',
  validateRequest({
    params: {
      transactionId: { required: true, type: 'string', uuid: true }
    },
    body: {
      splits: { required: true, type: 'array' }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  replaceTransactionSplits
);

router.delete(
  '/:transactionId/splits',
  validateRequest({
    params: {
      transactionId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  deleteTransactionSplits
);

router.get(
  '/:transactionId',
  validateRequest({
    params: {
      transactionId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile(),
  getTransaction
);

router.patch(
  '/:transactionId',
  validateRequest({
    params: {
      transactionId: { required: true, type: 'string', uuid: true }
    },
    body: transactionBodySchema
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  updateTransaction
);

router.post(
  '/:transactionId/undo',
  validateRequest({
    params: {
      transactionId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  undoPostedTransaction
);

router.post(
  '/:transactionId/post',
  validateRequest({
    params: {
      transactionId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  postTransaction
);

router.delete(
  '/:transactionId',
  validateRequest({
    params: {
      transactionId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  deleteTransaction
);

module.exports = router;
