'use strict';
const { randomUUID } = require('crypto');
const path = require('path');
const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

// Load demo data once at module load time
const DEMO_DATA = require(path.join(__dirname, '../prisma/data/demo-seed-data.json'));

/**
 * Shift a date by a given number of days offset relative to an anchor date.
 */
function shiftDate(anchorDate, offsetDays) {
  const d = new Date(anchorDate);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

/**
 * Assert the requesting user is the owner of the profile.
 */
async function assertProfileOwner(userId, profileId) {
  const membership = await prisma.profileMembership.findFirst({
    where: {
      user_id: userId,
      profile_id: profileId,
      role: 'owner',
      profile: { deleted_at: null, is_active: true }
    }
  });
  if (!membership) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only the profile owner can load demo data', {
      code: ERROR_CODES.FORBIDDEN
    });
  }
  return membership;
}

/**
 * Hard-delete all financial records for a profile (mirrors profileReset.service.js).
 */
async function deleteFinancialRecords(tx, profileId) {
  await tx.calendarNotification.deleteMany({ where: { profile_id: profileId } });
  await tx.recurringOccurrence.updateMany({
    where: { profile_id: profileId },
    data: { linked_transaction_id: null }
  });
  await tx.recurringOccurrence.deleteMany({ where: { profile_id: profileId } });
  await tx.recurringSchedule.deleteMany({ where: { profile_id: profileId } });
  await tx.paymentReminder.deleteMany({ where: { profile_id: profileId } });
  await tx.goalContribution.deleteMany({ where: { profile_id: profileId } });
  await tx.financialGoal.deleteMany({ where: { profile_id: profileId } });
  await tx.transferMatchSuggestion.deleteMany({ where: { profile_id: profileId } });
  await tx.transactionSplit.deleteMany({ where: { profile_id: profileId } });
  await tx.journalEntryAttachment.deleteMany({ where: { profile_id: profileId } });

  await tx.transaction.updateMany({
    where: { profile_id: profileId },
    data: { journal_entry_id: null }
  });
  await tx.journalEntry.updateMany({
    where: { profile_id: profileId },
    data: { source_transaction_id: null }
  });

  await tx.csvColumnMappingConfig.deleteMany({ where: { profile_id: profileId } });
  await tx.transaction.deleteMany({ where: { profile_id: profileId } });
  await tx.journalEntry.deleteMany({ where: { profile_id: profileId } });
  await tx.budget.deleteMany({ where: { profile_id: profileId } });
  await tx.plaidAccount.deleteMany({ where: { profile_id: profileId } });
  await tx.plaidItem.deleteMany({ where: { profile_id: profileId } });
  await tx.auditLog.deleteMany({ where: { profile_id: profileId } });
  await tx.userChartOfAccount.deleteMany({ where: { profile_id: profileId } });
}

/**
 * Seed demo financial data into a profile.
 * Steps:
 *  1. Wipe existing financial data
 *  2. Create chart-of-accounts
 *  3. Create Plaid items + accounts (mock, no real credentials)
 *  4. Create transactions (dates shifted to be relative to today)
 *  5. Create journal entries + lines (dates shifted)
 *  6. Create budgets
 */
async function seedDemoDataForProfile(userId, profileId) {
  await assertProfileOwner(userId, profileId);

  const { chartAccounts, plaidItems, plaidAccounts, transactions, journalEntries, budgets } = DEMO_DATA;
  const spanDays = DEMO_DATA._meta.date_range.span_days || 90;

  // Anchor: place the END of the demo date range at yesterday so the "current month" shows activity
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const anchorEnd = new Date(today);
  anchorEnd.setDate(anchorEnd.getDate() - 1); // yesterday
  const anchorStart = new Date(anchorEnd);
  anchorStart.setDate(anchorStart.getDate() - spanDays);

  const result = await prisma.$transaction(async (tx) => {
    // ── Step 1: Wipe ──────────────────────────────────────────────────────────
    await deleteFinancialRecords(tx, profileId);

    // ── Step 2: Chart of Accounts ─────────────────────────────────────────────
    // Two-pass: first create all without parent_account_id, then link parents
    const acctKeyToId = {}; // _key -> new UUID

    // Pass 1 — create all accounts (parent_account_id = null initially)
    for (const acct of chartAccounts) {
      const newId = randomUUID();
      acctKeyToId[acct._key] = newId;

      await tx.userChartOfAccount.create({
        data: {
          id: newId,
          profile_id: profileId,
          template_account_number: acct.template_account_number,
          account_number: acct.account_number,
          account_name: acct.account_name,
          display_name: acct.display_name,
          class: acct.class,
          account_type: acct.account_type,
          account_detail: acct.account_detail,
          institution_name: acct.institution_name,
          account_mask: acct.account_mask,
          current_balance: acct.current_balance || 0,
          available_balance: acct.available_balance,
          opening_balance: acct.opening_balance,
          include_in_cash_balance: acct.include_in_cash_balance || false,
          is_active: acct.is_active !== false,
          is_system: acct.is_system || false,
          is_user_created: acct.is_user_created || false,
          icon: acct.icon,
          color: acct.color,
          metadata: acct.metadata || {},
          parent_account_id: null // set in pass 2
        }
      });
    }

    // Pass 2 — link parent_account_id for any child accounts
    for (const acct of chartAccounts) {
      if (acct.parent_key && acctKeyToId[acct.parent_key]) {
        await tx.userChartOfAccount.update({
          where: { id: acctKeyToId[acct._key] },
          data: { parent_account_id: acctKeyToId[acct.parent_key] }
        });
      }
    }

    // ── Step 3: Plaid Items + Accounts (mock) ─────────────────────────────────
    const plaidItemKeyToId = {};

    for (const pi of plaidItems) {
      const newItemId = randomUUID();
      plaidItemKeyToId[pi._key] = newItemId;

      await tx.plaidItem.create({
        data: {
          id: newItemId,
          profile_id: profileId,
          plaid_item_id: `demo-item-${randomUUID()}`,
          access_token: `demo-access-token-${newItemId}`,
          institution_id: pi.institution_id,
          institution_name: pi.institution_name,
          products: pi.products || [],
          status: 'demo',
          metadata: { is_demo: true }
        }
      });
    }

    for (const pa of plaidAccounts) {
      const plaidItemId = pa.plaid_item_key ? plaidItemKeyToId[pa.plaid_item_key] : null;
      const chartAccountId = pa.user_chart_account_key ? acctKeyToId[pa.user_chart_account_key] : null;

      if (!plaidItemId) continue; // skip orphaned plaid accounts

      await tx.plaidAccount.create({
        data: {
          id: randomUUID(),
          profile_id: profileId,
          plaid_item_id: plaidItemId,
          plaid_account_id: `demo-acct-${randomUUID()}`,
          user_chart_account_id: chartAccountId || null,
          name: pa.name,
          official_name: pa.official_name,
          mask: pa.mask,
          type: pa.type,
          subtype: pa.subtype,
          current_balance: pa.current_balance,
          available_balance: pa.available_balance,
          iso_currency_code: pa.iso_currency_code || 'USD',
          is_active: pa.is_active !== false,
          metadata: { is_demo: true }
        }
      });
    }

    // ── Step 4: Transactions (date-shifted) ───────────────────────────────────
    const txnKeyToId = {};

    for (const txn of transactions) {
      const newTxnId = randomUUID();
      txnKeyToId[txn._key] = newTxnId;

      const txnDate = shiftDate(anchorStart, txn.date_offset_days);
      const bankAcctId = txn.bank_account_key ? acctKeyToId[txn.bank_account_key] : null;
      const catAcctId = txn.category_account_key ? acctKeyToId[txn.category_account_key] : null;

      await tx.transaction.create({
        data: {
          id: newTxnId,
          profile_id: profileId,
          bank_account_id: bankAcctId,
          category_account_id: catAcctId,
          date: txnDate,
          posted_date: txnDate,
          description: txn.description,
          original_description: txn.original_description || txn.description,
          amount: txn.amount,
          transaction_type: txn.transaction_type,
          status: 'pending',
          memo: txn.memo,
          source: 'demo',
          metadata: { is_demo: true }
        }
      });
    }

    // ── Step 5: Journal Entries + Lines (date-shifted) ────────────────────────
    const jeKeyToId = {};

    for (const je of journalEntries) {
      const newJeId = randomUUID();
      jeKeyToId[je._key] = newJeId;

      const jeDate = shiftDate(anchorStart, je.date_offset_days);
      const sourceTxnId = je.source_transaction_key ? txnKeyToId[je.source_transaction_key] : null;

      await tx.journalEntry.create({
        data: {
          id: newJeId,
          profile_id: profileId,
          entry_date: jeDate,
          description: je.description,
          memo: je.memo,
          source: 'demo',
          status: je.status || 'posted',
          posted_at: jeDate,
          source_transaction_id: sourceTxnId || null,
          lines: {
            create: (je.lines || [])
              .filter(l => l.account_key && acctKeyToId[l.account_key])
              .map(l => ({
                id: randomUUID(),
                account_id: acctKeyToId[l.account_key],
                description: l.description,
                debit: l.debit || 0,
                credit: l.credit || 0
              }))
          }
        }
      });

      // Link journal entry back to source transaction
      if (sourceTxnId) {
        await tx.transaction.update({
          where: { id: sourceTxnId },
          data: { journal_entry_id: newJeId }
        });
      }
    }

    // ── Step 6: Budgets ───────────────────────────────────────────────────────
    // Budgets are intentionally NOT seeded — the user will configure them
    // manually by exploring the demo transactions in the Budgeting module.
    const budgetsSeeded = 0;

    return {
      chart_accounts: chartAccounts.length,
      plaid_items: plaidItems.length,
      plaid_accounts: plaidAccounts.length,
      transactions: transactions.length,
      journal_entries: journalEntries.length,
      budgets: budgetsSeeded
    };
  }, {
    timeout: 60000 // 60s for large datasets
  });

  return {
    success: true,
    message: 'Demo data loaded successfully! Explore the Finance module with realistic sample data.',
    ...result
  };
}

module.exports = { seedDemoDataForProfile };
