const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');
const { parsePaginationQuery, buildPaginationMeta } = require('../utils/pagination');
const { pickPublicAccount } = require('./account.service');
const { deleteObject, uploadPublicObject } = require('./fileStorage.service');

const JOURNAL_STATUSES = new Set(['draft', 'posted', 'voided']);
const JOURNAL_SORT_FIELDS = new Set(['entry_date', 'entry_number', 'description', 'source', 'status', 'created_at', 'updated_at']);

async function createJournalEntryForProfile(profileId, userId, input = {}) {
  const lines = normalizeLines(input.lines);
  assertBalanced(lines);
  const status = normalizeJournalStatus(input.status) || 'posted';

  const entry = await prisma.$transaction(async (tx) => {
    await assertLineAccountsBelongToProfile(tx, profileId, lines);
    const entryNumber = await getNextJournalEntryNumber(profileId, tx);
    const created = await tx.journalEntry.create({
      data: {
        profile_id: profileId,
        entry_number: entryNumber,
        entry_date: parseDate(input.entryDate ?? input.entry_date, 'entry_date'),
        description: normalizeRequiredString(input.description, 'description'),
        memo: normalizeNullableString(input.memo),
        source: normalizeNullableString(input.source) || 'manual',
        status,
        created_by_user_id: userId,
        posted_at: status === 'posted' ? new Date() : null,
        lines: {
          create: lines.map((line) => ({
            account_id: line.account_id,
            contact_id: line.contact_id,
            description: line.description,
            debit: line.debit,
            credit: line.credit
          }))
        }
      }
    });

    const entryWithLines = await tx.journalEntry.findUnique({
      where: { id: created.id },
      include: JOURNAL_INCLUDE
    });

    if (status === 'posted') {
      await refreshBalancesForAccountIds(tx, lines.map((line) => line.account_id));
    }

    await createAuditLog(tx, {
      profileId,
      userId,
      entityId: created.id,
      action: 'create_journal_entry',
      beforeData: null,
      afterData: pickPublicJournalEntry(entryWithLines),
      reason: getAuditReason(input, 'Journal entry created')
    });

    return entryWithLines;
  });

  return pickPublicJournalEntry(entry);
}

async function createOpeningBalanceJournalEntryForProfile(profileId, userId, input = {}, externalTx = null) {
  return createOrUpdateOpeningBalanceJournalEntryForProfile(profileId, userId, input, externalTx);
}

async function createOrUpdateOpeningBalanceJournalEntryForProfile(profileId, userId, input = {}, externalTx = null) {
  const accountId = normalizeRequiredString(input.accountId ?? input.account_id, 'account_id');
  const rawOpeningBalance = input.openingBalance ?? input.opening_balance;
  const openingBalance = parseMoney(rawOpeningBalance !== undefined && rawOpeningBalance !== null ? rawOpeningBalance : 0, 'opening_balance');
  const executeInTx = externalTx
    ? (cb) => cb(externalTx)
    : (cb) => prisma.$transaction(cb);

  return executeInTx(async (tx) => {
    const account = await tx.userChartOfAccount.findFirst({
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

    // Check if an existing opening balance journal entry exists for this account
    const existingEntry = await tx.journalEntry.findFirst({
      where: {
        profile_id: profileId,
        source: 'opening_balance',
        deleted_at: null,
        lines: {
          some: { account_id: account.id }
        }
      },
      include: { lines: true }
    });

    // If opening balance is zero (or near zero)
    if (Math.abs(openingBalance) < 0.01) {
      if (existingEntry) {
        const oldAccountIds = (existingEntry.lines || []).map((l) => l.account_id);
        await tx.journalEntry.update({
          where: { id: existingEntry.id },
          data: {
            status: 'voided',
            deleted_at: new Date()
          }
        });
        await refreshBalancesForAccountIds(tx, oldAccountIds);
      }
      return null;
    }

    const offsetAccount = await findOrCreateOpeningBalanceAccount(profileId, tx);
    const amount = Math.abs(openingBalance);
    const accountClass = String(input.accountClass ?? input.account_class ?? account.class).toLowerCase();
    const isNormalDebit = ['asset', 'expense'].includes(accountClass);

    let debitAccountId;
    let creditAccountId;

    if (isNormalDebit) {
      // Asset / Expense
      if (openingBalance >= 0) {
        debitAccountId = account.id;
        creditAccountId = offsetAccount.id;
      } else {
        // Overdrawn asset (credit balance)
        debitAccountId = offsetAccount.id;
        creditAccountId = account.id;
      }
    } else {
      // Liability / Equity / Income
      if (openingBalance >= 0) {
        debitAccountId = offsetAccount.id;
        creditAccountId = account.id;
      } else {
        // Negative liability / credit balance
        debitAccountId = account.id;
        creditAccountId = offsetAccount.id;
      }
    }

    const entryDate = parseDate(
      input.openingDate ?? input.opening_date ?? input.as_of_date ?? input.asOfDate ?? new Date().toISOString().slice(0, 10),
      'opening_date'
    );
    const accountDisplayName = input.accountName ?? input.account_name ?? account.display_name ?? account.account_name ?? 'Account';
    const description = `Opening balance - ${accountDisplayName}`;

    if (existingEntry) {
      const oldAccountIds = (existingEntry.lines || []).map((l) => l.account_id);

      await tx.journalEntry.update({
        where: { id: existingEntry.id },
        data: {
          entry_date: entryDate,
          description,
          status: 'posted',
          posted_at: new Date(),
          updated_at: new Date()
        }
      });

      await tx.journalEntryLine.deleteMany({
        where: { journal_entry_id: existingEntry.id }
      });

      await tx.journalEntryLine.createMany({
        data: [
          {
            journal_entry_id: existingEntry.id,
            account_id: debitAccountId,
            debit: amount,
            credit: 0,
            description: 'Opening balance'
          },
          {
            journal_entry_id: existingEntry.id,
            account_id: creditAccountId,
            debit: 0,
            credit: amount,
            description: 'Opening balance offset'
          }
        ]
      });

      const updatedEntry = await tx.journalEntry.findUnique({
        where: { id: existingEntry.id },
        include: JOURNAL_INCLUDE
      });

      await refreshBalancesForAccountIds(tx, [
        account.id,
        offsetAccount.id,
        ...oldAccountIds
      ]);

      await tx.userChartOfAccount.update({
        where: { id: account.id },
        data: {
          opening_balance: openingBalance !== 0 ? openingBalance : null,
          metadata: {
            ...(account.metadata && typeof account.metadata === 'object' && !Array.isArray(account.metadata) ? account.metadata : {}),
            opening_balance_date: input.openingDate ?? input.opening_date ?? input.as_of_date ?? input.asOfDate ?? new Date().toISOString().slice(0, 10),
            as_of_date: input.openingDate ?? input.opening_date ?? input.as_of_date ?? input.asOfDate ?? new Date().toISOString().slice(0, 10)
          }
        }
      });

      return pickPublicJournalEntry(updatedEntry);
    }

    // Create brand new opening balance journal entry
    const entryNumber = await getNextJournalEntryNumber(profileId, tx);
    const created = await tx.journalEntry.create({
      data: {
        profile_id: profileId,
        entry_number: entryNumber,
        entry_date: entryDate,
        description,
        source: 'opening_balance',
        status: 'posted',
        created_by_user_id: userId,
        posted_at: new Date(),
        lines: {
          create: [
            {
              account_id: debitAccountId,
              debit: amount,
              credit: 0,
              description: 'Opening balance'
            },
            {
              account_id: creditAccountId,
              debit: 0,
              credit: amount,
              description: 'Opening balance offset'
            }
          ]
        }
      },
      include: JOURNAL_INCLUDE
    });

    await refreshBalancesForAccountIds(tx, [account.id, offsetAccount.id]);

    await tx.userChartOfAccount.update({
      where: { id: account.id },
      data: {
        opening_balance: openingBalance !== 0 ? openingBalance : null,
        metadata: {
          ...(account.metadata && typeof account.metadata === 'object' && !Array.isArray(account.metadata) ? account.metadata : {}),
          opening_balance_date: input.openingDate ?? input.opening_date ?? input.as_of_date ?? input.asOfDate ?? new Date().toISOString().slice(0, 10),
          as_of_date: input.openingDate ?? input.opening_date ?? input.as_of_date ?? input.asOfDate ?? new Date().toISOString().slice(0, 10)
        }
      }
    });

    await createAuditLog(tx, {
      profileId,
      userId,
      entityId: created.id,
      action: 'create_opening_balance_journal_entry',
      beforeData: null,
      afterData: pickPublicJournalEntry(created),
      reason: `Opening balance established for ${accountDisplayName}`
    });

    return pickPublicJournalEntry(created);
  });
}

async function voidOpeningBalanceJournalEntryForAccount(profileId, accountId, externalTx = null) {
  const executeInTx = externalTx
    ? (cb) => cb(externalTx)
    : (cb) => prisma.$transaction(cb);

  return executeInTx(async (tx) => {
    const existingEntry = await tx.journalEntry.findFirst({
      where: {
        profile_id: profileId,
        source: 'opening_balance',
        deleted_at: null,
        lines: {
          some: { account_id: accountId }
        }
      },
      include: { lines: true }
    });

    if (!existingEntry) return null;

    const accountIds = (existingEntry.lines || []).map((l) => l.account_id);

    await tx.journalEntry.update({
      where: { id: existingEntry.id },
      data: {
        status: 'voided',
        deleted_at: new Date()
      }
    });

    await refreshBalancesForAccountIds(tx, accountIds);
    return existingEntry.id;
  });
}

async function getJournalEntryForProfile(profileId, entryId) {
  const entry = await findJournalEntry(profileId, entryId);
  return pickPublicJournalEntry(entry);
}

async function listJournalEntryAttachmentsForProfile(profileId, entryId) {
  await findJournalEntry(profileId, entryId);

  const attachments = await prisma.journalEntryAttachment.findMany({
    where: {
      profile_id: profileId,
      journal_entry_id: entryId
    },
    orderBy: { created_at: 'desc' }
  });

  return {
    attachments: attachments.map(pickPublicAttachment)
  };
}

async function createJournalEntryAttachmentForProfile(profileId, userId, entryId, input = {}, options = {}) {
  await findJournalEntry(profileId, entryId);

  if (!options.file) {
    throw ApiError.badRequest('File is required', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const uploadedFile = await uploadJournalEntryAttachmentFile(options.file, { userId, profileId });

  let attachment;
  try {
    attachment = await prisma.journalEntryAttachment.create({
      data: {
        journal_entry_id: entryId,
        profile_id: profileId,
        uploaded_by_user_id: userId,
        file_name: uploadedFile?.fileName || normalizeRequiredString(input.fileName ?? input.file_name, 'file_name'),
        file_size: uploadedFile?.fileSize ?? Number(input.fileSize ?? input.file_size ?? 0),
        file_type: uploadedFile?.fileType || normalizeRequiredString(input.fileType ?? input.file_type, 'file_type'),
        storage_path: uploadedFile?.key || normalizeRequiredString(input.storagePath ?? input.storage_path, 'storage_path')
      }
    });
  } catch (error) {
    if (uploadedFile?.key) {
      await deleteStorageObject(uploadedFile.key);
    }
    throw error;
  }

  return {
    attachment: pickPublicAttachment(attachment)
  };
}

async function deleteJournalEntryAttachmentForProfile(profileId, attachmentId) {
  const attachment = await prisma.journalEntryAttachment.findFirst({
    where: {
      id: attachmentId,
      profile_id: profileId
    }
  });

  if (!attachment) {
    throw ApiError.notFound('Journal entry attachment not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  await prisma.journalEntryAttachment.delete({
    where: { id: attachment.id }
  });

  await deleteStorageObject(attachment.storage_path);

  return {
    deleted: true,
    attachment: pickPublicAttachment(attachment)
  };
}

async function listJournalEntriesForProfile(profileId, query = {}) {
  const pagination = parsePaginationQuery(query, {
    defaultLimit: 50,
    maxLimit: 1000
  });
  const where = buildJournalEntryWhere(profileId, query);
  const orderBy = buildJournalEntryOrder(query.orderBy || '-entry_date');

  const [entries, total] = await Promise.all([
    prisma.journalEntry.findMany({
      where,
      include: JOURNAL_INCLUDE,
      orderBy,
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.journalEntry.count({ where })
  ]);

  return {
    journalEntries: entries.map(pickPublicJournalEntry),
    pagination: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total
    })
  };
}

async function listJournalEntryLinesForProfile(profileId, query = {}) {
  const pagination = parsePaginationQuery(query, {
    defaultLimit: 100,
    maxLimit: 1000
  });
  const accountIds = normalizeIdList(query.accountId ?? query.accountIds ?? query.account_id ?? query.account_ids);
  const contactId = normalizeNullableString(query.contactId ?? query.contact_id);
  const where = {
    journal_entry: {
      profile_id: profileId,
      status: 'posted',
      deleted_at: null
    }
  };

  if (accountIds.length > 0) {
    where.account_id = { in: accountIds };
  }

  if (contactId) {
    where.contact_id = contactId;
  }

  const dateFilter = {};
  if (query.startDate ?? query.dateFrom) dateFilter.gte = parseDate(query.startDate ?? query.dateFrom, 'startDate');
  if (query.endDate ?? query.dateTo) dateFilter.lte = parseDate(query.endDate ?? query.dateTo, 'endDate');
  if (Object.keys(dateFilter).length > 0) where.journal_entry.entry_date = dateFilter;

  const [lines, totalCount] = await Promise.all([
    prisma.journalEntryLine.findMany({
      where,
      include: JOURNAL_LINE_INCLUDE,
      orderBy: [
        { journal_entry: { entry_date: 'desc' } },
        { created_at: 'desc' }
      ],
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.journalEntryLine.count({ where })
  ]);

  return {
    lines: lines.map((line) => pickLedgerLine(line, accountIds)),
    totalCount,
    pagination: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total: totalCount
    }),
    hasMore: pagination.skip + lines.length < totalCount
  };
}

async function listJournalEntryAuditHistoryForProfile(profileId, query = {}) {
  const pagination = parsePaginationQuery(query, {
    defaultLimit: 100,
    maxLimit: 1000
  });
  const accountIds = normalizeIdList(query.accountId ?? query.accountIds ?? query.account_id ?? query.account_ids);

  const where = {
    profile_id: profileId,
    entity_type: { in: ['journal_entry', 'transaction'] }
  };

  const entryId = normalizeNullableString(query.entryId ?? query.entry_id);
  if (entryId) {
    where.entity_id = entryId;
  }

  const createdAtFilter = {};
  if (query.startDate ?? query.dateFrom) createdAtFilter.gte = parseDate(query.startDate ?? query.dateFrom, 'startDate');
  if (query.endDate ?? query.dateTo) createdAtFilter.lte = parseDate(query.endDate ?? query.dateTo, 'endDate');
  if (Object.keys(createdAtFilter).length > 0) where.created_at = createdAtFilter;

  const [auditLogs, totalCount] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { created_at: 'desc' },
      skip: pagination.skip,
      take: pagination.take
    }),
    prisma.auditLog.count({ where })
  ]);

  const lines = auditLogs
    .map((log) => pickAuditHistoryLine(log, accountIds))
    .filter(Boolean);

  return {
    lines,
    totalCount,
    pagination: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total: totalCount
    }),
    hasMore: pagination.skip + auditLogs.length < totalCount
  };
}

async function updateJournalEntryWithLinesForProfile(profileId, userId, entryId, input = {}) {
  const existing = await findJournalEntry(profileId, entryId);
  assertJournalEntryEditable(existing);

  const lines = normalizeLines(input.lines);
  assertBalanced(lines);
  const requestedStatus = normalizeJournalStatus(input.status);
  if (requestedStatus && requestedStatus !== existing.status) {
    throw ApiError.badRequest('Journal entry status cannot be changed through edit; use the supported posting or void workflow', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
  const status = existing.status;

  const entry = await prisma.$transaction(async (tx) => {
    await assertLineAccountsBelongToProfile(tx, profileId, lines);
    const oldAccountIds = (existing.lines || []).map((line) => line.account_id);

    await tx.journalEntryLine.deleteMany({
      where: { journal_entry_id: entryId }
    });

    await tx.journalEntry.update({
      where: { id: entryId },
      data: {
        entry_date: existing.entry_date,
        description: normalizeRequiredString(input.description, 'description'),
        memo: normalizeNullableString(input.memo),
        status,
        posted_at: status === 'posted' ? (existing.posted_at || new Date()) : null,
        lines: {
          create: lines.map((line) => ({
            account_id: line.account_id,
            contact_id: line.contact_id,
            description: line.description,
            debit: line.debit,
            credit: line.credit
          }))
        }
      }
    });

    const updated = await tx.journalEntry.findUnique({
      where: { id: entryId },
      include: JOURNAL_INCLUDE
    });

    await refreshBalancesForAccountIds(tx, [...oldAccountIds, ...lines.map((line) => line.account_id)]);

    await createAuditLog(tx, {
      profileId,
      userId,
      entityId: entryId,
      action: 'update_journal_entry',
      beforeData: pickPublicJournalEntry(existing),
      afterData: pickPublicJournalEntry(updated),
      reason: getAuditReason(input, 'Journal entry updated')
    });

    return updated;
  });

  return pickPublicJournalEntry(entry);
}

async function deleteJournalEntryForProfile(profileId, userId, entryId, input = {}) {
  const existing = await findJournalEntry(profileId, entryId);
  assertJournalEntryEditable(existing);

  const entry = await prisma.$transaction(async (tx) => {
    const updated = await tx.journalEntry.update({
      where: { id: entryId },
      data: {
        status: 'voided',
        deleted_at: new Date()
      },
      include: JOURNAL_INCLUDE
    });

    await refreshBalancesForAccountIds(tx, (existing.lines || []).map((line) => line.account_id));

    await createAuditLog(tx, {
      profileId,
      userId,
      entityId: entryId,
      action: 'delete_journal_entry',
      beforeData: pickPublicJournalEntry(existing),
      afterData: pickPublicJournalEntry(updated),
      reason: getAuditReason(input, 'Journal entry voided')
    });

    return updated;
  });

  return {
    deleted: true,
    journalEntry: pickPublicJournalEntry(entry)
  };
}

async function getNextJournalEntryNumberForProfile(profileId) {
  return getNextJournalEntryNumber(profileId, prisma);
}

async function findJournalEntry(profileId, entryId) {
  const entry = await prisma.journalEntry.findFirst({
    where: {
      id: entryId,
      profile_id: profileId,
      deleted_at: null
    },
    include: JOURNAL_INCLUDE
  });

  if (!entry) {
    throw ApiError.notFound('Journal entry not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  return entry;
}

function buildJournalEntryWhere(profileId, query = {}) {
  const where = {
    profile_id: profileId
  };

  if (query.includeDeleted !== 'true') {
    where.deleted_at = null;
  }

  if (query.status) where.status = query.status;
  if (query.source) where.source = query.source;

  const dateFilter = {};
  if (query.dateFrom) dateFilter.gte = parseDate(query.dateFrom, 'dateFrom');
  if (query.dateTo) dateFilter.lte = parseDate(query.dateTo, 'dateTo');
  if (Object.keys(dateFilter).length > 0) where.entry_date = dateFilter;

  if (query.search) {
    const search = String(query.search).trim();
    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { memo: { contains: search, mode: 'insensitive' } },
        { source: { contains: search, mode: 'insensitive' } }
      ];
    }
  }

  return where;
}

function buildJournalEntryOrder(orderBy) {
  const raw = String(orderBy || '-entry_date');
  const descending = raw.startsWith('-');
  const field = descending ? raw.slice(1) : raw;

  if (!JOURNAL_SORT_FIELDS.has(field)) {
    return [{ entry_date: 'desc' }, { created_at: 'desc' }];
  }

  return [{ [field]: descending ? 'desc' : 'asc' }, { created_at: 'desc' }];
}

function pickLedgerLine(line, filterAccountIds = []) {
  const entry = line.journal_entry;
  const sourceTx = entry?.source_transaction;
  const otherLines = (entry?.lines || []).filter((otherLine) => otherLine.id !== line.id);
  const offsettingAccounts = otherLines
    .map((otherLine) => getAccountDisplayName(otherLine.account))
    .filter(Boolean)
    .join(', ');

  // Identify bank account and category account
  let bankAccountId = sourceTx?.bank_account_id || null;
  let bankAccountName = getAccountDisplayName(sourceTx?.bank_account) || null;
  let categoryAccountId = sourceTx?.category_account_id || null;
  let categoryName = getAccountDisplayName(sourceTx?.category_account) || null;

  if (!bankAccountName || !categoryName) {
    const allEntryLines = entry?.lines || [line];
    const assetOrLiabLine = allEntryLines.find((l) => ['asset', 'liability'].includes(l.account?.class));
    const expenseOrIncomeLine = allEntryLines.find((l) => ['expense', 'income'].includes(l.account?.class));

    if (!bankAccountName && assetOrLiabLine) {
      bankAccountId = assetOrLiabLine.account_id;
      bankAccountName = getAccountDisplayName(assetOrLiabLine.account);
    }
    if (!categoryName && expenseOrIncomeLine) {
      categoryAccountId = expenseOrIncomeLine.account_id;
      categoryName = getAccountDisplayName(expenseOrIncomeLine.account);
    }
  }

  const isLineExpenseOrIncome = ['expense', 'income'].includes(line.account?.class);
  if (!categoryName && isLineExpenseOrIncome) {
    categoryAccountId = line.account_id;
    categoryName = getAccountDisplayName(line.account);
  }
  if (!bankAccountName && !isLineExpenseOrIncome) {
    bankAccountId = line.account_id;
    bankAccountName = getAccountDisplayName(line.account);
  }

  return {
    line_id: line.id,
    id: line.id,
    entry_id: line.journal_entry_id,
    journal_entry_id: line.journal_entry_id,
    entry_number: entry?.entry_number ? String(entry.entry_number) : '',
    entry_date: entry?.entry_date,
    transaction_date: entry?.entry_date,
    entry_description: entry?.description,
    line_description: line.description || entry?.description,
    debit_amount: decimalToNumber(line.debit),
    credit_amount: decimalToNumber(line.credit),
    account_id: line.account_id,
    account_name: getAccountDisplayName(line.account),
    account_number: line.account?.account_number,
    account_class: line.account?.class,
    account_type: line.account?.account_type,
    bank_account_id: bankAccountId,
    bank_account_name: bankAccountName || offsettingAccounts || getAccountDisplayName(line.account),
    category_account_id: categoryAccountId,
    category_name: categoryName || (isLineExpenseOrIncome ? getAccountDisplayName(line.account) : offsettingAccounts),
    contact_id: line.contact_id || sourceTx?.contact_id || null,
    contact_name: line.contact?.name || sourceTx?.contact?.name || null,
    transaction_id: entry?.source_transaction_id || null,
    entry_type: sourceTx?.transaction_type || entry?.source || 'manual',
    source: entry?.source,
    status: entry?.status,
    offsetting_accounts: offsettingAccounts,
    running_balance: null,
    created_at: line.created_at
  };
}

function pickAuditHistoryLine(log, accountIds = []) {
  if (log.entity_type === 'transaction') {
    const before = log.before_data || {};
    const after = log.after_data || {};
    const currentData = after.id ? after : before;

    // Check if this transaction touches any of the queried accountIds
    const txAccountIds = [
      before.bank_account_id,
      before.category_account_id,
      ...(before.splits || []).map((s) => s.category_account_id),
      after.bank_account_id,
      after.category_account_id,
      ...(after.splits || []).map((s) => s.category_account_id)
    ].filter(Boolean);

    if (accountIds.length > 0) {
      const matches = accountIds.some((id) => txAccountIds.includes(id));
      if (!matches) return null;
    }

    // Build diff/change description
    let changeSummary = log.reason || '';
    if (log.action === 'update_transaction' && log.before_data && log.after_data) {
      const changes = [];
      if (before.description !== after.description && after.description) {
        changes.push(`Description: "${before.description || ''}" → "${after.description}"`);
      }
      if (before.category_account_id !== after.category_account_id) {
        const oldCat = before.category_account?.display_name || before.category_account?.account_name || 'Uncategorized';
        const newCat = after.category_account?.display_name || after.category_account?.account_name || 'Uncategorized';
        changes.push(`Category: "${oldCat}" → "${newCat}"`);
      }
      if (before.contact_id !== after.contact_id) {
        const oldContact = before.contact?.name || 'None';
        const newContact = after.contact?.name || 'None';
        changes.push(`Contact: "${oldContact}" → "${newContact}"`);
      }
      if (changes.length > 0) {
        changeSummary = changes.join(' | ');
      }
    }

    const amount = Number(currentData.amount || 0);
    const bankAccountName = currentData.bank_account?.display_name || currentData.bank_account?.account_name || 'Bank Account';
    const categoryName = currentData.category_account?.display_name || currentData.category_account?.account_name || 'Uncategorized';

    return {
      line_id: `${log.id}-${currentData.id || 'tx'}`,
      id: `${log.id}-${currentData.id || 'tx'}`,
      audit_log_id: log.id,
      entry_id: currentData.journal_entry_id || log.entity_id,
      journal_entry_id: currentData.journal_entry_id || null,
      transaction_id: log.entity_id,
      entry_number: currentData.journal_entry?.entry_number ? String(currentData.journal_entry.entry_number) : '',
      entry_date: currentData.date || log.created_at,
      transaction_date: currentData.date || log.created_at,
      entry_description: currentData.description || log.action,
      line_description: changeSummary || currentData.description || log.action,
      debit_amount: amount >= 0 ? amount : 0,
      credit_amount: amount < 0 ? Math.abs(amount) : 0,
      account_id: currentData.bank_account_id || null,
      account_name: bankAccountName,
      bank_account_name: bankAccountName,
      category_account_id: currentData.category_account_id || null,
      category_name: categoryName,
      contact_id: currentData.contact_id || null,
      contact_name: currentData.contact?.name || null,
      entry_type: currentData.transaction_type || 'transaction',
      source: currentData.source || 'transaction',
      status: currentData.status,
      offsetting_accounts: changeSummary || categoryName || log.reason || log.action,
      running_balance: null,
      created_at: log.created_at,
      action: log.action,
      reason: changeSummary || log.reason,
      before_data: log.before_data,
      after_data: log.after_data,
      metadata: {
        old_state: log.before_data,
        new_state: log.after_data,
        edit_reason: changeSummary || log.reason
      },
      user_id: log.user_id
    };
  }

  const beforeLines = extractAuditLines(log.before_data, accountIds);
  const afterLines = extractAuditLines(log.after_data, accountIds);
  const line = afterLines[0] || beforeLines[0];
  const entry = log.after_data?.entry || log.before_data?.entry || log.after_data || log.before_data || {};

  if (accountIds.length > 0 && !line) return null;

  return {
    line_id: `${log.id}-${line?.id || 'entry'}`,
    id: `${log.id}-${line?.id || 'entry'}`,
    audit_log_id: log.id,
    entry_id: log.entity_id,
    journal_entry_id: log.entity_id,
    entry_number: entry.entry_number ? String(entry.entry_number) : '',
    entry_date: entry.entry_date || log.created_at,
    transaction_date: entry.entry_date || log.created_at,
    entry_description: entry.description || log.action,
    line_description: line?.description || log.reason || log.action,
    debit_amount: line?.debit_amount ?? line?.debit ?? 0,
    credit_amount: line?.credit_amount ?? line?.credit ?? 0,
    account_id: line?.account_id || null,
    account_name: line?.account?.display_name || line?.account?.account_name || null,
    bank_account_name: line?.account?.display_name || line?.account?.account_name || null,
    contact_id: line?.contact_id || null,
    contact_name: null,
    transaction_id: entry.source_transaction_id || null,
    entry_type: entry.source || log.action,
    source: entry.source || log.action,
    status: entry.status,
    offsetting_accounts: log.reason || log.action,
    running_balance: null,
    created_at: log.created_at,
    action: log.action,
    reason: log.reason,
    before_data: log.before_data,
    after_data: log.after_data,
    metadata: {
      old_state: log.before_data,
      new_state: log.after_data,
      edit_reason: log.reason
    },
    user_id: log.user_id
  };
}

function extractAuditLines(snapshot, accountIds = []) {
  const lines = snapshot?.lines || snapshot?.after_data?.lines || [];
  if (accountIds.length === 0) return lines;
  return lines.filter((line) => accountIds.includes(line.account_id));
}

function getAccountDisplayName(account) {
  if (!account) return null;
  return account.display_name || account.account_name || String(account.account_number || '');
}

async function getNextJournalEntryNumber(profileId, tx) {
  const latest = await tx.journalEntry.findFirst({
    where: { profile_id: profileId },
    orderBy: { entry_number: 'desc' }
  });

  return Number(latest?.entry_number || 0) + 1;
}

async function findOrCreateOpeningBalanceAccount(profileId, tx = null) {
  const db = tx || prisma;
  const existing = await db.userChartOfAccount.findFirst({
    where: {
      profile_id: profileId,
      class: 'equity',
      deleted_at: null,
      OR: [
        { template_account_number: 3000 },
        { account_detail: 'opening_balance_equity' },
        { account_detail: 'Opening Balance' },
        { account_name: 'opening_balance_equity' },
        { account_name: 'Opening Balance' },
        { display_name: 'Opening Balance Equity' },
        { display_name: 'Opening Balance' }
      ]
    }
  });

  if (existing) return existing;

  const template = await db.chartOfAccountsTemplate.findFirst({
    where: { account_number: 3000 }
  }) || await db.chartOfAccountsTemplate.findFirst({
    where: {
      class: 'equity',
      OR: [
        { account_detail: 'Opening Balance' },
        { account_name: 'Opening Balance' }
      ]
    }
  });

  const latest = await db.userChartOfAccount.findFirst({
    where: {
      profile_id: profileId,
      account_number: { gte: 3000, lt: 4000 }
    },
    orderBy: { account_number: 'desc' }
  });

  return db.userChartOfAccount.create({
    data: {
      profile_id: profileId,
      template_account_number: template?.account_number || 3000,
      account_number: template?.account_number || (latest?.account_number ? latest.account_number + 1 : 3000),
      account_name: template?.account_name || 'Opening Balance',
      display_name: template?.display_name || 'Opening Balance Equity',
      class: 'equity',
      account_type: template?.account_type || 'Equity',
      account_detail: template?.account_detail || 'Opening Balance',
      is_active: true,
      is_system: true,
      is_user_created: false,
      icon: template?.icon || 'Landmark',
      color: template?.color || '#64748B'
    }
  });
}

function normalizeLines(lines) {
  if (!Array.isArray(lines) || lines.length < 2) {
    throw ApiError.badRequest('Journal entry must have at least two lines', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  return lines.map((line, index) => {
    const debit = parseMoney(line.debit_amount ?? line.debit ?? 0, `lines.${index}.debit_amount`);
    const credit = parseMoney(line.credit_amount ?? line.credit ?? 0, `lines.${index}.credit_amount`);

    if (debit < 0 || credit < 0) {
      throw ApiError.badRequest('Journal entry line amounts cannot be negative', {
        code: ERROR_CODES.VALIDATION_FAILED
      });
    }

    if (debit > 0 && credit > 0) {
      throw ApiError.badRequest('A journal entry line cannot have both debit and credit amounts', {
        code: ERROR_CODES.VALIDATION_FAILED
      });
    }

    if (debit === 0 && credit === 0) {
      throw ApiError.badRequest('Each journal entry line must have a debit or credit amount', {
        code: ERROR_CODES.VALIDATION_FAILED
      });
    }

    return {
      account_id: normalizeRequiredString(line.account_id ?? line.accountId, `lines.${index}.account_id`),
      contact_id: normalizeNullableString(line.contact_id ?? line.contactId),
      description: normalizeNullableString(line.description),
      debit,
      credit
    };
  });
}

function assertBalanced(lines) {
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);

  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    throw ApiError.badRequest('Journal entry debits must equal credits', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
}

function formatJournalEntryReference(entryNumber) {
  if (entryNumber === null || entryNumber === undefined) return null;
  return `JE-${String(entryNumber).padStart(4, '0')}`;
}

function pickPublicJournalEntry(entry) {
  if (!entry) return null;

  const lines = entry.lines || [];
  const totalDebits = lines.reduce((sum, line) => sum + decimalToNumber(line.debit), 0);
  const totalCredits = lines.reduce((sum, line) => sum + decimalToNumber(line.credit), 0);
  const refNumber = formatJournalEntryReference(entry.entry_number);

  return {
    entry: {
      id: entry.id,
      profile_id: entry.profile_id,
      entry_number: entry.entry_number,
      reference_number: refNumber,
      entry_reference: refNumber,
      entry_date: entry.entry_date,
      description: entry.description,
      memo: entry.memo,
      source: entry.source,
      status: entry.status,
      source_transaction_id: entry.source_transaction_id,
      created_by_user_id: entry.created_by_user_id,
      posted_at: entry.posted_at,
      created_at: entry.created_at,
      updated_at: entry.updated_at,
      deleted_at: entry.deleted_at,
      total_debits: totalDebits,
      total_credits: totalCredits
    },
    id: entry.id,
    profile_id: entry.profile_id,
    entry_number: entry.entry_number,
    reference_number: refNumber,
    entry_reference: refNumber,
    entry_date: entry.entry_date,
    description: entry.description,
    memo: entry.memo,
    source: entry.source,
    status: entry.status,
    source_transaction_id: entry.source_transaction_id,
    created_by_user_id: entry.created_by_user_id,
    posted_at: entry.posted_at,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    deleted_at: entry.deleted_at,
    total_debits: totalDebits,
    total_credits: totalCredits,
    lines: lines.map(pickPublicJournalLine)
  };
}

function pickPublicJournalLine(line) {
  return {
    id: line.id,
    journal_entry_id: line.journal_entry_id,
    account_id: line.account_id,
    contact_id: line.contact_id,
    description: line.description,
    debit_amount: decimalToNumber(line.debit),
    credit_amount: decimalToNumber(line.credit),
    debit: decimalToNumber(line.debit),
    credit: decimalToNumber(line.credit),
    account: line.account ? pickPublicAccount(line.account) : undefined,
    created_at: line.created_at,
    updated_at: line.updated_at
  };
}

function pickPublicAttachment(attachment) {
  return {
    id: attachment.id,
    journal_entry_id: attachment.journal_entry_id,
    profile_id: attachment.profile_id,
    uploaded_by_user_id: attachment.uploaded_by_user_id,
    file_name: attachment.file_name,
    file_size: attachment.file_size,
    file_type: attachment.file_type,
    storage_path: attachment.storage_path,
    created_at: attachment.created_at
  };
}

async function uploadJournalEntryAttachmentFile(file, context) {
  if (!file?.buffer?.length) {
    throw ApiError.badRequest('Attachment file is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'file', message: 'Required field is missing' }]
    });
  }

  const contentType = file.mimetype || file.contentType || 'application/octet-stream';
  const fileName = file.originalname || file.originalName || 'attachment';

  const uploaded = await uploadPublicObject({
    category: 'journal-entry-attachments',
    profileId: context.profileId,
    fileName,
    contentType,
    fileSize: file.size,
    body: file.buffer
  }, {
    userId: context.userId
  });

  return {
    key: uploaded.key,
    fileName,
    fileSize: Number(file.size || file.buffer.length || 0),
    fileType: contentType
  };
}

async function deleteStorageObject(storagePath) {
  if (!storagePath) return;

  try {
    await deleteObject(storagePath);
  } catch (error) {
    console.error('Failed to delete journal entry attachment file:', error);
  }
}

function parseDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw ApiError.badRequest(`${field} must be a valid date`, {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
  return date;
}

async function assertLineAccountsBelongToProfile(tx, profileId, lines) {
  const accountIds = [...new Set(lines.map((line) => line.account_id))];
  const contactIds = [...new Set(lines.map((line) => line.contact_id).filter(Boolean))];
  const accounts = await tx.userChartOfAccount.findMany({
    where: {
      id: { in: accountIds },
      profile_id: profileId,
      deleted_at: null,
      is_active: true
    },
    select: { id: true }
  });

  if (accounts.length !== accountIds.length) {
    throw ApiError.badRequest('All journal entry lines must reference active accounts in this profile', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  if (contactIds.length > 0) {
    const contacts = await tx.contact.findMany({
      where: {
        id: { in: contactIds },
        profile_id: profileId,
        deleted_at: null
      },
      select: { id: true, metadata: true }
    });

    if (contacts.length !== contactIds.length) {
      throw ApiError.badRequest('Journal entry line contacts must belong to this profile', {
        code: ERROR_CODES.VALIDATION_FAILED
      });
    }

    if (contacts.some((contact) => isContactUnavailableOutsideContacts(contact))) {
      throw ApiError.badRequest('Journal entry line contacts must be connected before use', {
        code: ERROR_CODES.VALIDATION_FAILED
      });
    }
  }
}

function isContactUnavailableOutsideContacts(contact) {
  const metadata = contact.metadata && typeof contact.metadata === 'object' && !Array.isArray(contact.metadata)
    ? contact.metadata
    : {};
  return ['pending', 'invited'].includes(metadata.connection_status);
}

function assertJournalEntryEditable(entry) {
  if (entry.status === 'voided' || entry.deleted_at) {
    throw ApiError.badRequest('Voided journal entries cannot be changed', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  if (entry.source_transaction_id || entry.source === 'transaction') {
    throw ApiError.badRequest('Transaction journal entries must be corrected by undoing the source transaction', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  if (String(entry.source || '').toLowerCase() !== 'manual') {
    throw ApiError.badRequest('Only manually created journal entries can be edited or voided', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
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
    const balance = ['asset', 'expense'].includes(account.class)
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
      entity_type: 'journal_entry',
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
    input.deleteReason
  ) || fallback;
}

function normalizeAuditReason(reason, action) {
  return normalizeNullableString(reason) || `Journal entry action: ${action}`;
}

function toAuditJson(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function normalizeJournalStatus(value) {
  if (value === undefined || value === null || value === '') return null;
  const status = String(value).trim().toLowerCase();
  if (!JOURNAL_STATUSES.has(status)) {
    throw ApiError.badRequest('Invalid journal entry status', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
  return status;
}

function normalizeIdList(value) {
  if (value === undefined || value === null || value === '') return [];
  const values = Array.isArray(value) ? value : String(value).split(',');
  return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function parseMoney(value, field) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    throw ApiError.badRequest(`${field} must be a valid amount`, {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
  return number;
}

function normalizeRequiredString(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw ApiError.badRequest(`${field} is required`, {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
  return normalized;
}

function normalizeNullableString(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function decimalToNumber(value) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function roundMoney(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

const JOURNAL_INCLUDE = {
  lines: {
    include: {
      account: true
    },
    orderBy: { created_at: 'asc' }
  }
};

const JOURNAL_LINE_INCLUDE = {
  account: true,
  contact: true,
  journal_entry: {
    include: {
      source_transaction: {
        include: {
          bank_account: true,
          category_account: true,
          contact: true,
          splits: {
            include: {
              category_account: true
            }
          }
        }
      },
      lines: {
        include: {
          account: true,
          contact: true
        },
        orderBy: { created_at: 'asc' }
      }
    }
  }
};

module.exports = {
  listJournalEntriesForProfile,
  listJournalEntryLinesForProfile,
  listJournalEntryAuditHistoryForProfile,
  createJournalEntryForProfile,
  createOpeningBalanceJournalEntryForProfile,
  createOrUpdateOpeningBalanceJournalEntryForProfile,
  voidOpeningBalanceJournalEntryForAccount,
  findOrCreateOpeningBalanceAccount,
  refreshBalancesForAccountIds,
  getJournalEntryForProfile,
  listJournalEntryAttachmentsForProfile,
  createJournalEntryAttachmentForProfile,
  deleteJournalEntryAttachmentForProfile,
  updateJournalEntryWithLinesForProfile,
  deleteJournalEntryForProfile,
  getNextJournalEntryNumberForProfile,
  pickPublicJournalEntry
};
