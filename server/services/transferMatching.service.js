const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');
const { createNotificationsForProfileMembers } = require('./notification.service');
const { pickPublicJournalEntry } = require('./journalEntry.service');

const PENDING_STATUS = 'pending';

/**
 * Determine transfer classification and human-readable label based on accounts
 */
function determineTransferClassification(sourceAccount, targetAccount, sourceAmount = 0) {
  const sourceClass = sourceAccount?.class || (sourceAccount?.account_type === 'credit_card' ? 'liability' : 'asset');
  const targetClass = targetAccount?.class || (targetAccount?.account_type === 'credit_card' ? 'liability' : 'asset');
  const sourceDetail = (sourceAccount?.account_detail || '').toLowerCase();
  const targetDetail = (targetAccount?.account_detail || '').toLowerCase();

  const isSourceCC = sourceClass === 'liability' || sourceDetail.includes('credit');
  const isTargetCC = targetClass === 'liability' || targetDetail.includes('credit');

  if (isSourceCC || isTargetCC) {
    return {
      transfer_type: 'credit_card_payment',
      label: 'Credit Card Payment',
      is_credit_card: true
    };
  }

  return {
    transfer_type: 'bank_transfer',
    label: 'Bank Transfer',
    is_credit_card: false
  };
}

/**
 * Find potential transfer matches for a transaction
 */
async function findTransferMatchesForProfile(profileId, transactionId) {
  const transaction = await findActiveTransaction(profileId, transactionId);
  if (transaction.status !== PENDING_STATUS && transaction.status !== 'posted') return [];

  const candidates = await prisma.transaction.findMany({
    where: {
      profile_id: profileId,
      status: PENDING_STATUS,
      deleted_at: null,
      id: { not: transactionId },
      ...(transaction.bank_account_id ? { bank_account_id: { not: transaction.bank_account_id } } : {})
    },
    include: {
      bank_account: true,
      category_account: true
    }
  });

  const sourceAccount = transaction.bank_account || (transaction.bank_account_id
    ? await prisma.userChartOfAccount.findUnique({ where: { id: transaction.bank_account_id } })
    : null);

  return candidates
    .filter((candidate) => !getPairedTransactionId(candidate) || getPairedTransactionId(candidate) === transaction.id)
    .map((candidate) => buildMatch(transaction, sourceAccount, candidate))
    .filter(Boolean)
    .sort((left, right) => right.confidence_score - left.confidence_score);
}

/**
 * Pair two transactions persistently without posting yet (or prepares them as a matched pair)
 */
async function pairTransfersForProfile(profileId, transactionId, matchedTransactionId, options = {}) {
  if (transactionId === matchedTransactionId) {
    throw ApiError.badRequest('A transaction cannot be matched to itself');
  }

  return prisma.$transaction(async (tx) => {
    const transactions = await tx.transaction.findMany({
      where: {
        profile_id: profileId,
        deleted_at: null,
        id: { in: [transactionId, matchedTransactionId] }
      },
      include: {
        bank_account: true,
        category_account: true
      }
    });

    if (transactions.length !== 2) {
      throw ApiError.notFound('One or both transactions were not found');
    }

    const first = transactions.find((t) => t.id === transactionId);
    const second = transactions.find((t) => t.id === matchedTransactionId);
    validatePairable(first, second);

    const classification = determineTransferClassification(
      first.bank_account,
      second.bank_account,
      Number(first.amount)
    );

    const firstData = buildPairedTransactionData(first, second.id, second.bank_account_id, classification.transfer_type);
    const secondData = buildPairedTransactionData(second, first.id, first.bank_account_id, classification.transfer_type);

    await Promise.all([
      tx.transaction.update({
        where: { id: first.id },
        data: firstData
      }),
      tx.transaction.update({
        where: { id: second.id },
        data: secondData
      })
    ]);

    // Update suggestion status if one exists
    const [id1, id2] = [first.id, second.id].sort();
    await tx.transferMatchSuggestion.updateMany({
      where: {
        profile_id: profileId,
        transaction_1_id: id1,
        transaction_2_id: id2
      },
      data: { status: 'accepted' }
    });

    // If options.post === true, post both atomically with a single journal entry
    if (options.post) {
      return matchAndPostTransfersInTransaction(tx, profileId, first.id, second.id, options.userId || null);
    }

    return {
      transactionId: first.id,
      matchedTransactionId: second.id,
      transfer_type: classification.transfer_type,
      label: classification.label
    };
  });
}

/**
 * Atomically match, create a single dual-sided Journal Entry, and post both transactions
 */
async function matchAndPostTransfersForProfile(profileId, transactionId, matchedTransactionId, userId = null) {
  if (transactionId === matchedTransactionId) {
    throw ApiError.badRequest('A transaction cannot be matched to itself');
  }

  return prisma.$transaction(async (tx) => {
    return matchAndPostTransfersInTransaction(tx, profileId, transactionId, matchedTransactionId, userId);
  });
}

/**
 * Internal logic to match and post two transactions atomically
 */
async function matchAndPostTransfersInTransaction(tx, profileId, transactionId, matchedTransactionId, userId = null) {
  const transactions = await tx.transaction.findMany({
    where: {
      profile_id: profileId,
      deleted_at: null,
      id: { in: [transactionId, matchedTransactionId] }
    },
    include: {
      bank_account: true,
      category_account: true
    }
  });

  if (transactions.length !== 2) {
    throw ApiError.notFound('One or both transactions were not found');
  }

  const first = transactions.find((t) => t.id === transactionId);
  const second = transactions.find((t) => t.id === matchedTransactionId);

  if (first.status === 'posted' && second.status === 'posted' && first.journal_entry_id && first.journal_entry_id === second.journal_entry_id) {
    return {
      transactionId: first.id,
      matchedTransactionId: second.id,
      journal_entry_id: first.journal_entry_id,
      status: 'posted'
    };
  }

  if (first.bank_account_id && first.bank_account_id === second.bank_account_id) {
    throw ApiError.badRequest('Transfers must be matched across different accounts');
  }

  if (!first.bank_account_id || !second.bank_account_id) {
    throw ApiError.badRequest('Both transactions must have a bank account assigned before matching');
  }

  const classification = determineTransferClassification(
    first.bank_account,
    second.bank_account,
    Number(first.amount)
  );

  const amount = Math.abs(Number(first.amount || second.amount || 0));
  if (amount <= 0) {
    throw ApiError.badRequest('Transfer amount must be greater than zero');
  }

  // Build dual-sided journal entry lines
  const lines = buildTransferJournalLines(first, second, amount);
  assertBalancedJournalLines(lines);

  const entryNumber = await getNextJournalEntryNumber(profileId, tx);
  const entryDate = first.date || second.date || new Date();
  const postedAt = new Date();

  // Create single balanced journal entry
  const journalEntry = await tx.journalEntry.create({
    data: {
      profile_id: profileId,
      entry_number: entryNumber,
      entry_date: entryDate,
      description: classification.label,
      memo: first.memo || second.memo || `${first.description} / ${second.description}`,
      source: 'transaction',
      source_transaction_id: first.id,
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

  const firstData = {
    status: 'posted',
    posted_date: first.posted_date || entryDate,
    journal_entry_id: journalEntry.id,
    category_account_id: second.bank_account_id,
    transaction_type: 'transfer',
    metadata: {
      ...normalizeMetadata(first.metadata),
      paired_transfer_id: second.id,
      is_transfer_pair: true,
      transfer_type: classification.transfer_type,
      other_account_id: second.bank_account_id,
      current_journal_entry_id: journalEntry.id
    }
  };

  const secondData = {
    status: 'posted',
    posted_date: second.posted_date || entryDate,
    journal_entry_id: journalEntry.id,
    category_account_id: first.bank_account_id,
    transaction_type: 'transfer',
    metadata: {
      ...normalizeMetadata(second.metadata),
      paired_transfer_id: first.id,
      is_transfer_pair: true,
      transfer_type: classification.transfer_type,
      other_account_id: first.bank_account_id,
      current_journal_entry_id: journalEntry.id
    }
  };

  await Promise.all([
    tx.transaction.update({ where: { id: first.id }, data: firstData }),
    tx.transaction.update({ where: { id: second.id }, data: secondData })
  ]);

  // Update suggestions
  const [id1, id2] = [first.id, second.id].sort();
  await tx.transferMatchSuggestion.updateMany({
    where: {
      profile_id: profileId,
      transaction_1_id: id1,
      transaction_2_id: id2
    },
    data: { status: 'accepted' }
  });

  // Refresh balances for both accounts
  await refreshBalancesForAccountIds(tx, [first.bank_account_id, second.bank_account_id]);

  // Create audit logs
  await createAuditLog(tx, {
    profileId,
    userId,
    entityType: 'journal_entry',
    entityId: journalEntry.id,
    action: 'create_journal_entry',
    beforeData: null,
    afterData: {
      id: journalEntry.id,
      entry_number: journalEntry.entry_number,
      description: journalEntry.description,
      lines: lines
    },
    reason: `Transfer matched: ${classification.label}`
  });

  return {
    transactionId: first.id,
    matchedTransactionId: second.id,
    journal_entry_id: journalEntry.id,
    status: 'posted',
    transfer_type: classification.transfer_type,
    label: classification.label
  };
}

/**
 * Unmatch / unpair two transactions.
 * If already posted, voids the shared journal entry and moves both back to pending.
 * If pending, removes the pairing relationship so they become independent transactions.
 */
async function unmatchTransferForProfile(profileId, transactionId, userId = null) {
  return prisma.$transaction(async (tx) => {
    const transaction = await tx.transaction.findFirst({
      where: { id: transactionId, profile_id: profileId, deleted_at: null },
      include: { bank_account: true }
    });

    if (!transaction) throw ApiError.notFound('Transaction not found');

    const pairedTransactionId = getPairedTransactionId(transaction);
    let pairedTransaction = null;

    if (pairedTransactionId) {
      pairedTransaction = await tx.transaction.findFirst({
        where: { id: pairedTransactionId, profile_id: profileId, deleted_at: null },
        include: { bank_account: true }
      });
    }

    // Check if there is an associated shared journal entry
    const journalEntryId = transaction.journal_entry_id || pairedTransaction?.journal_entry_id;
    const affectedAccountIds = new Set([transaction.bank_account_id, pairedTransaction?.bank_account_id].filter(Boolean));

    // Reset primary transaction
    await tx.transaction.update({
      where: { id: transaction.id },
      data: buildUnpairedTransactionData(transaction)
    });

    // Reset paired transaction if found
    if (pairedTransaction) {
      await tx.transaction.update({
        where: { id: pairedTransaction.id },
        data: buildUnpairedTransactionData(pairedTransaction)
      });
    }

    if (journalEntryId) {
      const je = await tx.journalEntry.findUnique({
        where: { id: journalEntryId },
        include: { lines: true }
      });

      if (je) {
        if (je.lines?.length) {
          je.lines.forEach((l) => affectedAccountIds.add(l.account_id));
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
              debit: Number(l.debit || 0),
              credit: Number(l.credit || 0)
            }))
          },
          afterData: null,
          reason: 'Journal entry removed due to transfer unmatching'
        });

        await tx.journalEntry.delete({
          where: { id: je.id }
        });
      }
    }

    // Reset suggestions
    if (pairedTransaction) {
      const [id1, id2] = [transaction.id, pairedTransaction.id].sort();
      await tx.transferMatchSuggestion.updateMany({
        where: {
          profile_id: profileId,
          transaction_1_id: id1,
          transaction_2_id: id2
        },
        data: { status: 'pending' }
      });
    }

    // Refresh balances if journal entry was removed
    if (affectedAccountIds.size > 0) {
      await refreshBalancesForAccountIds(tx, [...affectedAccountIds]);
    }

    return {
      transactionId: transaction.id,
      matchedTransactionId: pairedTransaction?.id || null,
      status: 'unpaired'
    };
  });
}

/**
 * Automatically find and pair high-confidence opposite transactions
 */
async function autoMatchTransfersForProfile(profileId, minConfidence = 80) {
  const transactions = await prisma.transaction.findMany({
    where: { profile_id: profileId, status: PENDING_STATUS, deleted_at: null },
    include: {
      bank_account: true,
      category_account: true
    }
  });

  const processed = new Set();
  let matchedCount = 0;
  let suggestionCount = 0;

  for (const transaction of transactions) {
    if (processed.has(transaction.id) || getPairedTransactionId(transaction)) continue;

    const candidates = transactions
      .filter((candidate) => candidate.id !== transaction.id && !processed.has(candidate.id) && !getPairedTransactionId(candidate))
      .map((candidate) => buildMatch(transaction, transaction.bank_account, candidate))
      .filter(Boolean)
      .sort((left, right) => right.confidence_score - left.confidence_score);

    const bestMatch = candidates[0];
    if (!bestMatch) continue;

    if (bestMatch.confidence_score >= minConfidence) {
      // High-confidence match: pair them persistently
      await pairTransfersForProfile(profileId, transaction.id, bestMatch.match_transaction_id, { post: false });
      processed.add(transaction.id);
      processed.add(bestMatch.match_transaction_id);
      matchedCount += 1;
    } else {
      await upsertSuggestion(profileId, transaction.id, bestMatch);
      suggestionCount += 1;
    }
  }

  return { matched_count: matchedCount, suggestion_count: suggestionCount };
}

/**
 * Builds match candidate comparison and confidence score
 */
function buildMatch(transaction, sourceAccount, candidate) {
  if (transaction.bank_account_id && candidate.bank_account_id && transaction.bank_account_id === candidate.bank_account_id) {
    return null;
  }

  const txAmount = Math.abs(Number(transaction.amount || 0));
  const candAmount = Math.abs(Number(candidate.amount || 0));
  if (Math.abs(txAmount - candAmount) >= 0.01) return null;

  const firstSign = Number(transaction.amount || 0) >= 0 ? 'positive' : 'negative';
  const secondSign = Number(candidate.amount || 0) >= 0 ? 'positive' : 'negative';

  // Money must move in opposite directions across accounts
  if (firstSign === secondSign) return null;

  const dayDifference = Math.abs(new Date(transaction.date).getTime() - new Date(candidate.date).getTime()) / 86400000;
  if (dayDifference > 7) return null;

  const targetAccount = candidate.bank_account;
  const classification = determineTransferClassification(sourceAccount, targetAccount, Number(transaction.amount));

  const reasons = ['Exact amount match'];
  let confidence = 75;

  if (dayDifference === 0) {
    confidence += 15;
    reasons.push('Same transaction date');
  } else if (dayDifference <= 1) {
    confidence += 10;
    reasons.push('Date within 1 day');
  } else if (dayDifference <= 3) {
    confidence += 5;
    reasons.push('Date within 3 days');
  }

  if (firstSign !== secondSign) {
    confidence += 5;
    reasons.push('Opposite cash flow direction');
  }

  if (descriptionsOverlap(transaction.description, candidate.description) ||
      descriptionsOverlap(transaction.original_description, candidate.original_description)) {
    confidence += 5;
    reasons.push('Similar description');
  }

  // Check for transfer-specific keywords
  if (hasTransferKeywords(transaction.description) || hasTransferKeywords(candidate.description) ||
      hasTransferKeywords(transaction.original_description) || hasTransferKeywords(candidate.original_description)) {
    confidence += 5;
    reasons.push('Transfer / payment description keywords');
  }

  return {
    match_transaction_id: candidate.id,
    match_account_name: targetAccount?.display_name || targetAccount?.account_name || 'Bank Account',
    match_account_id: candidate.bank_account_id,
    match_date: candidate.date,
    match_amount: candidate.amount,
    match_description: candidate.description,
    confidence_score: Math.min(100, Math.round(confidence * 100) / 100),
    match_reasons: reasons,
    transfer_type: classification.transfer_type,
    label: classification.label
  };
}

function hasTransferKeywords(desc) {
  const str = String(desc || '').toLowerCase();
  return ['transfer', 'autopay', 'payment', 'pymt', 'online payment', 'xfer', 'card payment', 'bill pay', 'mobile transfer'].some(k => str.includes(k));
}

function validatePairable(first, second) {
  if (first.bank_account_id && first.bank_account_id === second.bank_account_id) {
    throw ApiError.badRequest('Transfers must be matched across different accounts');
  }
}

function buildPairedTransactionData(transaction, pairedTransactionId, otherAccountId, transferType) {
  const metadata = normalizeMetadata(transaction.metadata);
  return {
    transaction_type: 'transfer',
    category_account_id: otherAccountId || transaction.category_account_id || null,
    metadata: {
      ...metadata,
      paired_transfer_id: pairedTransactionId,
      is_transfer_pair: true,
      transfer_type: transferType,
      other_account_id: otherAccountId || null,
      original_type: metadata.original_type || transaction.transaction_type || inferDirection(transaction)
    }
  };
}

function buildUnpairedTransactionData(transaction) {
  const metadata = normalizeMetadata(transaction.metadata);
  return {
    status: 'pending',
    posted_date: null,
    journal_entry_id: null,
    transaction_type: metadata.original_type || inferDirection(transaction),
    category_account_id: null,
    metadata: {
      ...metadata,
      paired_transfer_id: null,
      is_transfer_pair: false,
      transfer_type: null,
      other_account_id: null,
      original_type: null
    }
  };
}

function buildTransferJournalLines(first, second, amount) {
  const line1 = buildSingleTransferJournalLine(first, amount);
  const line2 = buildSingleTransferJournalLine(second, amount);
  return [line1, line2];
}

function buildSingleTransferJournalLine(transaction, amount) {
  const account = transaction.bank_account;
  const isAsset = account?.class === 'asset' || (!account?.class && account?.account_type !== 'credit_card');
  const signedAmount = Number(transaction.amount || 0);

  if (isAsset) {
    // Asset account: positive amount is money in (Debit), negative amount is money out (Credit)
    return {
      account_id: transaction.bank_account_id,
      contact_id: transaction.contact_id || null,
      description: transaction.description || 'Transfer',
      debit: signedAmount >= 0 ? amount : 0,
      credit: signedAmount < 0 ? amount : 0
    };
  } else {
    // Liability account (Credit Card): positive amount is payment received reducing debt (Debit),
    // negative amount is charge / advance increasing debt (Credit)
    return {
      account_id: transaction.bank_account_id,
      contact_id: transaction.contact_id || null,
      description: transaction.description || 'Credit Card Payment',
      debit: signedAmount >= 0 ? amount : 0,
      credit: signedAmount < 0 ? amount : 0
    };
  }
}

function assertBalancedJournalLines(lines) {
  const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);

  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    throw ApiError.badRequest('Journal entry debits must equal credits');
  }
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
    const isDebitNormal = ['asset', 'expense'].includes(account.class);
    const balance = isDebitNormal
      ? Math.round((debit - credit) * 100) / 100
      : Math.round((credit - debit) * 100) / 100;

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
  reason
}) {
  await tx.auditLog.create({
    data: {
      profile_id: profileId,
      user_id: userId,
      entity_type: entityType,
      entity_id: entityId,
      action,
      before_data: beforeData ? JSON.parse(JSON.stringify(beforeData)) : null,
      after_data: afterData ? JSON.parse(JSON.stringify(afterData)) : null,
      reason: reason || `Action: ${action}`
    }
  });
}

async function upsertSuggestion(profileId, transactionId, match) {
  const [firstId, secondId] = [transactionId, match.match_transaction_id].sort();

  await prisma.$transaction(async (tx) => {
    await tx.transferMatchSuggestion.upsert({
      where: { transaction_1_id_transaction_2_id: { transaction_1_id: firstId, transaction_2_id: secondId } },
      create: {
        profile_id: profileId,
        transaction_1_id: firstId,
        transaction_2_id: secondId,
        confidence_score: match.confidence_score,
        match_reasons: match.match_reasons,
        status: 'pending'
      },
      update: { confidence_score: match.confidence_score, match_reasons: match.match_reasons, status: 'pending' }
    });

    await createNotificationsForProfileMembers(profileId, {
      source: 'transfer_matching',
      source_id: `${firstId}:${secondId}`,
      event_type: 'transfer_match.suggested',
      delivery_key: `transfer_match:suggested:${firstId}:${secondId}`,
      title: 'Transfer match suggested',
      body: `A possible transfer match was found with ${Math.round(Number(match.confidence_score || 0))}% confidence.`,
      action_url: '/Banking?tab=transactions',
      priority: 'normal',
      metadata: {
        transaction_1_id: firstId,
        transaction_2_id: secondId,
        confidence_score: match.confidence_score,
        match_reasons: match.match_reasons
      }
    }, { db: tx });
  });
}

async function findActiveTransaction(profileId, transactionId) {
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, profile_id: profileId, deleted_at: null },
    include: { bank_account: true, category_account: true }
  });
  if (!transaction) throw ApiError.notFound('Transaction not found');
  return transaction;
}

function getPairedTransactionId(transaction) {
  return normalizeMetadata(transaction.metadata).paired_transfer_id || null;
}

function inferDirection(transaction) {
  return Number(transaction.amount) >= 0 ? 'income' : 'expense';
}

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function descriptionsOverlap(first, second) {
  const words = String(first || '').toLowerCase().match(/[a-z0-9]{4,}/g) || [];
  const candidate = String(second || '').toLowerCase();
  return words.some((word) => candidate.includes(word));
}

module.exports = {
  findTransferMatchesForProfile,
  pairTransfersForProfile,
  matchAndPostTransfersForProfile,
  unmatchTransferForProfile,
  autoMatchTransfersForProfile,
  determineTransferClassification
};
