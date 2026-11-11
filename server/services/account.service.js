const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');
const { parsePaginationQuery, buildPaginationMeta } = require('../utils/pagination');
const { ACCOUNT_TYPE_GROUPS, TEMPLATE_TYPE_CONFIG_MAP } = require('../constants/accountTypes');

const ACCOUNT_CLASSES = new Set(['asset', 'liability', 'equity', 'income', 'expense']);
const ACCOUNT_SORT_FIELDS = new Set([
  'account_number',
  'account_name',
  'display_name',
  'class',
  'account_type',
  'current_balance',
  'created_at',
  'updated_at'
]);

function decimalToNumber(value) {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toNumber === 'function') return value.toNumber();
  const parsed = Number(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function listAccountsForProfile(profileId, query = {}) {
  const pagination = parsePaginationQuery(query, {
    defaultLimit: 100,
    maxLimit: 1000
  });

  const where = buildAccountWhere(profileId, query);
  const orderBy = buildAccountOrder(query.orderBy || 'account_number');

  const [accounts, total] = await Promise.all([
    prisma.userChartOfAccount.findMany({
      where,
      orderBy,
      skip: pagination.skip,
      take: pagination.take,
      include: {
        parent_account: true,
        child_accounts: {
          where: { deleted_at: null },
          orderBy: [{ account_number: 'asc' }, { display_name: 'asc' }]
        },
        plaid_account: {
          include: {
            plaid_item: true
          }
        }
      }
    }),
    prisma.userChartOfAccount.count({ where })
  ]);

  return {
    accounts: accounts.map(pickPublicAccount),
    pagination: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total
    })
  };
}

async function ensureTemplatesSeeded() {
  try {
    const { chartOfAccountsTemplates } = require('../prisma/data/chartOfAccountsTemplates');
    const count = await prisma.chartOfAccountsTemplate.count();
    if (count >= chartOfAccountsTemplates.length) return;

    for (const template of chartOfAccountsTemplates) {
      await prisma.chartOfAccountsTemplate.upsert({
        where: { account_number: template.account_number },
        create: {
          account_number: template.account_number,
          account_name: template.account_name,
          display_name: template.display_name,
          class: template.class,
          account_type: template.account_type,
          account_detail: template.account_detail,
          sort_order: template.sort_order,
          is_system: true,
          is_editable: template.is_editable,
          icon: template.icon,
          color: template.color
        },
        update: {
          account_name: template.account_name,
          display_name: template.display_name,
          class: template.class,
          account_type: template.account_type,
          account_detail: template.account_detail,
          sort_order: template.sort_order,
          is_system: true,
          is_editable: template.is_editable,
          icon: template.icon,
          color: template.color
        }
      });
    }
  } catch (err) {
    console.error('Failed to auto-seed chart of accounts templates:', err);
  }
}

async function listAccountTemplates(query = {}) {
  await ensureTemplatesSeeded();

  const where = {};
  if (query.class) where.class = query.class;
  const accountType = query.account_type || query.accountType;
  if (accountType) {
    where.account_type = accountType;
  }

  const templates = await prisma.chartOfAccountsTemplate.findMany({
    where,
    orderBy: [
      { class: 'asc' },
      { sort_order: 'asc' },
      { account_number: 'asc' }
    ]
  });

  // Deduplicate templates by account_number and normalized class+name
  const seenNumbers = new Set();
  const seenNames = new Set();
  const uniqueTemplates = [];

  for (const t of templates) {
    const nameKey = `${t.class}_${(t.display_name || t.account_name || '').toLowerCase().trim()}`;
    if (seenNumbers.has(t.account_number) || seenNames.has(nameKey)) {
      continue;
    }
    seenNumbers.add(t.account_number);
    seenNames.add(nameKey);
    uniqueTemplates.push(t);
  }

  return {
    templates: uniqueTemplates.map(pickPublicTemplate)
  };
}

async function activateTemplateAccountForProfile(profileId, input = {}, userId = null) {
  await ensureTemplatesSeeded();

  const rawTemplateNumber = input.templateAccountNumber ?? input.template_account_number;
  if (rawTemplateNumber === undefined || rawTemplateNumber === null || rawTemplateNumber === '') {
    throw ApiError.badRequest('template_account_number is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'template_account_number', message: 'Required field is missing' }]
    });
  }

  const templateNumber = Number(rawTemplateNumber);
  if (isNaN(templateNumber)) {
    throw ApiError.badRequest('template_account_number must be a valid number', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'template_account_number', message: 'Must be a number' }]
    });
  }

  // Look up in catalog (which has both root and decimal subcategories e.g. 1850.2)
  const { chartOfAccountsTemplates } = require('../prisma/data/chartOfAccountsTemplates');
  const catalogTpl = chartOfAccountsTemplates.find(t => Number(t.account_number) === templateNumber);

  // For Prisma database template relation (Int column):
  const dbTemplateNumber = Number.isInteger(templateNumber)
    ? templateNumber
    : (catalogTpl?.parent_account_number ? Number(catalogTpl.parent_account_number) : Math.floor(templateNumber));

  let template = await prisma.chartOfAccountsTemplate.findUnique({
    where: { account_number: dbTemplateNumber }
  });

  if (!template) {
    try {
      const seedTpl = chartOfAccountsTemplates.find(t => Number(t.account_number) === dbTemplateNumber);
      if (seedTpl) {
        template = await prisma.chartOfAccountsTemplate.upsert({
          where: { account_number: seedTpl.account_number },
          create: {
            account_number: seedTpl.account_number,
            account_name: seedTpl.account_name,
            display_name: seedTpl.display_name,
            class: seedTpl.class,
            account_type: seedTpl.account_type,
            account_detail: seedTpl.account_detail,
            sort_order: seedTpl.sort_order,
            is_system: true,
            is_editable: seedTpl.is_editable,
            icon: seedTpl.icon,
            color: seedTpl.color
          },
          update: {}
        });
      }
    } catch (err) {
      console.error('Failed on-the-fly template seeding:', err);
    }
  }

  if (!template && !catalogTpl) {
    throw ApiError.notFound('Account template not found', {
      code: ERROR_CODES.ACCOUNT_NOT_FOUND
    });
  }

  const effectiveTpl = catalogTpl || template;
  const accountNumber = await getNextAccountNumber(profileId, dbTemplateNumber);
  const displayName = normalizeNullableString(input.displayName ?? input.display_name ?? input.customDisplayName ?? input.custom_display_name);

  const rawBalance = input.initialBalance !== undefined
    ? input.initialBalance
    : (input.current_balance !== undefined ? input.current_balance : (input.opening_balance !== undefined ? input.opening_balance : 0));
  const initialBalance = parseMoney(rawBalance !== undefined && rawBalance !== null ? rawBalance : 0, 'initialBalance');
  const openingDate = input.openingBalanceDate ?? input.opening_balance_date ?? input.as_of_date ?? input.asOfDate ?? new Date().toISOString().slice(0, 10);

  const account = await prisma.$transaction(async (tx) => {
    const createdAccount = await tx.userChartOfAccount.create({
      data: {
        profile_id: profileId,
        template_account_number: template?.account_number || dbTemplateNumber,
        account_number: accountNumber,
        account_name: effectiveTpl.account_name,
        display_name: displayName || effectiveTpl.display_name || effectiveTpl.account_name,
        class: effectiveTpl.class,
        account_type: effectiveTpl.account_type,
        account_detail: effectiveTpl.account_detail,
        institution_name: normalizeNullableString(input.institutionName ?? input.institution_name),
        account_mask: normalizeNullableString(input.accountMask ?? input.account_mask ?? input.accountNumberLast4 ?? input.account_number_last4),
        current_balance: initialBalance,
        opening_balance: initialBalance !== 0 ? initialBalance : null,
        include_in_cash_balance: Boolean(input.includeInCashBalance ?? input.include_in_cash_balance),
        is_active: true,
        is_system: false,
        is_user_created: false,
        icon: input.icon || effectiveTpl.icon,
        color: input.color || effectiveTpl.color,
        metadata: normalizeMetadata({
          ...(input.metadata || {}),
          original_template_number: templateNumber,
          opening_balance_date: openingDate,
          as_of_date: openingDate
        })
      }
    });

    if (Math.abs(initialBalance) >= 0.01) {
      const { createOrUpdateOpeningBalanceJournalEntryForProfile } = require('./journalEntry.service');
      await createOrUpdateOpeningBalanceJournalEntryForProfile(profileId, userId, {
        accountId: createdAccount.id,
        openingBalance: initialBalance,
        openingDate,
        accountName: createdAccount.display_name || createdAccount.account_name,
        accountClass: createdAccount.class
      }, tx);
    }

    return tx.userChartOfAccount.findUnique({
      where: { id: createdAccount.id },
      include: {
        parent_account: true,
        child_accounts: { where: { deleted_at: null } },
        plaid_account: { include: { plaid_item: true } }
      }
    });
  });

  return pickPublicAccount(account);
}

async function getAccountForProfile(profileId, accountId) {
  const account = await findAccount(profileId, accountId, {
    includeRelations: true
  });

  return pickPublicAccount(account);
}

async function createAccountForProfile(profileId, input = {}, userId = null) {
  const accountName = normalizeNullableString(input.account_name ?? input.name);
  const displayName = normalizeNullableString(input.display_name ?? input.displayName);
  const accountClass = normalizeEnumValue(input.class);

  if (!accountName && !displayName) {
    throw ApiError.badRequest('Account name is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'account_name', message: 'Required field is missing' }]
    });
  }

  if (!ACCOUNT_CLASSES.has(accountClass)) {
    throw ApiError.badRequest('Account class is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'class', message: 'Must be a valid account class' }]
    });
  }

  await assertParentAccount(profileId, input.parent_account_id);

  const rawBalance = input.current_balance !== undefined
    ? input.current_balance
    : (input.initialBalance !== undefined ? input.initialBalance : (input.opening_balance !== undefined ? input.opening_balance : 0));
  const initialBalance = parseMoney(rawBalance !== undefined && rawBalance !== null ? rawBalance : 0, 'initialBalance');
  const openingDate = input.openingBalanceDate ?? input.opening_balance_date ?? input.as_of_date ?? input.asOfDate ?? new Date().toISOString().slice(0, 10);

  const rawTemplateNumber = input.template_account_number ?? input.templateAccountNumber;
  let templateAccountNumber = null;
  if (rawTemplateNumber !== undefined && rawTemplateNumber !== null && rawTemplateNumber !== '') {
    const num = Number(rawTemplateNumber);
    if (!isNaN(num)) {
      const intNum = Number.isInteger(num) ? num : Math.floor(num);
      let tplExists = await prisma.chartOfAccountsTemplate.findUnique({
        where: { account_number: intNum }
      });
      if (!tplExists) {
        try {
          const { chartOfAccountsTemplates } = require('../prisma/data/chartOfAccountsTemplates');
          const seedTpl = chartOfAccountsTemplates.find(t => Number(t.account_number) === intNum);
          if (seedTpl) {
            tplExists = await prisma.chartOfAccountsTemplate.upsert({
              where: { account_number: seedTpl.account_number },
              create: {
                account_number: seedTpl.account_number,
                account_name: seedTpl.account_name,
                display_name: seedTpl.display_name,
                class: seedTpl.class,
                account_type: seedTpl.account_type,
                account_detail: seedTpl.account_detail,
                sort_order: seedTpl.sort_order,
                is_system: true,
                is_editable: seedTpl.is_editable,
                icon: seedTpl.icon,
                color: seedTpl.color
              },
              update: {}
            });
          }
        } catch (err) {
          console.warn('Could not auto-seed template in createAccount:', err);
        }
      }
      if (tplExists) {
        templateAccountNumber = intNum;
      }
    }
  }

  const account = await prisma.$transaction(async (tx) => {
    const createdAccount = await tx.userChartOfAccount.create({
      data: {
        profile_id: profileId,
        ...buildAccountData({
          ...input,
          template_account_number: templateAccountNumber
        }),
        account_name: accountName || slugifyDisplayName(displayName),
        display_name: displayName || accountName,
        class: accountClass,
        current_balance: initialBalance,
        opening_balance: initialBalance !== 0 ? initialBalance : null,
        is_active: input.is_active !== false,
        is_system: false,
        is_user_created: true,
        metadata: normalizeMetadata({
          ...(input.metadata || {}),
          opening_balance_date: openingDate,
          as_of_date: openingDate
        })
      }
    });

    if (Math.abs(initialBalance) >= 0.01) {
      const { createOrUpdateOpeningBalanceJournalEntryForProfile } = require('./journalEntry.service');
      await createOrUpdateOpeningBalanceJournalEntryForProfile(profileId, userId, {
        accountId: createdAccount.id,
        openingBalance: initialBalance,
        openingDate,
        accountName: createdAccount.display_name || createdAccount.account_name,
        accountClass: createdAccount.class
      }, tx);
    }

    return tx.userChartOfAccount.findUnique({
      where: { id: createdAccount.id },
      include: {
        parent_account: true,
        child_accounts: { where: { deleted_at: null } },
        plaid_account: { include: { plaid_item: true } }
      }
    });
  });

  return pickPublicAccount(account);
}

async function updateAccountForProfile(profileId, accountId, input = {}, userId = null) {
  const existingAccount = await findAccount(profileId, accountId);

  await assertParentAccount(profileId, input.parent_account_id, accountId);

  const data = buildAccountData(input, { partial: true });

  if (input.class !== undefined) {
    const accountClass = normalizeEnumValue(input.class);
    if (!ACCOUNT_CLASSES.has(accountClass)) {
      throw ApiError.badRequest('Invalid account class', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'body', field: 'class', message: 'Must be a valid account class' }]
      });
    }
    data.class = accountClass;
  }

  const rawOpeningBalance = input.opening_balance !== undefined
    ? input.opening_balance
    : (input.openingBalance !== undefined ? input.openingBalance : (input.initialBalance !== undefined ? input.initialBalance : undefined));
  const openingDateInput = input.openingBalanceDate ?? input.opening_balance_date ?? input.as_of_date ?? input.asOfDate;

  if (input.metadata !== undefined || openingDateInput !== undefined) {
    data.metadata = {
      ...normalizeMetadata(existingAccount.metadata),
      ...normalizeMetadata(input.metadata),
      ...(openingDateInput ? { opening_balance_date: openingDateInput, as_of_date: openingDateInput } : {})
    };
  }

  if (rawOpeningBalance !== undefined) {
    const parsedOpeningBalance = parseMoney(rawOpeningBalance !== null ? rawOpeningBalance : 0, 'opening_balance');
    data.opening_balance = parsedOpeningBalance !== 0 ? parsedOpeningBalance : null;
  }

  if (Object.keys(data).length === 0) {
    throw ApiError.badRequest('No account updates were provided', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  const account = await prisma.$transaction(async (tx) => {
    // If opening balance or opening date was explicitly updated, sync the opening balance journal entry
    if (rawOpeningBalance !== undefined || openingDateInput !== undefined) {
      const targetBalance = rawOpeningBalance !== undefined
        ? parseMoney(rawOpeningBalance !== null ? rawOpeningBalance : 0, 'opening_balance')
        : Number(existingAccount.opening_balance ?? existingAccount.current_balance ?? 0);
      const targetDate = openingDateInput || existingAccount.metadata?.opening_balance_date || existingAccount.metadata?.as_of_date || new Date().toISOString().slice(0, 10);
      const targetClass = data.class || existingAccount.class;
      const targetName = data.display_name || existingAccount.display_name || existingAccount.account_name;

      const { createOrUpdateOpeningBalanceJournalEntryForProfile } = require('./journalEntry.service');
      await createOrUpdateOpeningBalanceJournalEntryForProfile(profileId, userId, {
        accountId,
        openingBalance: targetBalance,
        openingDate: targetDate,
        accountName: targetName,
        accountClass: targetClass
      }, tx);
    }

    await tx.userChartOfAccount.update({
      where: { id: accountId },
      data
    });

    return tx.userChartOfAccount.findUnique({
      where: { id: accountId },
      include: {
        parent_account: true,
        child_accounts: { where: { deleted_at: null } },
        plaid_account: { include: { plaid_item: true } }
      }
    });
  });

  return pickPublicAccount(account);
}

async function getAccountDeletionSummaryForProfile(profileId, accountId) {
  const account = await findAccount(profileId, accountId);

  const [transactionCount, journalLineCount] = await Promise.all([
    prisma.transaction.count({
      where: {
        profile_id: profileId,
        deleted_at: null,
        OR: [
          { bank_account_id: accountId },
          { category_account_id: accountId }
        ]
      }
    }),
    prisma.journalEntryLine.count({
      where: {
        account_id: accountId,
        journal_entry: {
          profile_id: profileId,
          deleted_at: null,
          status: { not: 'voided' }
        }
      }
    })
  ]);

  const currentBalance = decimalToNumber(account.current_balance);
  const hasHistory = transactionCount > 0 || journalLineCount > 0 || Math.abs(currentBalance) >= 0.01;

  return {
    account: pickPublicAccount(account),
    transactionCount,
    journalLineCount,
    currentBalance,
    hasHistory,
    requiresReassignment: hasHistory
  };
}

async function deleteAccountForProfile(profileId, accountId, options = {}, userId = null) {
  const account = await findAccount(profileId, accountId, { includeRelations: true });
  const profile = await prisma.profile.findUnique({
    where: { id: profileId }
  });

  const isPrimaryProfile = profile ? Boolean(profile.is_default) : false;
  const summary = await getAccountDeletionSummaryForProfile(profileId, accountId);

  const reassignToAccountId = options.reassignToAccountId || options.destinationAccountId || null;

  if (summary.hasHistory && !reassignToAccountId && !options.force) {
    throw ApiError.badRequest(
      'This account contains transaction history or ledger entries. Please select a destination account to reassign the ledger history before deleting.',
      {
        code: 'REASSIGNMENT_REQUIRED',
        requiresReassignment: true,
        summary
      }
    );
  }

  let targetAccount = null;
  if (reassignToAccountId) {
    if (reassignToAccountId === accountId) {
      throw ApiError.badRequest('Destination account cannot be the same as the account being deleted.');
    }
    targetAccount = await findAccount(profileId, reassignToAccountId);
  }

  await prisma.$transaction(async (tx) => {
    const { voidOpeningBalanceJournalEntryForAccount, refreshBalancesForAccountIds } = require('./journalEntry.service');
    const { recalculateSavvyBalanceForAccounts } = require('./plaid.service');

    if (reassignToAccountId) {
      // 1. Reassign all Transactions where bank_account_id == accountId
      await tx.transaction.updateMany({
        where: {
          profile_id: profileId,
          bank_account_id: accountId,
          deleted_at: null
        },
        data: {
          bank_account_id: reassignToAccountId
        }
      });

      // 2. Reassign all Transactions where category_account_id == accountId
      await tx.transaction.updateMany({
        where: {
          profile_id: profileId,
          category_account_id: accountId,
          deleted_at: null
        },
        data: {
          category_account_id: reassignToAccountId
        }
      });

      // 3. Reassign all TransactionSplits where category_account_id == accountId
      await tx.transactionSplit.updateMany({
        where: {
          profile_id: profileId,
          category_account_id: accountId
        },
        data: {
          category_account_id: reassignToAccountId
        }
      });

      // 4. Reassign all TransactionRules where category_account_id == accountId
      await tx.transactionRule.updateMany({
        where: {
          profile_id: profileId,
          category_account_id: accountId
        },
        data: {
          category_account_id: reassignToAccountId
        }
      });

      // 5. Reassign all JournalEntryLines where account_id == accountId
      await tx.journalEntryLine.updateMany({
        where: {
          account_id: accountId
        },
        data: {
          account_id: reassignToAccountId
        }
      });

      // 6. Reassign Budgets
      await tx.budget.updateMany({
        where: {
          profile_id: profileId,
          chart_account_id: accountId
        },
        data: {
          chart_account_id: reassignToAccountId
        }
      });

      // 7. Reassign FinancialGoals
      await tx.financialGoal.updateMany({
        where: {
          profile_id: profileId,
          linked_account_id: accountId
        },
        data: {
          linked_account_id: reassignToAccountId
        }
      });

      // 8. Reassign Child Accounts if account was parent
      await tx.userChartOfAccount.updateMany({
        where: {
          profile_id: profileId,
          parent_account_id: accountId,
          deleted_at: null
        },
        data: {
          parent_account_id: reassignToAccountId
        }
      });

      // 9. Recalculate balances
      await refreshBalancesForAccountIds(tx, [reassignToAccountId]);
      try {
        await recalculateSavvyBalanceForAccounts(tx, profileId, [reassignToAccountId]);
      } catch (calcErr) {
        console.warn('Balance recalculation warning after account delete/merge:', calcErr?.message);
      }
    } else {
      // If no reassignment (0 history), void opening balance if any
      try {
        await voidOpeningBalanceJournalEntryForAccount(profileId, accountId, tx);
      } catch (e) {
        console.warn('Could not void opening balance for account:', accountId, e?.message);
      }
    }

    // Helper to delete a single account
    const deleteSingleAccount = async (targetProfileId, targetAccountId) => {
      await tx.userChartOfAccount.update({
        where: { id: targetAccountId },
        data: {
          is_active: false,
          deleted_at: new Date()
        }
      });

      await tx.plaidAccount.updateMany({
        where: { user_chart_account_id: targetAccountId },
        data: { user_chart_account_id: null }
      });
    };

    await deleteSingleAccount(profileId, accountId);

    // If deleting from PRIMARY profile, cascade deletion to linked plaid accounts in SECONDARY profiles
    if (isPrimaryProfile && profile?.owner_user_id) {
      try {
        const secondaryProfiles = await tx.profile.findMany({
          where: {
            owner_user_id: profile.owner_user_id,
            id: { not: profileId },
            deleted_at: null
          },
          select: { id: true }
        });

        const secondaryProfileIds = secondaryProfiles.map((p) => p.id);

        if (secondaryProfileIds.length > 0) {
          const accountMask = account.account_mask || null;
          const institutionName = account.institution_name || null;
          const templateNum = account.template_account_number || null;
          const accountClass = account.class || null;

          const secondaryWhereConditions = [];

          if (accountMask && institutionName && accountClass) {
            secondaryWhereConditions.push({
              account_mask: accountMask,
              institution_name: institutionName,
              class: accountClass
            });
          }
          if (templateNum && accountClass && account.is_system) {
            secondaryWhereConditions.push({
              template_account_number: templateNum,
              class: accountClass,
              is_system: true
            });
          }

          if (secondaryWhereConditions.length > 0) {
            const matchingSecondaryAccounts = await tx.userChartOfAccount.findMany({
              where: {
                profile_id: { in: secondaryProfileIds },
                deleted_at: null,
                OR: secondaryWhereConditions
              },
              select: { id: true, profile_id: true }
            });

            for (const secAcc of matchingSecondaryAccounts) {
              await deleteSingleAccount(secAcc.profile_id, secAcc.id);
            }
          }
        }
      } catch (cascadeErr) {
        console.warn('Secondary profile cascade deletion warning:', cascadeErr?.message);
      }
    }
  });

  const freshTargetAccount = reassignToAccountId
    ? await prisma.userChartOfAccount.findUnique({ where: { id: reassignToAccountId } })
    : null;

  return {
    deleted: true,
    deactivated: true,
    reassignedTo: freshTargetAccount ? pickPublicAccount(freshTargetAccount) : null,
    historyTransferred: Boolean(reassignToAccountId && summary.hasHistory)
  };
}

async function findAccount(profileId, accountId, options = {}) {
  const account = await prisma.userChartOfAccount.findFirst({
    where: {
      id: accountId,
      profile_id: profileId,
      deleted_at: null
    },
    include: options.includeRelations ? {
      parent_account: true,
      child_accounts: {
        where: { deleted_at: null },
        orderBy: [{ account_number: 'asc' }, { display_name: 'asc' }]
      },
      plaid_account: {
        include: {
          plaid_item: true
        }
      }
    } : undefined
  });

  if (!account) {
    throw ApiError.notFound('Account not found', {
      code: ERROR_CODES.ACCOUNT_NOT_FOUND
    });
  }

  return account;
}

async function assertParentAccount(profileId, parentAccountId, accountId = null) {
  if (parentAccountId === undefined || parentAccountId === null || parentAccountId === '') {
    return;
  }

  if (parentAccountId === accountId) {
    throw ApiError.badRequest('Account cannot be its own parent', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }

  await findAccount(profileId, parentAccountId);
}

function buildAccountWhere(profileId, query = {}) {
  const where = {
    profile_id: profileId,
    deleted_at: null
  };

  if (query.includeInactive !== 'true') {
    where.is_active = query.isActive === undefined ? true : query.isActive === 'true';
  } else if (query.isActive !== undefined) {
    where.is_active = query.isActive === 'true';
  }

  if (query.class) where.class = query.class;
  if (query.accountType) where.account_type = query.accountType;
  if (query.accountDetail) where.account_detail = query.accountDetail;
  if (query.includeInCashBalance !== undefined) {
    where.include_in_cash_balance = query.includeInCashBalance === 'true';
  }

  if (query.search) {
    const search = String(query.search).trim();
    if (search) {
      where.OR = [
        { account_name: { contains: search, mode: 'insensitive' } },
        { display_name: { contains: search, mode: 'insensitive' } },
        { institution_name: { contains: search, mode: 'insensitive' } },
        { account_detail: { contains: search, mode: 'insensitive' } }
      ];
    }
  }

  return where;
}

function buildAccountOrder(orderBy) {
  const raw = String(orderBy || 'account_number');
  const descending = raw.startsWith('-');
  const field = descending ? raw.slice(1) : raw;

  if (!ACCOUNT_SORT_FIELDS.has(field)) {
    return [{ account_number: 'asc' }, { display_name: 'asc' }];
  }

  return [{ [field]: descending ? 'desc' : 'asc' }, { display_name: 'asc' }];
}

function buildAccountData(input = {}, options = {}) {
  const data = {};

  const stringFields = [
    'account_name',
    'display_name',
    'account_type',
    'account_detail',
    'parent_account_id',
    'institution_name',
    'account_mask',
    'icon',
    'color'
  ];

  stringFields.forEach((field) => {
    if (input[field] !== undefined) {
      data[field] = normalizeNullableString(input[field]);
    }
  });

  if (input.name !== undefined && input.account_name === undefined) {
    data.account_name = normalizeNullableString(input.name);
  }

  if (input.displayName !== undefined && input.display_name === undefined) {
    data.display_name = normalizeNullableString(input.displayName);
  }

  if (options.partial && data.account_name !== undefined && !data.account_name) {
    throw ApiError.badRequest('Account name cannot be blank', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'account_name', message: 'Must not be blank' }]
    });
  }

  if (input.account_number !== undefined) data.account_number = parseOptionalInteger(input.account_number, 'account_number');
  if (input.template_account_number !== undefined) {
    if (input.template_account_number === null || input.template_account_number === '') {
      data.template_account_number = null;
    } else {
      const num = Number(input.template_account_number);
      data.template_account_number = !isNaN(num) ? (Number.isInteger(num) ? num : Math.floor(num)) : null;
    }
  }
  if (input.current_balance !== undefined) data.current_balance = parseMoney(input.current_balance, 'current_balance');
  if (input.available_balance !== undefined) data.available_balance = parseNullableMoney(input.available_balance, 'available_balance');
  if (input.opening_balance !== undefined) data.opening_balance = parseNullableMoney(input.opening_balance, 'opening_balance');
  if (input.include_in_cash_balance !== undefined) data.include_in_cash_balance = Boolean(input.include_in_cash_balance);
  if (input.is_active !== undefined) data.is_active = Boolean(input.is_active);

  return data;
}

function pickPublicAccount(account) {
  if (!account) return null;

  return {
    id: account.id,
    profile_id: account.profile_id,
    template_account_number: account.template_account_number,
    account_number: account.account_number,
    account_name: account.account_name,
    display_name: account.display_name,
    class: account.class,
    account_type: account.account_type,
    account_detail: account.account_detail,
    parent_account_id: account.parent_account_id,
    institution_name: account.institution_name,
    account_mask: account.account_mask,
    current_balance: decimalToNumber(account.current_balance),
    available_balance: decimalToNumber(account.available_balance),
    opening_balance: decimalToNumber(account.opening_balance),
    opening_balance_locked: Boolean(account.opening_balance_locked),
    bank_current_balance: decimalToNumber(account.bank_current_balance),
    bank_available_balance: decimalToNumber(account.bank_available_balance),
    bank_balance_synced_at: account.bank_balance_synced_at,
    plaid_import_start_date: account.plaid_import_start_date,
    is_plaid_linked: Boolean(account.plaid_account && !account.plaid_account.deleted_at),
    plaid_account_id: account.plaid_account?.plaid_account_id || account.plaid_account?.id || null,
    plaid_item_id: account.plaid_account?.plaid_item_id || account.plaid_account?.plaid_item?.id || null,
    plaid_account: account.plaid_account ? {
      id: account.plaid_account.id,
      plaid_item_id: account.plaid_account.plaid_item_id,
      plaid_account_id: account.plaid_account.plaid_account_id,
      name: account.plaid_account.name,
      mask: account.plaid_account.mask,
      item_id: account.plaid_account.plaid_item_id
    } : null,
    plaid_item_status: account.plaid_account?.plaid_item?.status || null,
    plaid_status: account.plaid_account?.plaid_item?.status || 'active',
    requires_reauth: ['login_required', 'requires_reauth', 'error'].includes(account.plaid_account?.plaid_item?.status) || Boolean(account.plaid_account?.plaid_item?.error),
    difference: account.bank_current_balance !== null && account.bank_current_balance !== undefined
      ? Number((decimalToNumber(account.bank_current_balance) - decimalToNumber(account.current_balance)).toFixed(2))
      : 0,
    is_reconciled: account.bank_current_balance !== null && account.bank_current_balance !== undefined
      ? Math.abs(decimalToNumber(account.bank_current_balance) - decimalToNumber(account.current_balance)) < 0.01
      : true,
    include_in_cash_balance: account.include_in_cash_balance,
    is_active: account.is_active,
    is_system: account.is_system,
    is_user_created: account.is_user_created,
    icon: account.icon,
    color: account.color,
    metadata: normalizeMetadata(account.metadata),
    parent_account: account.parent_account ? pickPublicAccount(account.parent_account) : undefined,
    child_accounts: account.child_accounts ? account.child_accounts.map(pickPublicAccount) : undefined,
    created_at: account.created_at,
    updated_at: account.updated_at
  };
}

async function listAccountTypes() {
  return {
    groups: ACCOUNT_TYPE_GROUPS
  };
}

function pickPublicTemplate(template) {
  const typeConfig = TEMPLATE_TYPE_CONFIG_MAP[template.account_number] || {
    accountType: template.class === 'asset' ? 'bank_account' : (template.class === 'liability' ? 'credit_card' : (template.class === 'income' ? 'personal_income' : 'expense')),
    detailType: template.account_detail || 'general'
  };

  return {
    id: template.id,
    account_number: template.account_number,
    account_name: template.account_name,
    display_name: template.display_name,
    class: template.class,
    account_type: template.account_type,
    account_detail: template.account_detail,
    parent_number: template.parent_number,
    sort_order: template.sort_order,
    is_system: template.is_system,
    is_editable: template.is_editable,
    icon: template.icon,
    color: template.color,
    type_config: typeConfig,
    created_at: template.created_at
  };
}

async function getNextAccountNumber(profileId, templateAccountNumber) {
  const latest = await prisma.userChartOfAccount.findFirst({
    where: {
      profile_id: profileId,
      template_account_number: templateAccountNumber
    },
    orderBy: { account_number: 'desc' }
  });

  return latest?.account_number ? latest.account_number + 1 : templateAccountNumber;
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

function normalizeMetadata(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseOptionalInteger(value, field) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (isNaN(number)) {
    throw ApiError.badRequest(`${field} must be a number`, {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field, message: 'Must be a number' }]
    });
  }
  return Number.isInteger(number) ? number : Math.floor(number);
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

function parseNullableMoney(value, field) {
  if (value === null || value === '') return null;
  return parseMoney(value, field);
}

function decimalToNumber(value) {
  if (value === null || value === undefined) return null;
  return Number(value);
}

function slugifyDisplayName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'account';
}

async function autoFixAccountVariance(profileId, accountId) {
  const account = await prisma.userChartOfAccount.findFirst({
    where: { id: accountId, profile_id: profileId, deleted_at: null }
  });
  if (!account) {
    throw ApiError.notFound('Account not found', { code: ERROR_CODES.NOT_FOUND });
  }

  const bankBalance = Number(account.bank_current_balance ?? 0);
  const savvyBalance = Number(account.current_balance ?? 0);
  const difference = Number((bankBalance - savvyBalance).toFixed(2));

  if (Math.abs(difference) < 0.01) {
    return {
      success: true,
      message: 'Account is already balanced with the bank.',
      is_reconciled: true,
      account: pickPublicAccount(account)
    };
  }

  const now = new Date();
  let updatedAccount = null;

  await prisma.$transaction(async (tx) => {
    // 1. Find or create offset account (Opening Balance Equity)
    let offsetAccount = await tx.userChartOfAccount.findFirst({
      where: {
        profile_id: profileId,
        class: 'equity',
        deleted_at: null,
        OR: [
          { account_detail: 'opening_balance_equity' },
          { account_name: 'opening_balance_equity' },
          { display_name: 'Opening Balance Equity' }
        ]
      }
    });

    if (!offsetAccount) {
      const latest = await tx.userChartOfAccount.findFirst({
        where: {
          profile_id: profileId,
          account_number: { gte: 3000, lt: 4000 }
        },
        orderBy: { account_number: 'desc' }
      });

      offsetAccount = await tx.userChartOfAccount.create({
        data: {
          profile_id: profileId,
          account_number: latest?.account_number ? latest.account_number + 1 : 3000,
          account_name: 'opening_balance_equity',
          display_name: 'Opening Balance Equity',
          class: 'equity',
          account_type: 'equity',
          account_detail: 'opening_balance_equity',
          is_active: true,
          is_system: false,
          is_user_created: true,
          icon: 'Scale',
          color: '#64748b'
        }
      });
    }

    // 2. Determine debit and credit based on account class and difference
    const absDiff = Math.abs(difference);
    const isAssetOrExpense = ['asset', 'expense'].includes(account.class);
    let debitAccountId, creditAccountId;

    if (isAssetOrExpense) {
      if (difference > 0) {
        debitAccountId = account.id;
        creditAccountId = offsetAccount.id;
      } else {
        debitAccountId = offsetAccount.id;
        creditAccountId = account.id;
      }
    } else {
      if (difference > 0) {
        debitAccountId = offsetAccount.id;
        creditAccountId = account.id;
      } else {
        debitAccountId = account.id;
        creditAccountId = offsetAccount.id;
      }
    }

    // 3. Get next journal entry number
    const latestEntry = await tx.journalEntry.findFirst({
      where: { profile_id: profileId },
      orderBy: { entry_number: 'desc' }
    });
    const entryNumber = Number(latestEntry?.entry_number || 0) + 1;

    // 4. Create balanced Journal Entry with lines
    const journalEntry = await tx.journalEntry.create({
      data: {
        profile_id: profileId,
        entry_number: entryNumber,
        entry_date: now,
        description: 'Balance adjustment to match bank',
        source: 'reconciliation_adjustment',
        status: 'posted',
        posted_at: now,
        lines: {
          create: [
            {
              account_id: debitAccountId,
              description: debitAccountId === account.id ? 'Balance adjustment to match bank' : 'Reconciliation adjustment offset',
              debit: absDiff,
              credit: 0
            },
            {
              account_id: creditAccountId,
              description: creditAccountId === account.id ? 'Balance adjustment to match bank' : 'Reconciliation adjustment offset',
              debit: 0,
              credit: absDiff
            }
          ]
        }
      }
    });

    // 5. Create safe, additive alignment transaction linked to journal entry
    const txn = await tx.transaction.create({
      data: {
        profile_id: profileId,
        bank_account_id: accountId,
        date: now,
        posted_date: now,
        description: 'Balance adjustment to match bank',
        amount: difference,
        transaction_type: difference >= 0 ? 'income' : 'expense',
        status: 'posted',
        source: 'reconciliation_adjustment',
        journal_entry_id: journalEntry.id,
        metadata: {
          auto_adjustment: true,
          previous_savvy_balance: savvyBalance,
          bank_balance: bankBalance,
          adjustment_amount: difference,
          adjusted_at: now.toISOString(),
          current_journal_entry_id: journalEntry.id
        }
      }
    });

    // 6. Update journal entry source_transaction_id
    await tx.journalEntry.update({
      where: { id: journalEntry.id },
      data: { source_transaction_id: txn.id }
    });

    // 7. Align current_balance to bank_current_balance
    updatedAccount = await tx.userChartOfAccount.update({
      where: { id: accountId },
      data: {
        current_balance: bankBalance,
        reconciliation_variance: 0,
        last_reconciled_at: now
      },
      include: {
        parent_account: true,
        child_accounts: {
          where: { deleted_at: null }
        },
        plaid_account: {
          include: { plaid_item: true }
        }
      }
    });
  });

  return {
    success: true,
    message: 'Account balance successfully aligned with your bank.',
    difference: 0,
    is_reconciled: true,
    account: pickPublicAccount(updatedAccount)
  };
}

module.exports = {
  listAccountsForProfile,
  listAccountTemplates,
  listAccountTypes,
  activateTemplateAccountForProfile,
  getAccountForProfile,
  getAccountDeletionSummaryForProfile,
  createAccountForProfile,
  updateAccountForProfile,
  deleteAccountForProfile,
  findAccount,
  pickPublicAccount,
  getNextAccountNumber,
  autoFixAccountVariance
};
