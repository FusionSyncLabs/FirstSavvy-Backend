const { randomUUID } = require('crypto');
const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { copyChartOfAccountsForProfile } = require('./provisioning.service');
const { shouldIncludeInCashBalance } = require('./provisioning.helpers');

async function assertProfileOwner(userId, profileId) {
  const membership = await prisma.profileMembership.findFirst({
    where: {
      user_id: userId,
      profile_id: profileId,
      role: 'owner',
      profile: {
        deleted_at: null,
        is_active: true
      }
    }
  });

  if (!membership) {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Only the profile owner can reset profile data', {
      code: ERROR_CODES.FORBIDDEN
    });
  }

  return membership;
}

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
}

async function provisionMissingChartAccountsForProfile(tx, profileId) {
  return 0;
}

async function resetFinancialDataForProfile(userId, profileId) {
  await assertProfileOwner(userId, profileId);

  const result = await prisma.$transaction(async (tx) => {
    await deleteFinancialRecords(tx, profileId);

    // Hard delete all user chart of accounts (assets, liabilities, equity, income, expense)
    await tx.userChartOfAccount.deleteMany({
      where: {
        profile_id: profileId
      }
    });

    const [preservedRules, preservedContacts] = await Promise.all([
      tx.transactionRule.count({ where: { profile_id: profileId } }),
      tx.contact.count({ where: { profile_id: profileId } })
    ]);

    return {
      preserved_categories: 0,
      preserved_rules: preservedRules,
      preserved_contacts: preservedContacts,
      provisioned_accounts: 0
    };
  });

  return {
    success: true,
    message: 'All accounts, transactions, and budgets have been deleted. Your profile has 0 accounts.',
    ...result
  };
}

async function resetUserDataForProfile(userId, profileId) {
  await assertProfileOwner(userId, profileId);

  const result = await prisma.$transaction(async (tx) => {
    await deleteFinancialRecords(tx, profileId);

    await tx.contact.deleteMany({ where: { profile_id: profileId } });
    await tx.transactionRule.deleteMany({ where: { profile_id: profileId } });
    await tx.profileViewPreference.deleteMany({ where: { profile_id: profileId } });
    await tx.csvColumnMappingConfig.deleteMany({ where: { profile_id: profileId } });
    await tx.userChartOfAccount.deleteMany({ where: { profile_id: profileId } });

    const chartAccountCount = await copyChartOfAccountsForProfile(tx, profileId);

    return {
      chart_account_count: chartAccountCount
    };
  });

  return {
    success: true,
    message: 'Your account has been reset successfully. All data deleted and fresh accounts created.',
    ...result
  };
}

module.exports = {
  resetFinancialDataForProfile,
  resetUserDataForProfile
};
