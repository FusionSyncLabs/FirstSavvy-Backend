const express = require('express');
const { validateRequest } = require('../../middleware/validateRequest');
const { authenticate } = require('../../middleware/authenticate');
const { authorizeProfile } = require('../../middleware/authorizeProfile');
const {
  listAccounts,
  listTemplates,
  listTypes,
  activateTemplate,
  getAccount,
  getDeletionSummary,
  createAccount,
  updateAccount,
  deleteAccount,
  autoFixVariance
} = require('../../controllers/account.controller');

const router = express.Router();

const accountBodySchema = {
  account_number: { type: 'number' },
  template_account_number: { type: 'number' },
  account_name: { type: 'string', maxLength: 255 },
  name: { type: 'string', maxLength: 255 },
  display_name: { type: 'string', maxLength: 255 },
  displayName: { type: 'string', maxLength: 255 },
  class: { type: 'string', enum: ['asset', 'liability', 'equity', 'income', 'expense'] },
  account_type: { type: 'string', maxLength: 100 },
  account_detail: { type: 'string', maxLength: 100 },
  parent_account_id: { type: 'string', uuid: true },
  institution_name: { type: 'string', maxLength: 255 },
  account_mask: { type: 'string', maxLength: 32 },
  current_balance: { type: 'number' },
  available_balance: { type: 'number' },
  opening_balance: { type: 'number' },
  include_in_cash_balance: { type: 'boolean' },
  is_active: { type: 'boolean' },
  icon: { type: 'string', maxLength: 100 },
  color: { type: 'string', maxLength: 32 },
  metadata: { type: 'object' }
};

router.use(authenticate);

router.get(
  '/types',
  authorizeProfile(),
  listTypes
);

router.get(
  '/templates',
  validateRequest({
    query: {
      class: { type: 'string', enum: ['asset', 'liability', 'equity', 'income', 'expense'] },
      account_type: { type: 'string', maxLength: 100 },
      accountType: { type: 'string', maxLength: 100 }
    }
  }),
  authorizeProfile(),
  listTemplates
);

router.post(
  '/activate-template',
  validateRequest({
    body: {
      templateAccountNumber: { type: 'number' },
      template_account_number: { type: 'number' },
      displayName: { type: 'string', maxLength: 255 },
      display_name: { type: 'string', maxLength: 255 },
      customDisplayName: { type: 'string', maxLength: 255 },
      custom_display_name: { type: 'string', maxLength: 255 },
      initialBalance: { type: 'number' },
      institutionName: { type: 'string', maxLength: 255 },
      institution_name: { type: 'string', maxLength: 255 },
      accountNumberLast4: { type: 'string', maxLength: 32 },
      account_number_last4: { type: 'string', maxLength: 32 },
      openingBalanceDate: { type: 'string', maxLength: 50 },
      opening_balance_date: { type: 'string', maxLength: 50 },
      includeInCashBalance: { type: 'boolean' },
      include_in_cash_balance: { type: 'boolean' },
      metadata: { type: 'object' }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  activateTemplate
);

router.get(
  '/',
  validateRequest({
    query: {
      page: { type: 'string' },
      limit: { type: 'string' },
      search: { type: 'string', maxLength: 255 },
      class: { type: 'string', enum: ['asset', 'liability', 'equity', 'income', 'expense'] },
      accountType: { type: 'string', maxLength: 100 },
      accountDetail: { type: 'string', maxLength: 100 },
      isActive: { type: 'string', enum: ['true', 'false'] },
      includeInactive: { type: 'string', enum: ['true', 'false'] },
      includeInCashBalance: { type: 'string', enum: ['true', 'false'] },
      orderBy: { type: 'string', maxLength: 50 }
    }
  }),
  authorizeProfile(),
  listAccounts
);

router.post(
  '/',
  validateRequest({
    body: {
      ...accountBodySchema,
      class: { required: true, type: 'string', enum: ['asset', 'liability', 'equity', 'income', 'expense'] }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  createAccount
);

router.get(
  '/:accountId',
  validateRequest({
    params: {
      accountId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile(),
  getAccount
);

router.get(
  '/:accountId/deletion-summary',
  validateRequest({
    params: {
      accountId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile(),
  getDeletionSummary
);

router.patch(
  '/:accountId',
  validateRequest({
    params: {
      accountId: { required: true, type: 'string', uuid: true }
    },
    body: accountBodySchema
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  updateAccount
);

router.delete(
  '/:accountId',
  validateRequest({
    params: {
      accountId: { required: true, type: 'string', uuid: true }
    },
    body: {
      reassignToAccountId: { type: 'string', uuid: true },
      reassign_to_account_id: { type: 'string', uuid: true }
    },
    query: {
      reassignToAccountId: { type: 'string', uuid: true },
      reassign_to_account_id: { type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  deleteAccount
);

router.post(
  '/:accountId/auto-fix-variance',
  validateRequest({
    params: {
      accountId: { required: true, type: 'string', uuid: true }
    }
  }),
  authorizeProfile({ requiredRole: 'editor' }),
  autoFixVariance
);

module.exports = router;
