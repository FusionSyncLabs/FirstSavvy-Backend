const { randomUUID } = require('crypto');
const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');
const { parsePaginationQuery, buildPaginationMeta } = require('../utils/pagination');
const { pickPublicAccount } = require('./account.service');
const { pickPublicRule, transactionMatchesConditions, buildTransactionRuleActions } = require('./transactionRule.service');
const { createNotificationsForProfileMembers } = require('./notification.service');
const { pickPublicJournalEntry } = require('./journalEntry.service');

const TRANSACTION_STATUSES = new Set(['pending', 'posted', 'reviewed', 'excluded', 'deleted']);
const TRANSACTION_TYPES = new Set(['income', 'expense', 'transfer', 'asset_purchase', 'liability_payment', 'adjustment']);
const TRANSACTION_SORT_FIELDS = new Set([
  'date',
  'posted_date',
  'description',
  'amount',
  'transaction_type',
  'status',
  'created_at',
  'updated_at'
]);

const TRANSACTION_INCLUDE = {
  bank_account: true,
  category_account: true,
  contact: true,
  splits: {
    include: {
      category_account: true,
      contact: true
    },
    orderBy: { created_at: 'asc' }
  }
};

async function listTransactionsForProfile(profileId, query = {}) {
  const pagination = parsePaginationQuery(query, {
    defaultLimit: 50,
    maxLimit: 10000
  });
  const where = buildTransactionWhere(profileId, query);
  const orderBy = buildTransactionOrder(query.orderBy || '-date');

  const [transactions, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: TRANSACTION_INCLUDE,
      orderBy,
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.transaction.count({ where })
  ]);

  return {
    transactions: transactions.map(pickPublicTransaction),
    pagination: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total
    })
  };
}

async function getTransactionForProfile(profileId, transactionId) {
  const transaction = await findTransaction(profileId, transactionId);
  return pickPublicTransaction(transaction);
}

async function listTransactionSplitsForProfile(profileId, transactionId) {
  const transaction = await findTransaction(profileId, transactionId);
  return transaction.splits.map(pickPublicSplit);
}

async function replaceTransactionSplitsForProfile(profileId, transactionId, splits, userId = null) {
  const transaction = await findTransaction(profileId, transactionId);
  validateSplitPayload(transaction, splits);

  const updatedTransaction = await updateTransactionForProfile(
    profileId,
    transactionId,
    { splits },
    userId
  );

  return updatedTransaction;
}

async function deleteTransactionSplitsForProfile(profileId, transactionId, userId = null) {
  const updatedTransaction = await updateTransactionForProfile(
    profileId,
    transactionId,
    { splits: [] },
    userId
  );

  return updatedTransaction;
}

async function createTransactionForProfile(profileId, input = {}, userId = null) {
  const transaction = await prisma.$transaction(async (tx) => (
    createTransactionInTransaction(tx, profileId, input, userId)
  ));

  return pickPublicTransaction(transaction);
}

async function createTransactionInTransaction(tx, profileId, input = {}, userId = null) {
  if (!input.description?.trim()) {
    throw ApiError.badRequest('Transaction description is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'description', message: 'Required field is missing' }]
    });
  }

  const data = await buildTransactionData(profileId, input, { db: tx });

  if (!data.date) {
    throw ApiError.badRequest('Transaction date is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'date', message: 'Required field is missing' }]
    });
  }

  if (data.amount === undefined) {
    throw ApiError.badRequest('Transaction amount is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'amount', message: 'Required field is missing' }]
    });
  }

  // Enforce budget limits for expense transactions
  await assertBudgetLimitsForTransactions(tx, profileId, [input], { db: tx });

  const shouldPost = data.status === 'posted';
  delete data.status;

  const created = await tx.transaction.create({
    data: {
      profile_id: profileId,
      ...data,
      description: input.description.trim(),
      status: 'pending',
      metadata: normalizeJson(input.metadata)
    }
  });

  if (Array.isArray(input.splits) && input.splits.length > 0) {
    await tx.transactionSplit.createMany({
      data: await buildSplitData(profileId, created.id, input.splits, tx)
    });
  }

  if (shouldPost) {
    await postTransactionInTransaction(tx, profileId, created.id, userId);
  }

  const finalTransaction = await tx.transaction.findUnique({
    where: { id: created.id },
    include: TRANSACTION_INCLUDE
  });

  await createAuditLog(tx, {
    profileId,
    userId,
    entityType: 'transaction',
    entityId: created.id,
    action: 'create_transaction',
    beforeData: null,
    afterData: pickPublicTransaction(finalTransaction),
    reason: getAuditReason(input, 'Transaction created')
  });

  return finalTransaction;
}

async function createTransactionsForProfile(profileId, inputs = [], userId = null, importMetadata = null) {
  if (!Array.isArray(inputs)) {
    throw ApiError.badRequest('Transactions must be an array', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'transactions', message: 'Must be an array' }]
    });
  }

  if (inputs.length === 0) {
    throw ApiError.badRequest('At least one transaction is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'transactions', message: 'Must contain at least one transaction' }]
    });
  }

  if (inputs.length > 1000) {
    throw ApiError.badRequest('A maximum of 1000 transactions can be imported at once', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'transactions', message: 'Must contain 1000 or fewer transactions' }]
    });
  }

  const transactions = await prisma.$transaction(async (tx) => {
    // Enforce budget limits for expense transactions in batch
    await assertBudgetLimitsForTransactions(tx, profileId, inputs, { db: tx });

    const transactionRows = [];
    const splitRows = [];
    const transactionsToPost = [];
    const auditReasonsByTransactionId = new Map();

    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index] || {};

      if (!input.description?.trim()) {
        throw ApiError.badRequest('Transaction description is required', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: `transactions.${index}.description`, message: 'Required field is missing' }]
        });
      }

      const data = await buildTransactionData(profileId, input, { db: tx });
      const shouldPost = data.status === 'posted';
      delete data.status;

      if (!data.date) {
        throw ApiError.badRequest('Transaction date is required', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: `transactions.${index}.date`, message: 'Required field is missing' }]
        });
      }

      if (data.amount === undefined) {
        throw ApiError.badRequest('Transaction amount is required', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: `transactions.${index}.amount`, message: 'Required field is missing' }]
        });
      }

      const transactionId = randomUUID();

      transactionRows.push({
        id: transactionId,
        profile_id: profileId,
        ...data,
        status: 'pending',
        description: input.description.trim(),
        metadata: normalizeJson(input.metadata)
      });

      auditReasonsByTransactionId.set(transactionId, getAuditReason(input, 'Transaction imported'));

      if (shouldPost) transactionsToPost.push(transactionId);

      if (Array.isArray(input.splits) && input.splits.length > 0) {
        splitRows.push(...await buildSplitData(profileId, transactionId, input.splits, tx));
      }
    }

    await tx.transaction.createMany({
      data: transactionRows
    });

    if (splitRows.length > 0) {
      await tx.transactionSplit.createMany({
        data: splitRows
      });
    }

    for (const transactionId of transactionsToPost) {
      await postTransactionInTransaction(tx, profileId, transactionId, userId);
    }

    const createdTransactions = await tx.transaction.findMany({
      where: {
        id: { in: transactionRows.map((transaction) => transaction.id) },
        profile_id: profileId
      },
      include: TRANSACTION_INCLUDE,
      orderBy: [{ date: 'desc' }, { created_at: 'desc' }]
    });

    for (const createdTransaction of createdTransactions) {
      await createAuditLog(tx, {
        profileId,
        userId,
        entityType: 'transaction',
        entityId: createdTransaction.id,
        action: 'create_transaction',
        beforeData: null,
        afterData: pickPublicTransaction(createdTransaction),
        reason: auditReasonsByTransactionId.get(createdTransaction.id)
      });
    }

    await updateImportAccountMetadata(tx, profileId, importMetadata, transactionRows);

    if (transactionRows.length > 1 || importMetadata) {
      const importKey = importMetadata?.importId || importMetadata?.fileName || transactionRows[0]?.id;
      await createNotificationsForProfileMembers(profileId, {
        source: 'transactions',
        source_id: importKey,
        event_type: 'transactions.import_completed',
        delivery_key: `transactions:import_completed:${importKey}`,
        title: 'Transactions imported',
        body: `${transactionRows.length} transaction${transactionRows.length === 1 ? '' : 's'} imported.`,
        action_url: '/Banking?tab=transactions',
        priority: 'low',
        metadata: {
          transaction_count: transactionRows.length,
          import_metadata: importMetadata || null
        }
      }, { db: tx, excludeUserIds: [userId] });
    }

    return createdTransactions;
  });

  try {
    const { autoMatchTransfersForProfile } = require('./transferMatching.service');
    await autoMatchTransfersForProfile(profileId);
  } catch (matchErr) {
    console.warn('[Import] Transfer auto-match warning:', matchErr?.message || matchErr);
  }

  return transactions.map(pickPublicTransaction);
}

async function updateImportAccountMetadata(tx, profileId, importMetadata, transactionRows) {
  if (!importMetadata || importMetadata.endingBalance === undefined || importMetadata.endingBalance === null) {
    return;
  }

  const bankAccountId = importMetadata.bankAccountId ||
    transactionRows.find((transaction) => transaction.bank_account_id)?.bank_account_id;

  if (!bankAccountId) return;

  const account = await tx.userChartOfAccount.findFirst({
    where: {
      id: bankAccountId,
      profile_id: profileId,
      deleted_at: null
    },
    select: {
      id: true,
      metadata: true
    }
  });

  if (!account) return;

  await tx.userChartOfAccount.update({
    where: { id: account.id },
    data: {
      metadata: {
        ...normalizeJson(account.metadata),
        bank_balance: parseMoney(importMetadata.endingBalance, 'endingBalance'),
        last_synced_at: new Date().toISOString()
      }
    }
  });
}

async function updateTransactionForProfile(profileId, transactionId, input = {}, userId = null) {
  const existingTransaction = await findTransaction(profileId, transactionId);

  const isPairedTransfer = Boolean(
    existingTransaction.paired_transfer_id ||
    existingTransaction.metadata?.paired_transfer_id ||
    existingTransaction.metadata?.is_transfer_pair ||
    (['transfer', 'credit_card_payment'].includes(existingTransaction.type) && (existingTransaction.category_account_id || existingTransaction.journal_entry_id))
  );

  const isCategorizingOrUnpairing = isPairedTransfer && Boolean(
    input.category_account_id !== undefined ||
    input.contact_id !== undefined ||
    (input.type && !['transfer', 'credit_card_payment'].includes(input.type)) ||
    (input.transaction_type && !['transfer', 'credit_card_payment'].includes(input.transaction_type)) ||
    input.splits !== undefined ||
    (input.bank_account_id && input.bank_account_id !== existingTransaction.bank_account_id)
  );

  const rawTransferType = !isCategorizingOrUnpairing
    ? (input.transfer_type || (input.type === 'credit_card_payment' ? 'credit_card_payment' : (input.type === 'transfer' || input.type === 'bank_transfer' ? 'bank_transfer' : null)))
    : null;

  const data = await buildTransactionData(profileId, input, { partial: true });
  const shouldPost = data.status === 'posted';
  if (shouldPost) {
    delete data.status;
  }
  const shouldUnpost = existingTransaction.status === 'posted' && data.status === 'pending';
  if (shouldUnpost) {
    delete data.status;
  }

  if (isCategorizingOrUnpairing) {
    data.metadata = {
      ...normalizeJson(existingTransaction.metadata),
      ...(input.metadata ? normalizeJson(input.metadata) : {}),
      paired_transfer_id: null,
      is_transfer_pair: false,
      transfer_type: null,
      other_account_id: null,
      original_type: null
    };
  } else if (isPairedTransfer && rawTransferType) {
    data.transaction_type = 'transfer';
    data.metadata = {
      ...normalizeJson(existingTransaction.metadata),
      ...(input.metadata ? normalizeJson(input.metadata) : {}),
      transfer_type: rawTransferType,
      is_transfer_pair: true
    };
  } else if (input.metadata !== undefined) {
    data.metadata = {
      ...normalizeJson(existingTransaction.metadata),
      ...normalizeJson(input.metadata)
    };
  }

  const shouldReplaceSplits = input.splits !== undefined;

  if (Object.keys(data).length === 0 && !shouldReplaceSplits && !shouldUnpost) {
    throw ApiError.badRequest('No transaction updates were provided', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const transaction = await prisma.$transaction(async (tx) => {
    // If moving from posted to pending, unpost the transaction and its journal entry
    if (shouldUnpost) {
      await unpostTransactionInTransaction(
        tx,
        profileId,
        transactionId,
        userId,
        getAuditReason(input, 'Posted transaction moved back to pending')
      );
    } else if (isCategorizingOrUnpairing && existingTransaction.status === 'posted') {
      await unpostTransactionInTransaction(
        tx,
        profileId,
        transactionId,
        userId,
        'Paired transfer unposted for categorization'
      );
    }

    // Enforce budget limits for updated transaction values
    await assertBudgetLimitsForTransactions(
      tx,
      profileId,
      [{
        ...existingTransaction,
        ...data,
        amount: data.amount !== undefined ? data.amount : existingTransaction.amount,
        category_account_id: data.category_account_id !== undefined ? data.category_account_id : existingTransaction.category_account_id,
        transaction_type: data.transaction_type !== undefined ? data.transaction_type : existingTransaction.transaction_type,
        date: data.date !== undefined ? data.date : existingTransaction.date,
        splits: shouldReplaceSplits ? input.splits : existingTransaction.splits
      }],
      { db: tx, ignoreTransactionId: transactionId }
    );

    if (Object.keys(data).length > 0) {
      await tx.transaction.update({
        where: { id: transactionId },
        data
      });
    }

    if (isCategorizingOrUnpairing) {
      const pairedTxId = existingTransaction.metadata?.paired_transfer_id || existingTransaction.paired_transfer_id;
      if (pairedTxId) {
        const pairedTx = await tx.transaction.findFirst({
          where: { id: pairedTxId, profile_id: profileId, deleted_at: null }
        });
        if (pairedTx) {
          const pairedMeta = normalizeJson(pairedTx.metadata);
          await tx.transaction.update({
            where: { id: pairedTx.id },
            data: {
              status: 'pending',
              posted_date: null,
              journal_entry_id: null,
              transaction_type: pairedMeta.original_type || (Number(pairedTx.amount) >= 0 ? 'income' : 'expense'),
              category_account_id: null,
              metadata: {
                ...pairedMeta,
                paired_transfer_id: null,
                is_transfer_pair: false,
                transfer_type: null,
                other_account_id: null,
                original_type: null
              }
            }
          });

          const [id1, id2] = [transactionId, pairedTx.id].sort();
          await tx.transferMatchSuggestion.updateMany({
            where: {
              profile_id: profileId,
              transaction_1_id: id1,
              transaction_2_id: id2
            },
            data: { status: 'pending' }
          });
        }
      }

      if (existingTransaction.journal_entry_id) {
        await tx.journalEntry.update({
          where: { id: existingTransaction.journal_entry_id },
          data: {
            status: 'voided',
            source_transaction_id: null,
            deleted_at: new Date()
          }
        });
      }
    } else if (isPairedTransfer && rawTransferType) {
      const pairedTxId = existingTransaction.metadata?.paired_transfer_id || existingTransaction.paired_transfer_id;
      if (pairedTxId) {
        const pairedTx = await tx.transaction.findFirst({
          where: { id: pairedTxId, profile_id: profileId, deleted_at: null }
        });
        if (pairedTx) {
          await tx.transaction.update({
            where: { id: pairedTx.id },
            data: {
              transaction_type: 'transfer',
              metadata: {
                ...normalizeJson(pairedTx.metadata),
                transfer_type: rawTransferType,
                is_transfer_pair: true
              }
            }
          });
        }
      }

      if (existingTransaction.journal_entry_id) {
        await tx.journalEntry.update({
          where: { id: existingTransaction.journal_entry_id },
          data: {
            description: rawTransferType === 'credit_card_payment' ? 'Credit Card Payment' : 'Bank Transfer'
          }
        });
      }
    }

    if (shouldReplaceSplits) {
      if (!Array.isArray(input.splits)) {
        throw ApiError.badRequest('Transaction splits must be an array', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: 'splits', message: 'Must be an array' }]
        });
      }

      await tx.transactionSplit.deleteMany({
        where: {
          transaction_id: transactionId,
          profile_id: profileId
        }
      });

      if (input.splits.length > 0) {
        await tx.transactionSplit.createMany({
          data: await buildSplitData(profileId, transactionId, input.splits, tx)
        });
      }
    }

    if (shouldPost) {
      await postTransactionInTransaction(tx, profileId, transactionId, userId);
    } else if (!shouldUnpost && !isCategorizingOrUnpairing && existingTransaction.status === 'posted' && existingTransaction.journal_entry_id) {
      // Synchronize linked journal entry lines and balances for posted transaction update
      const fullUpdatedTx = await tx.transaction.findUnique({
        where: { id: transactionId },
        include: TRANSACTION_INCLUDE
      });

      if (fullUpdatedTx) {
        await assertReimbursableContactRequirement(fullUpdatedTx, profileId, tx);

        const oldLines = await tx.journalEntryLine.findMany({
          where: { journal_entry_id: existingTransaction.journal_entry_id },
          select: { account_id: true }
        });
        const oldAccountIds = oldLines.map((l) => l.account_id);

        const newLines = buildJournalLinesForTransaction(fullUpdatedTx);
        assertBalancedJournalLines(newLines);

        await tx.journalEntry.update({
          where: { id: existingTransaction.journal_entry_id },
          data: {
            description: fullUpdatedTx.description,
            memo: fullUpdatedTx.memo,
            entry_date: fullUpdatedTx.posted_date || fullUpdatedTx.date
          }
        });

        await tx.journalEntryLine.deleteMany({
          where: { journal_entry_id: existingTransaction.journal_entry_id }
        });

        await tx.journalEntryLine.createMany({
          data: newLines.map((line) => ({
            journal_entry_id: existingTransaction.journal_entry_id,
            account_id: line.account_id,
            contact_id: line.contact_id,
            description: line.description,
            debit: line.debit,
            credit: line.credit
          }))
        });

        const affectedAccountIds = [...new Set([...oldAccountIds, ...newLines.map((l) => l.account_id)])];
        await refreshBalancesForAccountIds(tx, affectedAccountIds);
      }
    }

    const updated = await tx.transaction.findUnique({
      where: { id: transactionId },
      include: TRANSACTION_INCLUDE
    });

    await createAuditLog(tx, {
      profileId,
      userId,
      entityType: 'transaction',
      entityId: transactionId,
      action: 'update_transaction',
      beforeData: pickPublicTransaction(existingTransaction),
      afterData: pickPublicTransaction(updated),
      reason: getAuditReason(input, shouldPost ? 'Transaction updated and posted' : (shouldUnpost ? 'Posted transaction moved back to pending' : 'Transaction updated'))
    });

    return updated;
  });

  return pickPublicTransaction(transaction);
}

async function deleteTransactionForProfile(profileId, transactionId, userId = null) {
  const transaction = await findTransaction(profileId, transactionId);

  if (transaction.status === 'posted') {
    throw ApiError.badRequest('Posted transactions are locked. Undo the transaction before deleting it.', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.transaction.update({
      where: { id: transactionId },
      data: {
        status: 'deleted',
        deleted_at: new Date()
      },
      include: TRANSACTION_INCLUDE
    });

    await createAuditLog(tx, {
      profileId,
      userId,
      entityType: 'transaction',
      entityId: transactionId,
      action: 'delete_transaction',
      beforeData: pickPublicTransaction(transaction),
      afterData: pickPublicTransaction(updated),
      reason: 'Transaction deleted'
    });
  });

  return { deleted: true };
}

async function unpostTransactionInTransaction(tx, profileId, transactionId, userId = null, reason = 'Posted transaction moved back to pending') {
  const transaction = await tx.transaction.findFirst({
    where: {
      id: transactionId,
      profile_id: profileId,
      deleted_at: null
    },
    include: TRANSACTION_INCLUDE
  });

  if (!transaction) {
    throw ApiError.notFound('Transaction not found', {
      code: ERROR_CODES.TRANSACTION_NOT_FOUND
    });
  }

  // 1. Identify paired transfer counterpart if present
  const pairedTxId = transaction.paired_transfer_id ||
    transaction.metadata?.paired_transfer_id ||
    null;

  let pairedTransaction = null;
  if (pairedTxId) {
    pairedTransaction = await tx.transaction.findFirst({
      where: { id: pairedTxId, profile_id: profileId, deleted_at: null },
      include: TRANSACTION_INCLUDE
    });
  }

  // 2. Collect candidate journal entry IDs from both transaction and paired counterpart
  const candidateJeIds = new Set();
  if (transaction.journal_entry_id) candidateJeIds.add(transaction.journal_entry_id);
  if (transaction.metadata?.current_journal_entry_id) candidateJeIds.add(transaction.metadata.current_journal_entry_id);
  if (pairedTransaction?.journal_entry_id) candidateJeIds.add(pairedTransaction.journal_entry_id);
  if (pairedTransaction?.metadata?.current_journal_entry_id) candidateJeIds.add(pairedTransaction.metadata.current_journal_entry_id);

  // Also query any journal entry that has source_transaction_id pointing to this transaction or counterpart
  const sourceTxIds = [transaction.id, pairedTransaction?.id].filter(Boolean);
  const candidateWhere = [];
  if (candidateJeIds.size > 0) {
    candidateWhere.push({ id: { in: [...candidateJeIds] } });
  }
  if (sourceTxIds.length > 0) {
    candidateWhere.push({ source_transaction_id: { in: sourceTxIds } });
  }

  const journalEntriesToRemove = candidateWhere.length > 0
    ? await tx.journalEntry.findMany({
        where: {
          profile_id: profileId,
          OR: candidateWhere
        },
        include: {
          lines: {
            include: {
              account: true
            }
          }
        }
      })
    : [];

  const journalEntryIds = journalEntriesToRemove.map((je) => je.id);

  // 3. Find all transactions that should be unposted together
  const linkedWhere = [
    { id: transactionId },
    ...(journalEntryIds.length > 0 ? [{ journal_entry_id: { in: journalEntryIds } }] : []),
    ...(pairedTxId ? [{ id: pairedTxId }] : []),
    { metadata: { path: ['paired_transfer_id'], equals: transactionId } }
  ];

  const linkedTransactions = await tx.transaction.findMany({
    where: {
      profile_id: profileId,
      deleted_at: null,
      OR: linkedWhere
    },
    include: TRANSACTION_INCLUDE
  });

  let primaryUpdated = null;
  const accountIdsToRefresh = new Set();

  // 4. Detach relationships and return all linked transactions to pending
  for (const item of linkedTransactions) {
    const itemMeta = normalizeJson(item.metadata);
    const updated = await tx.transaction.update({
      where: { id: item.id },
      data: {
        status: 'pending',
        posted_date: null,
        journal_entry_id: null,
        metadata: {
          ...itemMeta,
          current_journal_entry_id: null,
          unposted_journal_entry_id: item.journal_entry_id || journalEntryIds[0] || null,
          unposted_at: new Date().toISOString()
        }
      },
      include: TRANSACTION_INCLUDE
    });

    if (item.id === transactionId) {
      primaryUpdated = updated;
    }
    if (item.bank_account_id) accountIdsToRefresh.add(item.bank_account_id);

    await createAuditLog(tx, {
      profileId,
      userId,
      entityType: 'transaction',
      entityId: item.id,
      action: 'undo_posted_transaction',
      beforeData: pickPublicTransaction(item),
      afterData: pickPublicTransaction(updated),
      reason: normalizeNullableString(reason) || 'Posted transaction moved back to pending'
    });
  }

  // 5. Preserve audit trail for each journal entry before deleting from active records
  for (const je of journalEntriesToRemove) {
    if (je.lines?.length) {
      je.lines.forEach((line) => accountIdsToRefresh.add(line.account_id));
    }

    await createAuditLog(tx, {
      profileId,
      userId,
      entityType: 'journal_entry',
      entityId: je.id,
      action: 'delete_journal_entry',
      beforeData: {
        entry: pickPublicJournalEntry(je),
        lines: (je.lines || []).map((l) => ({
          id: l.id,
          journal_entry_id: l.journal_entry_id,
          account_id: l.account_id,
          contact_id: l.contact_id,
          description: l.description,
          debit: decimalToNumber(l.debit),
          credit: decimalToNumber(l.credit)
        }))
      },
      afterData: null,
      reason: normalizeNullableString(reason) || 'Journal entry removed due to transaction unposting'
    });

    // Delete from active records completely. Cascading delete removes lines and attachments.
    await tx.journalEntry.delete({
      where: { id: je.id }
    });
  }

  // 6. Reset transfer suggestions if paired
  if (pairedTxId) {
    const [id1, id2] = [transactionId, pairedTxId].sort();
    await tx.transferMatchSuggestion.updateMany({
      where: {
        profile_id: profileId,
        transaction_1_id: id1,
        transaction_2_id: id2
      },
      data: { status: 'pending' }
    });
  }

  // 7. Refresh balances for all affected accounts
  if (accountIdsToRefresh.size > 0) {
    await refreshBalancesForAccountIds(tx, [...accountIdsToRefresh]);
  }

  return primaryUpdated || linkedTransactions[0] || transaction;
}

async function undoPostedTransactionForProfile(profileId, transactionId, userId = null, reason = null) {
  const existingTransaction = await findTransaction(profileId, transactionId);

  if (existingTransaction.status !== 'posted' && !existingTransaction.journal_entry_id) {
    throw ApiError.badRequest('Only posted transactions can be undone', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const transaction = await prisma.$transaction(async (tx) => {
    return unpostTransactionInTransaction(
      tx,
      profileId,
      transactionId,
      userId,
      reason || 'Posted transaction undone for correction'
    );
  });

  return pickPublicTransaction(transaction);
}

async function postTransactionForProfile(profileId, transactionId, userId = null) {
  const transactionForRules = await findTransaction(profileId, transactionId);
  if (transactionForRules.status === 'pending') {
    await applyMatchingRulesToTransactionInTransaction(profileId, transactionForRules);
  }

  const transaction = await prisma.$transaction(async (tx) => {
    await postTransactionInTransaction(tx, profileId, transactionId, userId);
    return tx.transaction.findUnique({
      where: { id: transactionId },
      include: TRANSACTION_INCLUDE
    });
  });

  return pickPublicTransaction(transaction);
}

async function findTransaction(profileId, transactionId) {
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      profile_id: profileId,
      deleted_at: null
    },
    include: TRANSACTION_INCLUDE
  });

  if (!transaction) {
    throw ApiError.notFound('Transaction not found', {
      code: ERROR_CODES.TRANSACTION_NOT_FOUND
    });
  }

  return transaction;
}

async function postTransactionInTransaction(tx, profileId, transactionId, userId = null) {
  const transaction = await tx.transaction.findFirst({
    where: {
      id: transactionId,
      profile_id: profileId,
      deleted_at: null
    },
    include: TRANSACTION_INCLUDE
  });

  if (!transaction) {
    throw ApiError.notFound('Transaction not found', {
      code: ERROR_CODES.TRANSACTION_NOT_FOUND
    });
  }

  if (transaction.status === 'posted') {
    throw ApiError.badRequest('Transaction is already posted', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  if (transaction.status !== 'pending') {
    throw ApiError.badRequest('Only pending transactions can be posted', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  // Ensure any stale journal entry references or orphaned entries from previous unposting cycles are resolved
  if (transaction.journal_entry_id) {
    const linkedJE = await tx.journalEntry.findUnique({
      where: { id: transaction.journal_entry_id },
      include: { lines: true }
    });

    if (!linkedJE || linkedJE.deleted_at || linkedJE.status === 'voided') {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: { journal_entry_id: null }
      });
      transaction.journal_entry_id = null;
    } else {
      await createAuditLog(tx, {
        profileId,
        userId,
        entityType: 'journal_entry',
        entityId: linkedJE.id,
        action: 'delete_journal_entry',
        beforeData: {
          entry: pickPublicJournalEntry(linkedJE),
          lines: (linkedJE.lines || []).map((l) => ({
            id: l.id,
            journal_entry_id: l.journal_entry_id,
            account_id: l.account_id,
            contact_id: l.contact_id,
            description: l.description,
            debit: decimalToNumber(l.debit),
            credit: decimalToNumber(l.credit)
          }))
        },
        afterData: null,
        reason: 'Stale journal entry removed prior to transaction reposting'
      });
      await tx.transaction.update({
        where: { id: transaction.id },
        data: { journal_entry_id: null }
      });
      await tx.journalEntry.delete({ where: { id: linkedJE.id } });
      transaction.journal_entry_id = null;
    }
  }

  const existingJournalEntry = await tx.journalEntry.findFirst({
    where: {
      source_transaction_id: transaction.id
    },
    include: { lines: true }
  });

  if (existingJournalEntry) {
    if (existingJournalEntry.deleted_at || existingJournalEntry.status === 'voided') {
      await tx.journalEntry.update({
        where: { id: existingJournalEntry.id },
        data: { source_transaction_id: null }
      });
    } else {
      await createAuditLog(tx, {
        profileId,
        userId,
        entityType: 'journal_entry',
        entityId: existingJournalEntry.id,
        action: 'delete_journal_entry',
        beforeData: {
          entry: pickPublicJournalEntry(existingJournalEntry),
          lines: (existingJournalEntry.lines || []).map((l) => ({
            id: l.id,
            journal_entry_id: l.journal_entry_id,
            account_id: l.account_id,
            contact_id: l.contact_id,
            description: l.description,
            debit: decimalToNumber(l.debit),
            credit: decimalToNumber(l.credit)
          }))
        },
        afterData: null,
        reason: 'Stale journal entry removed prior to transaction reposting'
      });
      await tx.journalEntry.delete({ where: { id: existingJournalEntry.id } });
    }
  }

  // Auto-activate pending category template from master catalog if present ONLY upon posting
  if (!transaction.category_account_id && transaction.metadata?.pending_category_template) {
    const templateNumber = transaction.metadata.pending_category_template.account_number;
    if (templateNumber) {
      let account = await tx.userChartOfAccount.findFirst({
        where: {
          profile_id: profileId,
          OR: [
            { account_number: templateNumber },
            { template_account_number: templateNumber }
          ],
          deleted_at: null
        }
      });

      if (!account) {
        const template = await tx.chartOfAccountsTemplate.findUnique({
          where: { account_number: templateNumber }
        });

        if (template) {
          account = await tx.userChartOfAccount.create({
            data: {
              profile_id: profileId,
              template_account_number: template.account_number,
              account_number: template.account_number,
              account_name: template.account_name,
              display_name: template.display_name || template.account_name,
              class: template.class,
              account_type: template.account_type,
              account_detail: template.account_detail,
              current_balance: 0,
              opening_balance: 0,
              include_in_cash_balance: false,
              is_active: true,
              is_system: false,
              is_user_created: true,
              icon: template.icon,
              color: template.color,
              metadata: {}
            }
          });
        }
      }

      if (account) {
        transaction.category_account_id = account.id;
        transaction.category_account = account;
        const newMetadata = { ...(transaction.metadata || {}) };
        delete newMetadata.pending_category_template;
        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            category_account_id: account.id,
            metadata: newMetadata
          }
        });
      }
    }
  }

  // Validate that reimbursable / accounts receivable spent transactions have a valid contact before posting
  await assertReimbursableContactRequirement(transaction, profileId, tx);

  // Auto-resolve missing or inactive bank account before building journal lines
  if (!transaction.bank_account || transaction.bank_account.deleted_at || transaction.bank_account.is_active === false) {
    let fallbackAccount = await tx.userChartOfAccount.findFirst({
      where: {
        profile_id: profileId,
        class: 'asset',
        account_detail: { in: ['checking_account', 'savings_account', 'cash'] },
        is_active: true,
        deleted_at: null
      },
      orderBy: { created_at: 'asc' }
    });

    if (!fallbackAccount) {
      fallbackAccount = await tx.userChartOfAccount.findFirst({
        where: {
          profile_id: profileId,
          class: { in: ['asset', 'liability'] },
          is_active: true,
          deleted_at: null
        },
        orderBy: { created_at: 'asc' }
      });
    }

    if (fallbackAccount) {
      await tx.transaction.update({
        where: { id: transaction.id },
        data: { bank_account_id: fallbackAccount.id }
      });
      transaction.bank_account_id = fallbackAccount.id;
      transaction.bank_account = fallbackAccount;
    }
  }

  const lines = buildJournalLinesForTransaction(transaction);
  assertBalancedJournalLines(lines);
  const entryNumber = await getNextJournalEntryNumber(profileId, tx);
  const postedAt = new Date();

  const journalEntry = await tx.journalEntry.create({
    data: {
      profile_id: profileId,
      entry_number: entryNumber,
      entry_date: transaction.posted_date || transaction.date,
      description: transaction.description,
      memo: transaction.memo,
      source: 'transaction',
      source_transaction_id: transaction.id,
      status: 'posted',
      created_by_user_id: userId,
      posted_at: postedAt,
      lines: {
        create: lines.map((line) => ({
          account_id: line.account_id,
          contact_id: line.contact_id,
          description: line.description,
          debit: line.debit,
          credit: line.credit
        }))
      }
    },
    include: {
      lines: true
    }
  });

  const updated = await tx.transaction.update({
    where: { id: transaction.id },
    data: {
      status: 'posted',
      posted_date: transaction.posted_date || postedAt,
      journal_entry_id: journalEntry.id,
      metadata: {
        ...normalizeJson(transaction.metadata),
        current_journal_entry_id: journalEntry.id
      }
    },
    include: TRANSACTION_INCLUDE
  });

  await refreshBalancesForAccountIds(tx, lines.map((line) => line.account_id));

  await createAuditLog(tx, {
    profileId,
    userId,
    entityType: 'transaction',
    entityId: transaction.id,
    action: 'post_transaction',
    beforeData: pickPublicTransaction(transaction),
    afterData: pickPublicTransaction(updated),
    reason: 'Transaction posted to ledger'
  });

  await createAuditLog(tx, {
    profileId,
    userId,
    entityType: 'journal_entry',
    entityId: journalEntry.id,
    action: 'create_journal_entry',
    beforeData: null,
    reason: 'Balanced journal entry created from posted transaction',
    afterData: {
      entry: {
        id: journalEntry.id,
        profile_id: journalEntry.profile_id,
        entry_number: journalEntry.entry_number,
        entry_date: journalEntry.entry_date,
        description: journalEntry.description,
        source_transaction_id: journalEntry.source_transaction_id,
        status: journalEntry.status
      },
      lines: journalEntry.lines.map((line) => ({
        id: line.id,
        account_id: line.account_id,
        debit: decimalToNumber(line.debit),
        credit: decimalToNumber(line.credit)
      }))
    }
  });
}

function buildJournalLinesForTransaction(transaction) {
  const bankAccount = validateAccountForTransaction(transaction.bank_account, {
    field: 'bank_account_id',
    allowedClasses: ['asset', 'liability'],
    required: true
  });
  const amount = roundMoney(Math.abs(Number(transaction.amount || 0)));

  if (amount <= 0) {
    throw ApiError.badRequest('Posted transactions must have a non-zero amount', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const transactionType = normalizeEnumValue(transaction.transaction_type || inferTransactionType(transaction.amount));

  if (transactionType === 'transfer') {
    const transferAccount = validateAccountForTransaction(transaction.category_account, {
      field: 'category_account_id',
      allowedClasses: ['asset', 'liability'],
      required: true
    });

    return buildTransferLines(transaction, bankAccount, transferAccount, amount);
  }

  const categoryLines = buildCategoryJournalLines(transaction, transactionType, amount);
  const bankLine = buildBankJournalLine(transaction, bankAccount, transactionType, amount);

  return [bankLine, ...categoryLines];
}

function buildCategoryJournalLines(transaction, transactionType, amount) {
  const splits = transaction.splits || [];

  if (splits.length > 0) {
    const total = roundMoney(splits.reduce((sum, split) => sum + Math.abs(Number(split.amount || 0)), 0));
    const targetAmount = roundMoney(amount);
    if (roundMoney(Math.abs(total - targetAmount)) > 0) {
      throw ApiError.badRequest('Split amounts must equal the transaction amount before posting', {
        code: ERROR_CODES.VALIDATION_FAILED
      });
    }

    return splits.map((split, index) => {
      const account = validateAccountForTransaction(split.category_account, {
        field: `splits.${index}.category_account_id`,
        allowedClasses: allowedCategoryClasses(transactionType),
        required: true
      });

      const splitContactId = split.contact_id || transaction.contact_id || null;
      return buildCategoryJournalLine(
        transaction,
        account,
        transactionType,
        Math.abs(Number(split.amount || 0)),
        split.memo,
        splitContactId
      );
    });
  }

  const account = validateAccountForTransaction(transaction.category_account, {
    field: 'category_account_id',
    allowedClasses: allowedCategoryClasses(transactionType),
    required: true
  });

  return [buildCategoryJournalLine(transaction, account, transactionType, amount, transaction.memo, transaction.contact_id)];
}

function validateSplitPayload(transaction, splits) {
  if (!Array.isArray(splits)) {
    throw ApiError.badRequest('Transaction splits must be an array', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'splits', message: 'Must be an array' }]
    });
  }

  if (splits.length < 2) {
    throw ApiError.badRequest('A transaction split requires at least two lines', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'splits', message: 'Must contain at least two lines' }]
    });
  }

  const splitTotal = splits.reduce((sum, split, index) => {
    const categoryAccountId = split?.category_account_id ?? split?.categoryAccountId;
    if (!categoryAccountId) {
      throw ApiError.badRequest(`splits.${index}.category_account_id is required`, {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: `splits.${index}.category_account_id`, message: 'Required field is missing' }]
      });
    }

    const amount = parseMoney(split?.amount, `splits.${index}.amount`);
    if (amount <= 0) {
      throw ApiError.badRequest(`splits.${index}.amount must be greater than zero`, {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: `splits.${index}.amount`, message: 'Must be greater than zero' }]
      });
    }

    return sum + amount;
  }, 0);

  const transactionAmount = roundMoney(Math.abs(Number(transaction.amount || 0)));
  const roundedSplitTotal = roundMoney(splitTotal);
  if (roundMoney(Math.abs(transactionAmount - roundedSplitTotal)) > 0) {
    throw ApiError.badRequest('Split amounts must equal the transaction amount', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'splits', message: 'Split total must equal the transaction amount' }]
    });
  }
}

function buildBankJournalLine(transaction, bankAccount, transactionType, amount) {
  const signedAmount = Number(transaction.amount || 0);
  const isIncrease = transactionType === 'income' || (['adjustment', 'asset_purchase', 'liability_payment'].includes(transactionType) && signedAmount >= 0);
  const description = transaction.description;

  if (bankAccount.class === 'asset') {
    return {
      account_id: bankAccount.id,
      contact_id: transaction.contact_id,
      description,
      debit: isIncrease ? amount : 0,
      credit: isIncrease ? 0 : amount
    };
  }

  return {
    account_id: bankAccount.id,
    contact_id: transaction.contact_id,
    description,
    debit: isIncrease ? amount : 0,
    credit: isIncrease ? 0 : amount
  };
}

function buildCategoryJournalLine(transaction, account, transactionType, amount, memo, contactId = null) {
  const description = memo || transaction.description;
  const lineContactId = contactId !== null ? contactId : transaction.contact_id;

  if (account.class === 'expense') {
    return {
      account_id: account.id,
      contact_id: lineContactId,
      description,
      debit: amount,
      credit: 0
    };
  }

  if (account.class === 'income') {
    return {
      account_id: account.id,
      contact_id: lineContactId,
      description,
      debit: 0,
      credit: amount
    };
  }

  if (account.class === 'asset') {
    // When spending/outflow, asset increases (receivable debit); when reimbursement received, asset decreases (receivable credit)
    const isSpent = Number(transaction.amount || 0) < 0 || transactionType === 'expense';
    return {
      account_id: account.id,
      contact_id: lineContactId,
      description,
      debit: isSpent ? amount : 0,
      credit: isSpent ? 0 : amount
    };
  }

  if (account.class === 'liability') {
    const isSpent = Number(transaction.amount || 0) < 0 || transactionType === 'expense';
    return {
      account_id: account.id,
      contact_id: lineContactId,
      description,
      debit: isSpent ? amount : 0,
      credit: isSpent ? 0 : amount
    };
  }

  const isIncrease = Number(transaction.amount || 0) >= 0;
  return {
    account_id: account.id,
    contact_id: lineContactId,
    description,
    debit: isIncrease ? 0 : amount,
    credit: isIncrease ? amount : 0
  };
}

function buildTransferLines(transaction, bankAccount, transferAccount, amount) {
  return [
    {
      account_id: transferAccount.id,
      contact_id: transaction.contact_id,
      description: transaction.description,
      debit: amount,
      credit: 0
    },
    {
      account_id: bankAccount.id,
      contact_id: transaction.contact_id,
      description: transaction.description,
      debit: 0,
      credit: amount
    }
  ];
}

function validateAccountForTransaction(account, options = {}) {
  if (!account) {
    if (options.required) {
      throw ApiError.badRequest(`${options.field} is required before posting`, {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: options.field, message: 'Required before posting' }]
      });
    }
    return null;
  }

  if (account.deleted_at || account.is_active === false) {
    throw ApiError.badRequest(`${options.field} must reference an active account`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: options.field, message: 'Must reference an active account' }]
    });
  }

  if (options.allowedClasses && !options.allowedClasses.includes(account.class)) {
    throw ApiError.badRequest(`${options.field} has an invalid account class for this transaction`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: options.field, message: `Must be one of: ${options.allowedClasses.join(', ')}` }]
    });
  }

  return account;
}

async function getNextJournalEntryNumber(profileId, tx) {
  const latest = await tx.journalEntry.findFirst({
    where: { profile_id: profileId },
    orderBy: { entry_number: 'desc' }
  });

  return Number(latest?.entry_number || 0) + 1;
}

async function refreshBalancesForAccountIds(tx, accountIds) {
  const uniqueAccountIds = [...new Set(accountIds.filter(Boolean))];

  for (const accountId of uniqueAccountIds) {
    const account = await tx.userChartOfAccount.findUnique({
      where: { id: accountId },
      select: { id: true, class: true }
    });
    if (!account) continue;

    const aggregate = await tx.journalEntryLine.aggregate({
      where: {
        account_id: accountId,
        journal_entry: {
          status: 'posted',
          deleted_at: null
        }
      },
      _sum: {
        debit: true,
        credit: true
      }
    });

    const debit = Number(aggregate._sum.debit || 0);
    const credit = Number(aggregate._sum.credit || 0);
    const balance = normalBalanceClasses().has(account.class)
      ? roundMoney(debit - credit)
      : roundMoney(credit - debit);

    await tx.userChartOfAccount.update({
      where: { id: accountId },
      data: { current_balance: balance }
    });
  }
}

async function createAuditLog(tx, {
  profileId,
  userId,
  entityType,
  entityId,
  action,
  beforeData,
  afterData,
  reason = null
}) {
  await tx.auditLog.create({
    data: {
      profile_id: profileId,
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      before_data: toAuditJson(beforeData),
      after_data: toAuditJson(afterData),
      reason: normalizeAuditReason(reason, action)
    }
  });
}

function getAuditReason(input = {}, fallback) {
  return normalizeNullableString(
    input.reason ??
    input.audit_reason ??
    input.auditReason ??
    input.edit_reason ??
    input.editReason ??
    input.delete_reason ??
    input.deleteReason ??
    input.undo_reason ??
    input.undoReason
  ) || fallback;
}

function normalizeAuditReason(reason, action) {
  return normalizeNullableString(reason) || `Financial action: ${action}`;
}

function toAuditJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function assertBalancedJournalLines(lines) {
  const debit = roundMoney(lines.reduce((sum, line) => sum + Number(line.debit || 0), 0));
  const credit = roundMoney(lines.reduce((sum, line) => sum + Number(line.credit || 0), 0));

  if (roundMoney(Math.abs(debit - credit)) > 0) {
    throw ApiError.badRequest('Journal entry debits must equal credits', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
}

function allowedCategoryClasses(transactionType) {
  if (transactionType === 'income') return ['income', 'asset', 'liability'];
  if (transactionType === 'expense') return ['expense', 'asset', 'liability'];
  if (transactionType === 'asset_purchase') return ['asset'];
  if (transactionType === 'liability_payment') return ['liability'];
  return ['asset', 'liability', 'equity', 'income', 'expense'];
}

function inferTransactionType(amount) {
  return Number(amount || 0) >= 0 ? 'income' : 'expense';
}

function normalBalanceClasses() {
  return new Set(['asset', 'expense']);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function buildTransactionWhere(profileId, query = {}) {
  const where = {
    profile_id: profileId
  };

  if (query.includeDeleted !== 'true') {
    where.deleted_at = null;
  }

  if (query.status) where.status = query.status;
  if (query.transactionType) where.transaction_type = query.transactionType;
  if (query.bankAccountId) where.bank_account_id = query.bankAccountId;
  if (query.categoryAccountId) where.category_account_id = query.categoryAccountId;
  if (query.contactId) {
    const contactCondition = {
      OR: [
        { contact_id: query.contactId },
        { splits: { some: { contact_id: query.contactId } } }
      ]
    };
    if (where.AND) {
      where.AND.push(contactCondition);
    } else {
      where.AND = [contactCondition];
    }
  }

  const dateFilter = {};
  if (query.dateFrom) dateFilter.gte = parseDate(query.dateFrom, 'dateFrom');
  if (query.dateTo) dateFilter.lte = parseDate(query.dateTo, 'dateTo');
  if (Object.keys(dateFilter).length > 0) where.date = dateFilter;

  if (query.search) {
    const search = String(query.search).trim();
    if (search) {
      const searchCondition = {
        OR: [
          { description: { contains: search, mode: 'insensitive' } },
          { original_description: { contains: search, mode: 'insensitive' } },
          { memo: { contains: search, mode: 'insensitive' } },
          { check_number: { contains: search, mode: 'insensitive' } },
          { external_id: { contains: search, mode: 'insensitive' } }
        ]
      };
      if (where.AND) {
        where.AND.push(searchCondition);
      } else {
        where.AND = [searchCondition];
      }
    }
  }

  return where;
}

function buildTransactionOrder(orderBy) {
  const raw = String(orderBy || '-date');
  const descending = raw.startsWith('-');
  const field = descending ? raw.slice(1) : raw;

  if (!TRANSACTION_SORT_FIELDS.has(field)) {
    return [{ date: 'desc' }, { created_at: 'desc' }];
  }

  return [{ [field]: descending ? 'desc' : 'asc' }, { created_at: 'desc' }];
}

async function buildTransactionData(profileId, input = {}, options = {}) {
  const db = options.db || prisma;
  const data = {};

  if (input.date !== undefined) data.date = parseNullableDate(input.date, 'date');
  if (input.posted_date !== undefined) data.posted_date = parseNullableDate(input.posted_date, 'posted_date');
  if (input.amount !== undefined) data.amount = parseMoney(input.amount, 'amount');

  const stringFields = [
    'description',
    'original_description',
    'memo',
    'check_number',
    'source',
    'external_id'
  ];

  stringFields.forEach((field) => {
    if (input[field] !== undefined) {
      if (field === 'description' && options.partial && !String(input[field] || '').trim()) {
        throw ApiError.badRequest('Transaction description cannot be blank', {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: 'description', message: 'Must not be blank' }]
        });
      }
      data[field] = normalizeNullableString(input[field]);
    }
  });

  if (input.transaction_type !== undefined || input.transactionType !== undefined) {
    const transactionType = normalizeEnumValue(input.transaction_type ?? input.transactionType);
    if (transactionType && !TRANSACTION_TYPES.has(transactionType)) {
      throw ApiError.badRequest('Invalid transaction type', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'transaction_type', message: 'Must be a valid transaction type' }]
      });
    }
    data.transaction_type = transactionType || null;
  }

  if (input.status !== undefined) {
    const status = normalizeEnumValue(input.status);
    if (!TRANSACTION_STATUSES.has(status)) {
      throw ApiError.badRequest('Invalid transaction status', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'status', message: 'Must be a valid transaction status' }]
      });
    }
    data.status = status;
    data.deleted_at = status === 'deleted' ? new Date() : null;
  }

  if (input.imported_at !== undefined) {
    data.imported_at = parseNullableDate(input.imported_at, 'imported_at');
  }

  if (input.bank_account_id !== undefined || input.bankAccountId !== undefined) {
    data.bank_account_id = await normalizeAccountId(profileId, input.bank_account_id ?? input.bankAccountId, db);
  }

  if (input.category_account_id !== undefined || input.categoryAccountId !== undefined) {
    const rawCategoryId = input.category_account_id ?? input.categoryAccountId;
    if (typeof rawCategoryId === 'string' && rawCategoryId.startsWith('__template__:')) {
      data.category_account_id = null;
      const templateNumber = parseInt(rawCategoryId.replace('__template__:', ''), 10);
      if (templateNumber) {
        data.metadata = {
          ...(data.metadata || {}),
          pending_category_template: {
            account_number: templateNumber
          }
        };
      }
    } else {
      data.category_account_id = await normalizeAccountId(profileId, rawCategoryId, db);
    }
  }

  if (input.contact_id !== undefined || input.contactId !== undefined) {
    data.contact_id = await normalizeContactId(profileId, input.contact_id ?? input.contactId, db);
  }

  return data;
}

async function buildSplitData(profileId, transactionId, splits, db = prisma) {
  const rows = [];

  for (let index = 0; index < splits.length; index += 1) {
    const split = splits[index] || {};

    if (split.amount === undefined) {
      throw ApiError.badRequest('Split amount is required', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: `splits.${index}.amount`, message: 'Required field is missing' }]
      });
    }

    const rawContactId = split.contact_id !== undefined ? split.contact_id : split.contactId;

    rows.push({
      transaction_id: transactionId,
      profile_id: profileId,
      category_account_id: await normalizeAccountId(profileId, split.category_account_id ?? split.categoryAccountId, db),
      contact_id: await normalizeContactId(profileId, rawContactId, db),
      amount: parseMoney(split.amount, `splits.${index}.amount`),
      memo: normalizeNullableString(split.memo ?? split.description)
    });
  }

  return rows;
}

async function normalizeAccountId(profileId, accountId, db = prisma) {
  if (accountId === null || accountId === undefined || accountId === '') return null;

  const account = await db.userChartOfAccount.findFirst({
    where: {
      id: accountId,
      profile_id: profileId,
      deleted_at: null
    }
  });

  if (!account) {
    throw ApiError.notFound('Account not found', {
      code: ERROR_CODES.ACCOUNT_NOT_FOUND
    });
  }

  return accountId;
}

async function normalizeContactId(profileId, contactId, db = prisma) {
  if (contactId === null || contactId === undefined || contactId === '') return null;

  const contact = await db.contact.findFirst({
    where: {
      id: contactId,
      profile_id: profileId,
      deleted_at: null
    }
  });

  if (!contact) {
    throw ApiError.notFound('Contact not found', {
      code: ERROR_CODES.CONTACT_NOT_FOUND
    });
  }

  const metadata = contact.metadata && typeof contact.metadata === 'object' && !Array.isArray(contact.metadata)
    ? contact.metadata
    : {};
  if (['pending', 'invited'].includes(metadata.connection_status)) {
    throw ApiError.badRequest('Contact must be connected before it can be used on a transaction', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'contact_id', message: 'Contact is not connected yet' }]
    });
  }

  return contactId;
}

function isReceivableChartAccount(account) {
  if (!account) return false;
  const num = Number(account.account_number || account.template_account_number || 0);
  const detail = String(account.account_detail || '').toLowerCase();
  const name = String(account.display_name || account.account_name || '').toLowerCase();
  const type = String(account.account_type || '').toLowerCase();
  return (
    num === 1850 ||
    num === 1850.1 ||
    num === 1850.2 ||
    num === 1850.3 ||
    detail.includes('receivable') ||
    detail.includes('reimburse') ||
    detail.includes('owed to me') ||
    name.includes('owed to me') ||
    name.includes('reimburse') ||
    name.includes('receivable') ||
    name.includes('loan to') ||
    type.includes('receivable') ||
    type.includes('reimburse')
  );
}

async function assertReimbursableContactRequirement(transaction, profileId, tx = prisma) {
  const isSpent = Number(transaction.amount || 0) < 0 || transaction.transaction_type === 'expense' || transaction.type === 'expense';

  // If transaction has splits, validate each split line independently
  const splits = transaction.splits || [];
  if (splits.length > 0) {
    for (let index = 0; index < splits.length; index += 1) {
      const split = splits[index];
      const categoryAccountId = split.category_account_id;
      if (!categoryAccountId) continue;

      const categoryAccount = split.category_account || (await tx.userChartOfAccount.findUnique({
        where: { id: categoryAccountId }
      }));

      if (categoryAccount && isReceivableChartAccount(categoryAccount) && isSpent) {
        if (!split.contact_id) {
          throw ApiError.badRequest('Please select who owes you this money before posting this reimbursable transaction.', {
            code: ERROR_CODES.VALIDATION_FAILED,
            details: [{ location: 'body', field: `splits.${index}.contact_id`, message: 'Please select who owes you this money before posting this reimbursable transaction.' }]
          });
        }

        const validContact = await tx.contact.findFirst({
          where: {
            id: split.contact_id,
            profile_id: profileId,
            deleted_at: null
          }
        });

        if (!validContact) {
          throw ApiError.badRequest('Please select who owes you this money before posting this reimbursable transaction.', {
            code: ERROR_CODES.VALIDATION_FAILED,
            details: [{ location: 'body', field: `splits.${index}.contact_id`, message: 'Selected contact does not exist or has been removed.' }]
          });
        }
      }
    }
    return;
  }

  // Non-split transaction validation
  const categoryAccountId = transaction.category_account_id;
  if (!categoryAccountId) return;

  const categoryAccount = transaction.category_account || (await tx.userChartOfAccount.findUnique({
    where: { id: categoryAccountId }
  }));
  if (!categoryAccount) return;

  if (isReceivableChartAccount(categoryAccount) && isSpent) {
    if (!transaction.contact_id) {
      throw ApiError.badRequest('Please select who owes you this money before posting this reimbursable transaction.', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'contact_id', message: 'Please select who owes you this money before posting this reimbursable transaction.' }]
      });
    }

    const validContact = await tx.contact.findFirst({
      where: {
        id: transaction.contact_id,
        profile_id: profileId,
        deleted_at: null
      }
    });

    if (!validContact) {
      throw ApiError.badRequest('Please select who owes you this money before posting this reimbursable transaction.', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'contact_id', message: 'Selected contact does not exist or has been removed.' }]
      });
    }
  }
}

async function applyMatchingRulesToTransactionInTransaction(profileId, transaction) {
  const rules = await prisma.transactionRule.findMany({
    where: { profile_id: profileId, is_active: true },
    orderBy: [{ priority: 'desc' }, { created_at: 'asc' }]
  });
  const ruleTransaction = pickPublicTransaction(transaction);
  const matchingRules = rules
    .map(pickPublicRule)
    .filter((rule) => transactionMatchesConditions(ruleTransaction, rule));
  if (matchingRules.length === 0) return { applied: 0 };

  const data = {};
  for (const rule of matchingRules) {
    Object.assign(data, buildTransactionRuleActions(rule));
  }
  delete data.status;
  data.metadata = {
    ...normalizeJson(transaction.metadata),
    applied_rule_id: matchingRules[matchingRules.length - 1].id
  };

  await prisma.transaction.update({ where: { id: transaction.id }, data });
  for (const rule of matchingRules) {
    await prisma.transactionRule.update({
      where: { id: rule.id },
      data: { apply_count: { increment: 1 }, last_applied_at: new Date() }
    });
  }

  return { applied: matchingRules.length };
}

function pickPublicTransaction(transaction) {
  if (!transaction) return null;

  return {
    id: transaction.id,
    profile_id: transaction.profile_id,
    bank_account_id: transaction.bank_account_id,
    category_account_id: transaction.category_account_id,
    contact_id: transaction.contact_id,
    journal_entry_id: transaction.journal_entry_id,
    date: transaction.date,
    posted_date: transaction.posted_date,
    description: transaction.description,
    original_description: transaction.original_description,
    amount: decimalToNumber(transaction.amount),
    transaction_type: transaction.transaction_type,
    status: transaction.status,
    memo: transaction.memo,
    check_number: transaction.check_number,
    source: transaction.source,
    external_id: transaction.external_id,
    imported_at: transaction.imported_at,
    metadata: normalizeJson(transaction.metadata),
    bank_account: transaction.bank_account ? pickPublicAccount(transaction.bank_account) : undefined,
    category_account: transaction.category_account ? pickPublicAccount(transaction.category_account) : undefined,
    contact: transaction.contact ? pickPublicContactSummary(transaction.contact) : undefined,
    is_split: Boolean(transaction.splits?.length),
    splits: transaction.splits ? transaction.splits.map(pickPublicSplit) : undefined,
    created_at: transaction.created_at,
    updated_at: transaction.updated_at
  };
}

function pickPublicSplit(split) {
  return {
    id: split.id,
    transaction_id: split.transaction_id,
    profile_id: split.profile_id,
    category_account_id: split.category_account_id,
    contact_id: split.contact_id || null,
    amount: decimalToNumber(split.amount),
    memo: split.memo,
    description: split.memo,
    category_account: split.category_account ? pickPublicAccount(split.category_account) : undefined,
    contact: split.contact ? pickPublicContactSummary(split.contact) : undefined,
    created_at: split.created_at,
    updated_at: split.updated_at
  };
}

function pickPublicContactSummary(contact) {
  return {
    id: contact.id,
    profile_id: contact.profile_id,
    name: contact.name,
    contact_type: contact.contact_type,
    email: contact.email,
    phone: contact.phone,
    group_name: contact.group_name
  };
}

function normalizeNullableString(value) {
  if (value === null) return null;
  if (value === undefined) return undefined;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function normalizeEnumValue(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeJson(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseMoney(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw ApiError.badRequest(`${field} must be a valid amount`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field, message: 'Must be a valid amount' }]
    });
  }
  return number;
}

function parseDate(value, field) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return new Date(`${value.trim()}T12:00:00.000Z`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest(`${field} must be a valid date`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'query', field, message: 'Must be a valid date' }]
    });
  }
  return date;
}

function parseNullableDate(value, field) {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return new Date(`${value.trim()}T12:00:00.000Z`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest(`${field} must be a valid date`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field, message: 'Must be a valid date' }]
    });
  }
  return date;
}

function decimalToNumber(value) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

async function assertBudgetLimitsForTransactions(tx, profileId, inputs = [], options = {}) {
  // Budgets are financial targets/guides and never hard spending or categorization limits.
  // Transactions are always accepted and categorized successfully regardless of budget limit.
  return;
}


async function findDuplicateTransactionsForProfile(profileId, query = {}) {
  const where = {
    profile_id: profileId,
    deleted_at: null,
    status: { not: 'deleted' }
  };

  const rawBankId = query.bankAccountId || query.bank_account_id;
  if (rawBankId && rawBankId !== 'all' && rawBankId !== 'undefined' && rawBankId !== 'null') {
    where.bank_account_id = rawBankId;
  }

  const daysWindow = Math.max(0, parseInt(query.daysWindow || query.days_window || '7', 10));

  const transactions = await prisma.transaction.findMany({
    where,
    include: {
      bank_account: true,
      category_account: true,
      contact: true,
      splits: true
    },
    orderBy: [
      { date: 'asc' },
      { created_at: 'asc' }
    ]
  });

  const duplicateGroups = [];
  const processedTxIds = new Set();

  const STOP_WORDS = new Set(['the', 'and', 'or', 'inc', 'llc', 'corp', 'co', 'ltd', 'com', 'store', 'shop', 'us', 'usa']);

  const cleanDescription = (str) => {
    if (!str) return '';
    return String(str)
      .toLowerCase()
      .replace(/pos debit|checkcard|purchase|debit card|direct dep|online transfer|ach debit|recurring|visa direct|sq \*|tst\*|chk|check #|bill payment|electronic/gi, ' ')
      .replace(/#\d+/g, ' ')
      .replace(/\b\d{4,}\b/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  };

  const getSignificantTokens = (cleanStr) => {
    if (!cleanStr) return [];
    return cleanStr
      .split(' ')
      .map(w => w.trim())
      .filter(w => w.length > 2 && !STOP_WORDS.has(w));
  };

  const areDescriptionsMatching = (t1, t2) => {
    const d1 = cleanDescription(t1.description);
    const od1 = cleanDescription(t1.original_description);
    const c1 = cleanDescription(t1.contact?.name);

    const d2 = cleanDescription(t2.description);
    const od2 = cleanDescription(t2.original_description);
    const c2 = cleanDescription(t2.contact?.name);

    const list1 = [d1, od1, c1].filter(Boolean);
    const list2 = [d2, od2, c2].filter(Boolean);

    // If both have no text, they match only if both are blank
    if (list1.length === 0 && list2.length === 0) {
      return true;
    }
    // If one is blank and other is not, do not assume duplicate
    if (list1.length === 0 || list2.length === 0) {
      return false;
    }

    // Direct exact normalized match
    for (const s1 of list1) {
      for (const s2 of list2) {
        if (s1 === s2) return true;
      }
    }

    // Token-based Jaccard similarity & prefix match
    for (const s1 of list1) {
      const tokens1 = getSignificantTokens(s1);
      for (const s2 of list2) {
        const tokens2 = getSignificantTokens(s2);

        if (tokens1.length === 0 && tokens2.length === 0) {
          if (s1 === s2) return true;
          continue;
        }
        if (tokens1.length === 0 || tokens2.length === 0) continue;

        const set2 = new Set(tokens2);
        const intersection = tokens1.filter(t => set2.has(t));
        const union = new Set([...tokens1, ...tokens2]);
        const jaccard = intersection.length / union.size;

        if (jaccard >= 0.6) return true;

        const minTokens = Math.min(tokens1.length, tokens2.length);
        if (minTokens >= 1 && intersection.length === minTokens && tokens1[0] === tokens2[0]) {
          return true;
        }
      }
    }

    return false;
  };

  for (let i = 0; i < transactions.length; i++) {
    const t1 = transactions[i];
    if (processedTxIds.has(t1.id)) continue;
    if (t1.metadata?.duplicate_dismissed || t1.metadata?.duplicate_kept || t1.metadata?.duplicate_resolved) continue;

    const group = [t1];
    const date1 = new Date(t1.date).getTime();
    const amount1 = Number(t1.amount || 0);
    const absAmt1 = Math.abs(amount1);

    if (absAmt1 < 0.01) continue;

    for (let j = i + 1; j < transactions.length; j++) {
      const t2 = transactions[j];
      if (processedTxIds.has(t2.id)) continue;
      if (t2.metadata?.duplicate_dismissed || t2.metadata?.duplicate_kept || t2.metadata?.duplicate_resolved) continue;

      // Strict Account Context: Must be on the exact same bank account (both must be non-null and identical)
      if (!t1.bank_account_id || !t2.bank_account_id || t1.bank_account_id !== t2.bank_account_id) continue;

      // Provider External ID Check: Distinct provider transaction IDs on the same account are separate legitimate transactions
      if (t1.external_id && t2.external_id && t1.external_id !== t2.external_id) {
        continue;
      }

      // Skip paired transfer partners
      if (t1.metadata?.paired_transfer_id === t2.id || t2.metadata?.paired_transfer_id === t1.id) continue;
      if (t1.paired_transfer_id === t2.id || t2.paired_transfer_id === t1.id) continue;

      // Direction/Sign match (must both be expense or both be income)
      const amount2 = Number(t2.amount || 0);
      const isExpense1 = t1.transaction_type === 'expense' || amount1 < 0;
      const isExpense2 = t2.transaction_type === 'expense' || amount2 < 0;
      if (isExpense1 !== isExpense2) continue;

      // Exact amount match (within 0.01)
      const absAmt2 = Math.abs(amount2);
      if (Math.abs(absAmt1 - absAmt2) >= 0.01) continue;

      // Date match within max 2 days clearance window
      const date2 = new Date(t2.date).getTime();
      const diffDays = Math.abs(date1 - date2) / (1000 * 60 * 60 * 24);
      if (diffDays > 2) continue;

      // Description similarity match
      const descMatch = areDescriptionsMatching(t1, t2);
      if (!descMatch) continue;

      // If dates differ by 1-2 days, require non-empty description
      if (diffDays > 0.05) {
        const hasDesc1 = Boolean(cleanDescription(t1.description) || cleanDescription(t1.original_description));
        const hasDesc2 = Boolean(cleanDescription(t2.description) || cleanDescription(t2.original_description));
        if (!hasDesc1 || !hasDesc2) continue;
      }

      group.push(t2);
    }

    if (group.length > 1) {
      group.forEach(t => processedTxIds.add(t.id));

      group.sort((a, b) => {
        if (a.status === 'posted' && b.status !== 'posted') return -1;
        if (b.status === 'posted' && a.status !== 'posted') return 1;
        if (a.category_account_id && !b.category_account_id) return -1;
        if (b.category_account_id && !a.category_account_id) return 1;
        if (a.source === 'plaid' && b.source !== 'plaid') return -1;
        if (b.source === 'plaid' && a.source !== 'plaid') return 1;
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });

      const primary = group[0];
      const duplicates = group.slice(1);

      duplicateGroups.push({
        groupId: `dup-${primary.id}`,
        accountName: primary.bank_account?.display_name || primary.bank_account?.account_name || 'Bank Account',
        accountMask: primary.bank_account?.account_mask || null,
        bankAccountId: primary.bank_account_id,
        amount: absAmt1,
        type: primary.transaction_type || (amount1 >= 0 ? 'income' : 'expense'),
        matchReason: `Matching amount ($${absAmt1.toFixed(2)}) & description`,
        originalTransaction: pickPublicTransaction(primary),
        duplicateTransactions: duplicates.map(pickPublicTransaction)
      });
    }
  }

  const totalDuplicatesCount = duplicateGroups.reduce((sum, g) => sum + g.duplicateTransactions.length, 0);

  return {
    groups: duplicateGroups,
    totalDuplicatesCount
  };
}

async function resolveDuplicateTransactionsForProfile(profileId, userId, payload = {}) {
  const { deleteTransactionIds = [], keepTransactionIds = [] } = payload;
  const deletedIds = Array.isArray(deleteTransactionIds) ? deleteTransactionIds : [];
  const keptIds = Array.isArray(keepTransactionIds) ? keepTransactionIds : [];

  if (deletedIds.length === 0 && keptIds.length === 0) {
    return { success: true, deletedCount: 0, keptCount: 0, affectedAccountIds: [] };
  }

  const affectedAccountIds = new Set();

  await prisma.$transaction(async (tx) => {
    // 1. Delete transactions chosen for deletion
    for (const txId of deletedIds) {
      const transaction = await tx.transaction.findFirst({
        where: {
          id: txId,
          profile_id: profileId,
          deleted_at: null
        },
        include: { journal_entry: true }
      });

      if (!transaction) continue;

      if (transaction.bank_account_id) {
        affectedAccountIds.add(transaction.bank_account_id);
      }

      // If it was posted and had a journal entry, void the journal entry
      if (transaction.journal_entry_id) {
        await tx.journalEntry.update({
          where: { id: transaction.journal_entry_id },
          data: {
            status: 'voided',
            source_transaction_id: null,
            deleted_at: new Date()
          }
        });
      }

      // Mark transaction as deleted
      await tx.transaction.update({
        where: { id: txId },
        data: {
          status: 'deleted',
          deleted_at: new Date(),
          metadata: {
            ...normalizeJson(transaction.metadata),
            duplicate_resolved: true,
            duplicate_deleted: true,
            resolved_at: new Date().toISOString()
          }
        }
      });

      await createAuditLog(tx, {
        profileId,
        userId,
        entityType: 'transaction',
        entityId: txId,
        action: 'delete_duplicate_transaction',
        beforeData: pickPublicTransaction(transaction),
        afterData: null,
        reason: 'Duplicate transaction removed during reconnection/reconciliation review'
      });
    }

    // 2. Mark transactions chosen to Keep as dismissed/kept
    for (const txId of keptIds) {
      const transaction = await tx.transaction.findFirst({
        where: {
          id: txId,
          profile_id: profileId,
          deleted_at: null
        }
      });

      if (!transaction) continue;

      await tx.transaction.update({
        where: { id: txId },
        data: {
          metadata: {
            ...normalizeJson(transaction.metadata),
            duplicate_dismissed: true,
            duplicate_kept: true,
            duplicate_resolved: true,
            resolved_at: new Date().toISOString()
          }
        }
      });

      await createAuditLog(tx, {
        profileId,
        userId,
        entityType: 'transaction',
        entityId: txId,
        action: 'keep_duplicate_transaction',
        beforeData: pickPublicTransaction(transaction),
        afterData: { ...pickPublicTransaction(transaction), duplicate_kept: true },
        reason: 'Transaction kept and dismissed from duplicate review'
      });
    }

    // Recalculate balances for affected accounts
    const accountIdsArray = [...affectedAccountIds];
    if (accountIdsArray.length > 0) {
      await refreshBalancesForAccountIds(tx, accountIdsArray);
    }
  });

  return {
    success: true,
    deletedCount: deletedIds.length,
    keptCount: keptIds.length,
    affectedAccountIds: [...affectedAccountIds]
  };
}

module.exports = {
  listTransactionsForProfile,
  getTransactionForProfile,
  listTransactionSplitsForProfile,
  replaceTransactionSplitsForProfile,
  deleteTransactionSplitsForProfile,
  createTransactionForProfile,
  createTransactionInTransaction,
  createTransactionsForProfile,
  updateTransactionForProfile,
  deleteTransactionForProfile,
  undoPostedTransactionForProfile,
  unpostTransactionInTransaction,
  postTransactionForProfile,
  findDuplicateTransactionsForProfile,
  resolveDuplicateTransactionsForProfile,
  pickPublicTransaction
};
