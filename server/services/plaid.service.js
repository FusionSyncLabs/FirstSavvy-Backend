const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const { prisma } = require('../config/database');
const { env } = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { pickPublicAccount, getNextAccountNumber } = require('./account.service');

let plaidClient = null;

function getPlaidClient() {
  assertPlaidConfigured();

  if (!plaidClient) {
    const plaidEnvironment = PlaidEnvironments[env.plaidEnv];
    if (!plaidEnvironment) {
      throw ApiError.badRequest('Invalid Plaid environment', {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: 'env', field: 'PLAID_ENV', message: 'Use sandbox, development, or production' }]
      });
    }

    const configuration = new Configuration({
      basePath: plaidEnvironment,
      baseOptions: {
        headers: {
          'PLAID-CLIENT-ID': env.plaidClientId,
          'PLAID-SECRET': env.plaidSecret
        }
      }
    });

    plaidClient = new PlaidApi(configuration);
  }

  return plaidClient;
}

async function getPlaidStatusForProfile(profileId) {
  const items = await prisma.plaidItem.findMany({
    where: {
      profile_id: profileId,
      deleted_at: null
    },
    include: {
      accounts: {
        where: { deleted_at: null, is_active: true },
        include: { user_chart_account: true },
        orderBy: [{ name: 'asc' }]
      }
    },
    orderBy: [{ created_at: 'desc' }]
  });

  // Deduplicate items by institution: keep only the newest item per institution
  const seenInstitutions = new Set();
  const uniqueItems = [];

  for (const item of items) {
    const instKey = (item.institution_id || item.institution_name || item.id).toLowerCase().trim();
    if (seenInstitutions.has(instKey)) {
      // Auto-clean older duplicate item in DB
      prisma.plaidItem.update({
        where: { id: item.id },
        data: { status: 'disconnected', deleted_at: new Date() }
      }).catch(() => {});
      prisma.plaidAccount.updateMany({
        where: { plaid_item_id: item.id, deleted_at: null },
        data: { is_active: false, deleted_at: new Date() }
      }).catch(() => {});
      continue;
    }
    seenInstitutions.add(instKey);

    // Deduplicate accounts inside this item by account mask or name
    const seenAccountKeys = new Set();
    const uniqueAccounts = [];
    for (const acct of (item.accounts || [])) {
      const acctKey = (acct.mask || acct.name || acct.id).toLowerCase().trim();
      if (!seenAccountKeys.has(acctKey)) {
        seenAccountKeys.add(acctKey);
        uniqueAccounts.push(acct);
      }
    }
    uniqueItems.push({ ...item, accounts: uniqueAccounts });
  }

  return {
    configured: isPlaidConfigured(),
    environment: env.plaidEnv,
    products: parseCsv(env.plaidProducts),
    countryCodes: parseCsv(env.plaidCountryCodes),
    items: uniqueItems.map(pickPublicPlaidItem)
  };
}

async function createLinkTokenForProfile(profileId, userId) {
  const client = getPlaidClient();
  try {
    const rawProducts = parseCsv(env.plaidProducts);
    // Ensure only read-only budgeting products are requested, never money-movement products (auth, transfer)
    const allowedProducts = ['transactions', 'investments', 'liabilities', 'assets'];
    const safeProducts = rawProducts.filter(p => allowedProducts.includes(String(p).toLowerCase()));
    const finalProducts = safeProducts.length > 0 ? safeProducts : ['transactions'];

    const response = await client.linkTokenCreate({
      user: {
        client_user_id: userId || profileId
      },
      client_name: 'FirstSavvy',
      products: finalProducts,
      country_codes: parseCsv(env.plaidCountryCodes),
      language: 'en',
      redirect_uri: env.plaidRedirectUri || undefined
    });

    return {
      linkToken: response.data.link_token,
      link_token: response.data.link_token,
      expiration: response.data.expiration
    };
  } catch (error) {
    throw new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Failed to create Plaid link token', {
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      details: [{ ...error.response?.data }]
    });
  }
}

async function createUpdateLinkTokenForProfile(profileId, userId, itemId) {
  const item = await prisma.plaidItem.findFirst({
    where: { id: itemId, profile_id: profileId, deleted_at: null }
  });

  if (!item) {
    throw ApiError.notFound('Plaid item not found', { code: ERROR_CODES.NOT_FOUND });
  }

  const client = getPlaidClient();
  try {
    const response = await client.linkTokenCreate({
      user: { client_user_id: userId || profileId },
      client_name: 'FirstSavvy',
      access_token: item.access_token,
      country_codes: parseCsv(env.plaidCountryCodes),
      language: 'en',
      redirect_uri: env.plaidRedirectUri || undefined
    });

    return {
      linkToken: response.data.link_token,
      link_token: response.data.link_token,
      expiration: response.data.expiration
    };
  } catch (error) {
    throw new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Failed to create Plaid update link token', {
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      details: [{ ...error.response?.data }]
    });
  }
}

async function disconnectPlaidItemForProfile(profileId, itemId) {
  const item = await prisma.plaidItem.findFirst({
    where: { id: itemId, profile_id: profileId, deleted_at: null }
  });

  if (!item) {
    throw ApiError.notFound('Plaid item not found', { code: ERROR_CODES.NOT_FOUND });
  }

  try {
    const client = getPlaidClient();
    await client.itemRemove({ access_token: item.access_token });
  } catch (_) {
    // Best-effort revoke
  }

  const now = new Date();

  await prisma.plaidAccount.updateMany({
    where: { plaid_item_id: itemId, profile_id: profileId, deleted_at: null },
    data: { is_active: false, deleted_at: now }
  });

  await prisma.plaidItem.update({
    where: { id: itemId },
    data: { status: 'disconnected', deleted_at: now }
  });

  return { success: true, itemId };
}

async function exchangePublicTokenForProfile(profileId, publicToken, metadata = {}) {
  if (!publicToken || !String(publicToken).trim()) {
    throw ApiError.badRequest('Plaid public token is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{ location: 'body', field: 'publicToken', message: 'Required field is missing' }]
    });
  }

  const client = getPlaidClient();
  let exchangeResponse;
  let itemResponse;

  try {
    exchangeResponse = await client.itemPublicTokenExchange({
      public_token: String(publicToken).trim()
    });
    itemResponse = await client.itemGet({ access_token: exchangeResponse.data.access_token });
  } catch (error) {
    throw new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Failed to connect Plaid account', {
      code: ERROR_CODES.INTERNAL_SERVER_ERROR,
      details: [{ ...error.response?.data }]
    });
  }

  const accessToken = exchangeResponse.data.access_token;
  const plaidItemId = exchangeResponse.data.item_id;
  const plaidItem = itemResponse.data.item;
  const institution = normalizeInstitutionMetadata(metadata);

  // If there are existing active PlaidItems for this same institution, mark older ones as replaced
  if (institution.institutionId || institution.institutionName) {
    try {
      const oldItems = await prisma.plaidItem.findMany({
        where: {
          profile_id: profileId,
          plaid_item_id: { not: plaidItemId },
          deleted_at: null,
          OR: [
            ...(institution.institutionId ? [{ institution_id: institution.institutionId }] : []),
            ...(institution.institutionName ? [{ institution_name: institution.institutionName }] : [])
          ]
        }
      });

      for (const oldItem of oldItems) {
        await prisma.plaidItem.update({
          where: { id: oldItem.id },
          data: { status: 'disconnected', deleted_at: new Date() }
        });
        await prisma.plaidAccount.updateMany({
          where: { plaid_item_id: oldItem.id, deleted_at: null },
          data: { is_active: false, deleted_at: new Date() }
        });
      }
    } catch (_) {
      // Best-effort
    }
  }

  const item = await prisma.plaidItem.upsert({
    where: { plaid_item_id: plaidItemId },
    create: {
      profile_id: profileId,
      plaid_item_id: plaidItemId,
      access_token: accessToken,
      institution_id: institution.institutionId,
      institution_name: institution.institutionName,
      products: plaidItem.products || [],
      available_products: plaidItem.available_products || [],
      billed_products: plaidItem.billed_products || [],
      status: 'active',
      error: null,
      metadata: sanitizeMetadata(metadata)
    },
    update: {
      profile_id: profileId,
      access_token: accessToken,
      institution_id: institution.institutionId,
      institution_name: institution.institutionName,
      products: plaidItem.products || [],
      available_products: plaidItem.available_products || [],
      billed_products: plaidItem.billed_products || [],
      status: 'active',
      error: null,
      deleted_at: null,
      metadata: sanitizeMetadata(metadata)
    }
  });

  const accounts = await syncPlaidAccounts(profileId, item.id, accessToken, {
    institutionName: institution.institutionName
  });

  return {
    item: pickPublicPlaidItem({ ...item, accounts }),
    accounts: accounts.map(pickPublicPlaidAccount)
  };
}

async function syncPlaidItemForProfile(profileId, plaidItemDbId = null) {
  // Auto-repair any unlinked Plaid transactions in DB where the PlaidAccount is already mapped
  try {
    const linkedPlaidAccounts = await prisma.plaidAccount.findMany({
      where: {
        profile_id: profileId,
        user_chart_account_id: { not: null }
      },
      select: {
        plaid_account_id: true,
        user_chart_account_id: true
      }
    });

    for (const lpa of linkedPlaidAccounts) {
      await prisma.transaction.updateMany({
        where: {
          profile_id: profileId,
          source: 'plaid',
          bank_account_id: null,
          OR: [
            { metadata: { path: ['plaid_account_id'], equals: lpa.plaid_account_id } },
            { metadata: { path: ['account_id'], equals: lpa.plaid_account_id } }
          ]
        },
        data: {
          bank_account_id: lpa.user_chart_account_id
        }
      });
    }
  } catch (repairErr) {
    console.warn('[Plaid Sync] Auto-repair unlinked transactions warning:', repairErr?.message || repairErr);
  }

  const where = {
    profile_id: profileId,
    status: 'active',
    deleted_at: null,
    ...(plaidItemDbId ? { id: plaidItemDbId } : {})
  };

  const rawItems = await prisma.plaidItem.findMany({
    where,
    orderBy: [{ created_at: 'desc' }]
  });

  if (plaidItemDbId && rawItems.length === 0) {
    throw ApiError.notFound('Plaid item not found', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  // Deduplicate items by institution: keep only newest active item, disconnect stale duplicates
  const seenInstitutions = new Set();
  const items = [];
  for (const it of rawItems) {
    const instKey = (it.institution_id || it.institution_name || it.id).toLowerCase().trim();
    if (seenInstitutions.has(instKey)) {
      prisma.plaidItem.update({
        where: { id: it.id },
        data: { status: 'disconnected', deleted_at: new Date() }
      }).catch(() => {});
      continue;
    }
    seenInstitutions.add(instKey);
    items.push(it);
  }

  const results = [];
  const errors = [];
  for (const item of items) {
    try {
      results.push(await syncSinglePlaidItem(profileId, item));
    } catch (itemErr) {
      console.warn(`[Plaid Sync] Error syncing item ${item.id} (${item.institution_name}):`, itemErr?.message || itemErr);
      errors.push({
        itemId: item.id,
        institutionName: item.institution_name,
        error: itemErr?.message || 'Sync failed',
        code: itemErr?.code || 'SYNC_ERROR'
      });
      if (plaidItemDbId) {
        throw itemErr;
      }
    }
  }

  return {
    results,
    errors,
    added: results.reduce((sum, result) => sum + (result.added || 0), 0),
    modified: results.reduce((sum, result) => sum + (result.modified || 0), 0),
    removed: results.reduce((sum, result) => sum + (result.removed || 0), 0)
  };
}

async function syncSinglePlaidItem(profileId, item) {
  const client = getPlaidClient();
  await syncPlaidAccounts(profileId, item.id, item.access_token, {
    institutionName: item.institution_name
  });

  let cursor = item.transactions_cursor || undefined;
  let hasMore = true;
  const added = [];
  const modified = [];
  const removed = [];

  while (hasMore) {
    try {
      const response = await client.transactionsSync({
        access_token: item.access_token,
        cursor,
        count: 500
      });

      added.push(...(response.data.added || []));
      modified.push(...(response.data.modified || []));
      removed.push(...(response.data.removed || []));
      cursor = response.data.next_cursor;
      hasMore = Boolean(response.data.has_more);
    } catch (txSyncErr) {
      hasMore = false;
    }
  }

  // Fetch Plaid Investment Transactions for investment/retirement/brokerage accounts
  try {
    // Find the earliest import start date configured among linked accounts for this item
    const linkedAccountsWithStartDate = await prisma.plaidAccount.findMany({
      where: {
        plaid_item_id: item.id,
        user_chart_account: {
          plaid_import_start_date: { not: null }
        }
      },
      include: {
        user_chart_account: true
      }
    });

    let formattedStart;
    if (linkedAccountsWithStartDate.length > 0) {
      const dates = linkedAccountsWithStartDate
        .map(a => a.user_chart_account.plaid_import_start_date)
        .map(d => typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10))
        .sort();
      formattedStart = dates[0];
    } else {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
      formattedStart = startDate.toISOString().split('T')[0];
    }
    const endDate = new Date();
    const formattedEnd = endDate.toISOString().split('T')[0];

    const invResponse = await client.investmentsTransactionsGet({
      access_token: item.access_token,
      start_date: formattedStart,
      end_date: formattedEnd
    });

    const investmentTransactions = invResponse.data.investment_transactions || [];
    for (const invTxn of investmentTransactions) {
      added.push(invTxn);
    }
  } catch (invError) {
    // If item doesn't support investments or PRODUCT_NOT_READY, gracefully continue
  }

  let actuallyAdded = 0;
  let actuallyModified = 0;

  await prisma.$transaction(async (tx) => {
    for (const transaction of added) {
      let res;
      if (transaction.investment_transaction_id) {
        res = await upsertPlaidInvestmentTransaction(tx, profileId, transaction);
      } else {
        res = await upsertPlaidTransaction(tx, profileId, transaction);
      }
      if (res) actuallyAdded++;
    }

    for (const transaction of modified) {
      let res;
      if (transaction.investment_transaction_id) {
        res = await upsertPlaidInvestmentTransaction(tx, profileId, transaction);
      } else {
        res = await upsertPlaidTransaction(tx, profileId, transaction);
      }
      if (res) actuallyModified++;
    }

    for (const transaction of removed) {
      await tx.transaction.updateMany({
        where: {
          profile_id: profileId,
          external_id: transaction.transaction_id || transaction.investment_transaction_id,
          source: 'plaid'
        },
        data: {
          status: 'deleted',
          deleted_at: new Date(),
          metadata: {
            plaid_removed: true,
            plaid_removed_at: new Date().toISOString()
          }
        }
      });
    }

    await tx.plaidItem.update({
      where: { id: item.id },
      data: {
        status: 'active',
        transactions_cursor: cursor || item.transactions_cursor,
        last_synced_at: new Date(),
        error: null
      }
    });
  }, {
    maxWait: 10000,
    timeout: 60000
  });

  // Collect affected linked accounts to recalculate balances
  try {
    const linkedPlaidAccounts = await prisma.plaidAccount.findMany({
      where: {
        plaid_item_id: item.id,
        user_chart_account_id: { not: null }
      },
      select: { user_chart_account_id: true }
    });
    const accountIds = linkedPlaidAccounts.map(a => a.user_chart_account_id).filter(Boolean);
    if (accountIds.length > 0) {
      await recalculateSavvyBalanceForAccounts(prisma, profileId, accountIds);
    }
  } catch (calcErr) {
    console.warn('[Plaid Sync] Recalculate balances warning:', calcErr?.message || calcErr);
  }

  // Run transfer matching detection on newly imported/updated transactions
  try {
    const { autoMatchTransfersForProfile } = require('./transferMatching.service');
    await autoMatchTransfersForProfile(profileId);
  } catch (matchErr) {
    console.warn('[Plaid Sync] Transfer auto-match warning:', matchErr?.message || matchErr);
  }

  return {
    itemId: item.id,
    institutionName: item.institution_name,
    added: actuallyAdded,
    modified: actuallyModified,
    removed: removed.length
  };
}

async function syncPlaidAccounts(profileId, plaidItemDbId, accessToken, options = {}) {
  const client = getPlaidClient();
  let response;
  try {
    response = await client.accountsGet({ access_token: accessToken });
  } catch (error) {
    const errorData = error.response?.data || {};
    const errorCode = errorData.error_code || '';
    const isLoginRequired = [
      'ITEM_LOGIN_REQUIRED',
      'INVALID_CREDENTIALS',
      'INVALID_UPDATED_USERNAME',
      'ITEM_LOCKED',
      'ACCESS_NOT_GRANTED'
    ].includes(errorCode);

    if (plaidItemDbId) {
      await prisma.plaidItem.update({
        where: { id: plaidItemDbId },
        data: {
          status: isLoginRequired ? 'login_required' : 'error',
          error: errorData
        }
      }).catch(dbErr => console.warn('[Plaid Sync] Failed to update plaidItem status:', dbErr?.message));
    }

    if (isLoginRequired) {
      throw new ApiError(HTTP_STATUS.BAD_REQUEST, errorData.display_message || 'Your bank connection requires re-authentication. Please reconnect your account.', {
        code: 'ITEM_LOGIN_REQUIRED',
        details: [errorData]
      });
    }

    throw new ApiError(HTTP_STATUS.BAD_GATEWAY, errorData.display_message || error.message || 'Unable to communicate with bank.', {
      code: errorCode || 'PLAID_ERROR',
      details: [errorData]
    });
  }
  const plaidAccounts = response.data?.accounts || [];

  return prisma.$transaction(async (tx) => {
    const accounts = [];

    for (const account of plaidAccounts) {
      accounts.push(await upsertPlaidAccountRecord(tx, profileId, plaidItemDbId, account, options));
    }

    return accounts;
  });
}

async function upsertPlaidAccountRecord(tx, profileId, plaidItemDbId, plaidAccount, options = {}) {
  const existing = await tx.plaidAccount.findUnique({
    where: { plaid_account_id: plaidAccount.account_id },
    include: { user_chart_account: true }
  });

  let chartAccount = existing?.user_chart_account || null;

  // Account Deduplication:
  // If no Chart Account is directly linked to this Plaid account, check for an existing
  // matching UserChartOfAccount to prevent creating duplicates for the user.
  if (!chartAccount) {
    // Priority 1: Match by metadata.plaid_account_id in UserChartOfAccount
    const allProfileAccounts = await tx.userChartOfAccount.findMany({
      where: {
        profile_id: profileId,
        is_active: true,
        deleted_at: null
      }
    });

    chartAccount = allProfileAccounts.find(acc => {
      const meta = normalizeJson(acc.metadata);
      return meta.plaid_account_id === plaidAccount.account_id;
    }) || null;

    // Priority 2: Match by 4-digit mask and institution name
    if (!chartAccount && plaidAccount.mask) {
      chartAccount = allProfileAccounts.find(acc => {
        const maskMatches = acc.account_mask === plaidAccount.mask;
        if (!maskMatches) return false;
        if (options.institutionName && acc.institution_name) {
          return acc.institution_name.toLowerCase().trim() === options.institutionName.toLowerCase().trim();
        }
        return true;
      }) || null;
    }

    // Priority 3: Match by 4-digit mask alone
    if (!chartAccount && plaidAccount.mask) {
      chartAccount = allProfileAccounts.find(acc => acc.account_mask === plaidAccount.mask) || null;
    }

    // Priority 4: Match by exact or normalized display_name / account_name / official_name
    if (!chartAccount && (plaidAccount.name || plaidAccount.official_name)) {
      const targetNames = [
        plaidAccount.name?.toLowerCase().trim(),
        plaidAccount.official_name?.toLowerCase().trim()
      ].filter(Boolean);

      chartAccount = allProfileAccounts.find(acc => {
        const accDisplayName = (acc.display_name || '').toLowerCase().trim();
        const accName = (acc.account_name || '').toLowerCase().trim();
        return targetNames.includes(accDisplayName) || targetNames.includes(accName);
      }) || null;
    }
  }

  const accountDetail = mapPlaidToAccountDetail(plaidAccount);

  let template = null;
  if (accountDetail) {
    template = await tx.chartOfAccountsTemplate.findFirst({
      where: {
        OR: [
          { account_detail: accountDetail },
          { account_detail: { equals: accountDetail, mode: 'insensitive' } },
          { account_name: { equals: accountDetail, mode: 'insensitive' } }
        ]
      }
    });
  }

  // Fallback to closest default COA template by account type
  if (!template) {
    const type = normalizePlaidToken(plaidAccount.type);
    if (type === 'investment' || type === 'brokerage') {
      template = await tx.chartOfAccountsTemplate.findFirst({ where: { account_number: 1250 } }) ||
                 await tx.chartOfAccountsTemplate.findFirst({ where: { account_number: 1200 } });
    } else if (type === 'credit') {
      template = await tx.chartOfAccountsTemplate.findFirst({ where: { account_number: 2000 } });
    } else if (type === 'loan') {
      template = await tx.chartOfAccountsTemplate.findFirst({ where: { account_number: 2200 } });
    } else {
      template = await tx.chartOfAccountsTemplate.findFirst({ where: { account_number: 1100 } });
    }
  }

  if (template) {
    const balances = plaidAccount.balances || {};
    const chartData = {
      profile_id: profileId,
      display_name: chartAccount?.display_name || plaidAccount.name,
      institution_name: options.institutionName || chartAccount?.institution_name || null,
      account_mask: plaidAccount.mask || chartAccount?.account_mask || null,
      bank_current_balance: normalizeMoney(balances.current),
      bank_available_balance: normalizeMoney(balances.available),
      bank_balance_synced_at: new Date(),
      current_balance: chartAccount?.current_balance !== undefined ? chartAccount.current_balance : (normalizeMoney(balances.current) ?? 0),
      available_balance: chartAccount?.available_balance !== undefined ? chartAccount.available_balance : (normalizeMoney(balances.available) ?? 0),
      include_in_cash_balance: shouldIncludeInCashBalance(plaidAccount),
      is_active: true,
      is_system: false,
      is_user_created: false,
      class: template.class,
      account_type: template.account_type,
      account_detail: template.account_detail,
      account_name: chartAccount?.account_name || template.account_name,
      icon: chartAccount?.icon || template.icon,
      color: chartAccount?.color || template.color,
      metadata: {
        ...(normalizeJson(chartAccount?.metadata)),
        plaid_account_id: plaidAccount.account_id,
        plaid_type: plaidAccount.type || null,
        plaid_subtype: plaidAccount.subtype || null,
        iso_currency_code: balances.iso_currency_code || null,
        unofficial_currency_code: balances.unofficial_currency_code || null
      }
    };

    if (chartAccount) {
      chartAccount = await tx.userChartOfAccount.update({
        where: { id: chartAccount.id },
        data: {
          ...chartData,
          template_account_number: chartAccount.template_account_number || template.account_number,
          account_number: chartAccount.account_number || await getNextAccountNumber(profileId, template.account_number)
        }
      });

      // Cleanup duplicate unlinked / empty UserChartOfAccount records that match the same mask/plaid_id
      try {
        const duplicates = await tx.userChartOfAccount.findMany({
          where: {
            profile_id: profileId,
            id: { not: chartAccount.id },
            deleted_at: null,
            OR: [
              ...(plaidAccount.mask ? [{ account_mask: plaidAccount.mask, class: template.class }] : []),
              { metadata: { path: ['plaid_account_id'], equals: plaidAccount.account_id } }
            ]
          },
          include: {
            bank_transactions: { select: { id: true }, take: 1 }
          }
        });

        for (const dup of duplicates) {
          // If the duplicate has no transactions, soft-delete it to prevent UI clutter
          if (dup.bank_transactions.length === 0) {
            await tx.userChartOfAccount.update({
              where: { id: dup.id },
              data: { is_active: false, deleted_at: new Date() }
            });
          }
        }
      } catch (_) {
        // Best effort cleanup
      }
    } else {
      chartAccount = await tx.userChartOfAccount.create({
        data: {
          ...chartData,
          template_account_number: template.account_number,
          account_number: await getNextAccountNumber(profileId, template.account_number)
        }
      });
    }
  }

  // Avoid unique constraint violation if another plaid_account row points to this user_chart_account
  if (chartAccount?.id) {
    await tx.plaidAccount.updateMany({
      where: {
        user_chart_account_id: chartAccount.id,
        plaid_account_id: { not: plaidAccount.account_id }
      },
      data: {
        user_chart_account_id: null
      }
    });
  }

  return tx.plaidAccount.upsert({
    where: { plaid_account_id: plaidAccount.account_id },
    create: {
      profile_id: profileId,
      plaid_item_id: plaidItemDbId,
      plaid_account_id: plaidAccount.account_id,
      user_chart_account_id: chartAccount?.id || null,
      ...buildPlaidAccountData(plaidAccount),
      metadata: sanitizeMetadata(plaidAccount)
    },
    update: {
      profile_id: profileId,
      plaid_item_id: plaidItemDbId,
      user_chart_account_id: chartAccount?.id || null,
      ...buildPlaidAccountData(plaidAccount),
      is_active: true,
      deleted_at: null,
      metadata: sanitizeMetadata(plaidAccount)
    },
    include: {
      user_chart_account: true
    }
  });
}

/**
 * Maps Plaid account type/subtype to an existing COA template account_detail.
 */
function mapPlaidToAccountDetail(plaidAccount) {
  const type = normalizePlaidToken(plaidAccount.type);
  const subtype = normalizePlaidToken(plaidAccount.subtype);
  const name = normalizePlaidToken(plaidAccount.name);

  if (type === 'depository') {
    if (['checking', 'paypal'].includes(subtype) || name.includes('checking')) return 'Checking';
    if (['savings', 'gic'].includes(subtype) || name.includes('saving')) return 'Savings';
    if (['money market', 'cd'].includes(subtype) || name.includes('money market')) return 'Savings';
    if (['hsa', 'health'].includes(subtype)) return 'HSA / 529 / TFSA';
    if (['cash management', 'prepaid'].includes(subtype)) return 'Cash on Hand';
    return 'Checking';
  }

  if (type === 'investment' || type === 'brokerage') {
    if (subtype.includes('crypto') || name.includes('crypto') || name.includes('bitcoin') || name.includes('ethereum')) {
      return 'Cryptocurrency';
    }
    if (
      ['401k', '401a', '403b', '457b', 'ira', 'roth', 'sep ira', 'simple ira', 'pension', 'rrsp', 'retirement'].some(s => subtype.includes(s) || name.includes(s))
    ) {
      return '401(k) / IRA';
    }
    if (['hsa', '529', 'tfsa'].some(s => subtype.includes(s) || name.includes(s))) {
      return 'HSA / 529 / TFSA';
    }
    return 'Brokerage / Taxable';
  }

  if (type === 'credit') {
    return 'Credit Card';
  }

  if (type === 'loan') {
    if (subtype.includes('mortgage') || subtype.includes('home equity') || name.includes('mortgage')) return 'Mortgage';
    if (subtype.includes('auto') || name.includes('auto') || name.includes('car')) return 'Auto Loan';
    return 'Personal / Student Loan';
  }

  if (type === 'other') {
    return 'Checking';
  }

  return 'Brokerage / Taxable';
}

function normalizePlaidToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/_/g, ' ');
}

async function upsertPlaidTransaction(tx, profileId, plaidTransaction) {
  const plaidAccount = await tx.plaidAccount.findUnique({
    where: { plaid_account_id: plaidTransaction.account_id },
    include: { user_chart_account: true }
  });
  const bankAccountId = plaidAccount?.user_chart_account_id || null;

  // Filter out any transactions prior to user's selected import start date
  const txnDateStr = String(plaidTransaction.date || '').slice(0, 10);
  let importStartDateStr = null;
  if (plaidAccount?.user_chart_account?.plaid_import_start_date) {
    const rawStart = plaidAccount.user_chart_account.plaid_import_start_date;
    importStartDateStr = typeof rawStart === 'string' ? rawStart.slice(0, 10) : rawStart.toISOString().slice(0, 10);
  } else if (plaidAccount?.user_chart_account?.metadata?.plaid_import_start_date) {
    importStartDateStr = String(plaidAccount.user_chart_account.metadata.plaid_import_start_date).slice(0, 10);
  }

  if (importStartDateStr && txnDateStr && txnDateStr < importStartDateStr) {
    // Transaction date is before the user's selected import start date - do NOT import!
    return null;
  }

  const signedAmount = -Number(plaidTransaction.amount || 0);
  const metadata = buildTransactionMetadata(plaidTransaction);
  const transactionDate = parseDate(plaidTransaction.date);
  const postedDate = parseDate(plaidTransaction.authorized_date || plaidTransaction.date);

  const data = {
    profile_id: profileId,
    bank_account_id: bankAccountId,
    date: transactionDate,
    posted_date: postedDate,
    description: plaidTransaction.merchant_name || plaidTransaction.name || 'Plaid transaction',
    original_description: plaidTransaction.original_description || plaidTransaction.name || null,
    amount: signedAmount,
    transaction_type: signedAmount >= 0 ? 'income' : 'expense',
    status: 'pending',
    source: 'plaid',
    external_id: plaidTransaction.transaction_id,
    imported_at: new Date(),
    metadata
  };

  // 1. Check exact match by Plaid external_id (idempotent update)
  let existing = await tx.transaction.findFirst({
    where: {
      profile_id: profileId,
      external_id: plaidTransaction.transaction_id,
      source: 'plaid'
    }
  });

  // 2. Check pending-to-posted clearance (Plaid pending_transaction_id)
  if (!existing && plaidTransaction.pending_transaction_id) {
    existing = await tx.transaction.findFirst({
      where: {
        profile_id: profileId,
        external_id: plaidTransaction.pending_transaction_id,
        source: 'plaid'
      }
    });
  }

  // 3. Check for matching existing transaction on same account to avoid duplicates from reconnects/manual entries
  if (!existing && bankAccountId) {
    const minDate = new Date(transactionDate.getTime() - 2 * 24 * 60 * 60 * 1000);
    const maxDate = new Date(transactionDate.getTime() + 2 * 24 * 60 * 60 * 1000);

    const matchCandidates = await tx.transaction.findMany({
      where: {
        profile_id: profileId,
        bank_account_id: bankAccountId,
        amount: signedAmount,
        deleted_at: null,
        date: {
          gte: minDate,
          lte: maxDate
        },
        status: { in: ['pending', 'posted', 'reviewed'] }
      },
      orderBy: { created_at: 'desc' },
      take: 10
    });

    const STOP_WORDS = new Set(['the', 'and', 'or', 'inc', 'llc', 'corp', 'co', 'ltd', 'com', 'store', 'shop', 'us', 'usa']);
    const cleanPlaidDesc = (str) => {
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

    const plaidDescList = [
      cleanPlaidDesc(plaidTransaction.merchant_name),
      cleanPlaidDesc(plaidTransaction.name),
      cleanPlaidDesc(plaidTransaction.original_description)
    ].filter(Boolean);

    for (const cand of matchCandidates) {
      // Never match/overwrite another distinct Plaid transaction that has its own external_id
      if (cand.source === 'plaid' && cand.external_id && cand.external_id !== plaidTransaction.transaction_id) {
        continue;
      }

      const candDescList = [
        cleanPlaidDesc(cand.description),
        cleanPlaidDesc(cand.original_description)
      ].filter(Boolean);

      if (plaidDescList.length === 0 && candDescList.length === 0) {
        existing = cand;
        break;
      }

      let isMatch = false;
      for (const pDesc of plaidDescList) {
        for (const cDesc of candDescList) {
          if (pDesc === cDesc) {
            isMatch = true;
            break;
          }
          const pTokens = pDesc.split(' ').map(w => w.trim()).filter(w => w.length > 2 && !STOP_WORDS.has(w));
          const cTokens = cDesc.split(' ').map(w => w.trim()).filter(w => w.length > 2 && !STOP_WORDS.has(w));
          if (pTokens.length > 0 && cTokens.length > 0) {
            const setC = new Set(cTokens);
            const intersection = pTokens.filter(t => setC.has(t));
            const union = new Set([...pTokens, ...cTokens]);
            if (intersection.length / union.size >= 0.6) {
              isMatch = true;
              break;
            }
            const minT = Math.min(pTokens.length, cTokens.length);
            if (minT >= 1 && intersection.length === minT && pTokens[0] === cTokens[0]) {
              isMatch = true;
              break;
            }
          }
        }
        if (isMatch) break;
      }

      if (isMatch) {
        existing = cand;
        break;
      }
    }
  }

  if (existing) {
    return tx.transaction.update({
      where: { id: existing.id },
      data: {
        ...data,
        // Preserve user categorization, contact, and splits if already configured
        category_account_id: existing.category_account_id || undefined,
        contact_id: existing.contact_id || undefined,
        deleted_at: null,
        metadata: {
          ...normalizeJson(existing.metadata),
          ...metadata,
          matched_existing_transaction: existing.source !== 'plaid' ? true : undefined
        }
      }
    });
  }

  return tx.transaction.create({ data });
}

async function upsertPlaidInvestmentTransaction(tx, profileId, invTxn) {
  const plaidAccount = await tx.plaidAccount.findUnique({
    where: { plaid_account_id: invTxn.account_id },
    include: { user_chart_account: true }
  });
  const bankAccountId = plaidAccount?.user_chart_account_id || null;

  // Filter out any investment transactions prior to user's selected import start date
  const txnDateStr = String(invTxn.date || '').slice(0, 10);
  let importStartDateStr = null;
  if (plaidAccount?.user_chart_account?.plaid_import_start_date) {
    const rawStart = plaidAccount.user_chart_account.plaid_import_start_date;
    importStartDateStr = typeof rawStart === 'string' ? rawStart.slice(0, 10) : rawStart.toISOString().slice(0, 10);
  } else if (plaidAccount?.user_chart_account?.metadata?.plaid_import_start_date) {
    importStartDateStr = String(plaidAccount.user_chart_account.metadata.plaid_import_start_date).slice(0, 10);
  }

  if (importStartDateStr && txnDateStr && txnDateStr < importStartDateStr) {
    return null;
  }

  const signedAmount = -Number(invTxn.amount || 0);
  const transactionDate = parseDate(invTxn.date);

  const data = {
    profile_id: profileId,
    bank_account_id: bankAccountId,
    date: transactionDate,
    posted_date: parseDate(invTxn.date),
    description: invTxn.name || `${invTxn.type || 'Investment'} transaction`,
    original_description: invTxn.name || null,
    amount: signedAmount,
    transaction_type: signedAmount >= 0 ? 'income' : 'expense',
    status: 'pending',
    source: 'plaid',
    external_id: invTxn.investment_transaction_id,
    imported_at: new Date(),
    metadata: {
      plaid_account_id: invTxn.account_id || null,
      plaid_investment_transaction_id: invTxn.investment_transaction_id || null,
      investment_type: invTxn.type || null,
      investment_subtype: invTxn.subtype || null,
      quantity: invTxn.quantity || null,
      price: invTxn.price || null,
      fees: invTxn.fees || null,
      security_id: invTxn.security_id || null
    }
  };

  // 1. Check exact match by Plaid investment_transaction_id (idempotent update)
  let existing = await tx.transaction.findFirst({
    where: {
      profile_id: profileId,
      external_id: invTxn.investment_transaction_id,
      source: 'plaid'
    }
  });

  // 2. Check for matching existing transaction on same investment account
  if (!existing && bankAccountId) {
    const minDate = new Date(transactionDate.getTime() - 4 * 24 * 60 * 60 * 1000);
    const maxDate = new Date(transactionDate.getTime() + 4 * 24 * 60 * 60 * 1000);

    const matchCandidate = await tx.transaction.findFirst({
      where: {
        profile_id: profileId,
        bank_account_id: bankAccountId,
        amount: signedAmount,
        deleted_at: null,
        date: {
          gte: minDate,
          lte: maxDate
        },
        status: { in: ['pending', 'posted', 'reviewed'] }
      },
      orderBy: { created_at: 'desc' }
    });

    if (matchCandidate) {
      existing = matchCandidate;
    }
  }

  if (existing) {
    return tx.transaction.update({
      where: { id: existing.id },
      data: {
        ...data,
        category_account_id: existing.category_account_id || undefined,
        contact_id: existing.contact_id || undefined,
        deleted_at: null,
        metadata: {
          ...normalizeJson(existing.metadata),
          ...data.metadata,
          matched_existing_transaction: existing.source !== 'plaid' ? true : undefined
        }
      }
    });
  }

  return tx.transaction.create({ data });
}

function buildPlaidAccountData(account) {
  const balances = account.balances || {};
  return {
    name: account.name,
    official_name: account.official_name || null,
    mask: account.mask || null,
    type: account.type || null,
    subtype: account.subtype || null,
    verification_status: account.verification_status || null,
    current_balance: normalizeMoney(balances.current),
    available_balance: normalizeMoney(balances.available),
    iso_currency_code: balances.iso_currency_code || null,
    unofficial_currency_code: balances.unofficial_currency_code || null
  };
}

function buildTransactionMetadata(transaction) {
  return {
    plaid_account_id: transaction.account_id || null,
    plaid_category: transaction.category || [],
    plaid_category_id: transaction.category_id || null,
    plaid_counterparties: transaction.counterparties || [],
    plaid_payment_channel: transaction.payment_channel || null,
    plaid_pending: Boolean(transaction.pending),
    plaid_pending_transaction_id: transaction.pending_transaction_id || null,
    plaid_transaction_code: transaction.transaction_code || null,
    plaid_transaction_type: transaction.transaction_type || null,
    plaid_website: transaction.website || null,
    plaid_logo_url: transaction.logo_url || null
  };
}

function pickPublicPlaidItem(item) {
  return {
    id: item.id,
    profile_id: item.profile_id,
    plaid_item_id: item.plaid_item_id,
    institution_id: item.institution_id,
    institution_name: item.institution_name,
    products: item.products || [],
    available_products: item.available_products || [],
    billed_products: item.billed_products || [],
    status: item.status,
    last_synced_at: item.last_synced_at,
    error: item.error,
    accounts: item.accounts ? item.accounts.map(pickPublicPlaidAccount) : undefined,
    created_at: item.created_at,
    updated_at: item.updated_at
  };
}

function pickPublicPlaidAccount(account) {
  return {
    id: account.id,
    profile_id: account.profile_id,
    plaid_item_id: account.plaid_item_id,
    plaid_account_id: account.plaid_account_id,
    user_chart_account_id: account.user_chart_account_id,
    name: account.name,
    official_name: account.official_name,
    mask: account.mask,
    type: account.type,
    subtype: account.subtype,
    verification_status: account.verification_status,
    current_balance: normalizeMoney(account.current_balance),
    available_balance: normalizeMoney(account.available_balance),
    iso_currency_code: account.iso_currency_code,
    unofficial_currency_code: account.unofficial_currency_code,
    is_active: account.is_active,
    account: account.user_chart_account ? pickPublicAccount(account.user_chart_account) : undefined,
    created_at: account.created_at,
    updated_at: account.updated_at
  };
}

function assertPlaidConfigured() {
  if (!isPlaidConfigured()) {
    throw new ApiError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'Plaid is not configured', {
      code: ERROR_CODES.SERVICE_UNAVAILABLE,
      details: [
        { location: 'env', field: 'PLAID_CLIENT_ID', message: 'Required for Plaid integration' },
        { location: 'env', field: 'PLAID_SECRET', message: 'Required for Plaid integration' }
      ]
    });
  }
}

function isPlaidConfigured() {
  return Boolean(env.plaidClientId && env.plaidSecret);
}

function normalizeInstitutionMetadata(metadata = {}) {
  const institution = metadata.institution || {};
  return {
    institutionId: institution.institution_id || metadata.institution_id || null,
    institutionName: institution.name || metadata.institution_name || null
  };
}

function sanitizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const clone = { ...value };
  delete clone.public_token;
  delete clone.publicToken;
  delete clone.access_token;
  delete clone.accessToken;
  return clone;
}

function normalizeJson(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function parseCsv(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseDate(value) {
  if (!value) return new Date();
  if (value instanceof Date) return value;
  const str = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return new Date(`${str}T12:00:00.000Z`);
  }
  return new Date(str);
}

function normalizeMoney(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function shouldIncludeInCashBalance(account) {
  return account.type === 'depository' && ['checking', 'savings', 'cash management'].includes(account.subtype);
}

async function recalculateSavvyBalanceForAccounts(tx, profileId, accountIds = []) {
  if (!accountIds || accountIds.length === 0) return;

  const { createOrUpdateOpeningBalanceJournalEntryForProfile, refreshBalancesForAccountIds } = require('./journalEntry.service');

  for (const accountId of accountIds) {
    const account = await tx.userChartOfAccount.findUnique({
      where: { id: accountId }
    });
    if (!account) continue;

    const accountClass = String(account.class || 'asset').toLowerCase();
    const isAsset = ['asset', 'expense'].includes(accountClass);

    const transactions = await tx.transaction.findMany({
      where: {
        profile_id: profileId,
        bank_account_id: accountId,
        deleted_at: null
      },
      orderBy: [
        { date: 'asc' },
        { created_at: 'asc' }
      ]
    });

    // Calculate Net Ledger Movement according to double-entry conventions:
    // Asset: Inflow (positive amount) debits bank (+), Outflow (negative amount) credits bank (-)
    // Liability: Expense (negative amount) credits liability (+ debt), Payment (positive amount) debits liability (- debt)
    const netLedgerMovementAll = transactions.reduce((sum, t) => {
      const amount = Number(t.amount || 0);
      const effect = isAsset ? amount : -amount;
      return sum + effect;
    }, 0);

    const netLedgerMovementPosted = transactions
      .filter(t => t.status === 'posted' || t.status === 'reviewed')
      .reduce((sum, t) => {
        const amount = Number(t.amount || 0);
        const effect = isAsset ? amount : -amount;
        return sum + effect;
      }, 0);

    const bankBalance = Number(account.bank_current_balance ?? account.current_balance ?? 0);

    let openingBalance = Number(account.opening_balance ?? 0);
    let openingLocked = Boolean(account.opening_balance_locked);

    // If opening balance is not yet locked, auto-calculate backwards:
    // Opening Balance = Current Bank Balance - Net Ledger Movement of all imported transactions
    if (!openingLocked) {
      openingBalance = Number((bankBalance - netLedgerMovementAll).toFixed(2));
      openingLocked = true;
    }

    // Determine Opening Balance Date: 1 day immediately before the earliest imported transaction,
    // or 1 day before the configured plaid_import_start_date
    let openingDate;
    if (transactions.length > 0) {
      const earliestTxDate = new Date(transactions[0].date);
      const dayBefore = new Date(earliestTxDate.getTime() - 86400000);
      openingDate = dayBefore.toISOString().slice(0, 10);
    } else if (account.plaid_import_start_date) {
      const impDate = typeof account.plaid_import_start_date === 'string'
        ? new Date(account.plaid_import_start_date)
        : account.plaid_import_start_date;
      const dayBefore = new Date(impDate.getTime() - 86400000);
      openingDate = !isNaN(dayBefore.getTime()) ? dayBefore.toISOString().slice(0, 10) : impDate.toISOString().slice(0, 10);
    } else {
      openingDate = account.metadata?.opening_balance_date || account.metadata?.as_of_date || new Date().toISOString().slice(0, 10);
    }

    const calculatedSavvyBalance = Number((openingBalance + netLedgerMovementPosted).toFixed(2));
    const variance = Number((bankBalance - calculatedSavvyBalance).toFixed(2));

    await tx.userChartOfAccount.update({
      where: { id: accountId },
      data: {
        opening_balance: openingBalance,
        opening_balance_locked: openingLocked,
        current_balance: calculatedSavvyBalance,
        reconciliation_variance: variance,
        last_reconciled_at: new Date(),
        metadata: {
          ...normalizeJson(account.metadata),
          opening_balance_date: openingDate,
          as_of_date: openingDate,
          opening_balance_amount: openingBalance,
          imported_transaction_count: transactions.length,
          imported_transaction_start: transactions[0]?.date ? new Date(transactions[0].date).toISOString().slice(0, 10) : null,
          imported_transaction_end: transactions[transactions.length - 1]?.date ? new Date(transactions[transactions.length - 1].date).toISOString().slice(0, 10) : null
        }
      }
    });

    if (Math.abs(openingBalance) >= 0.01) {
      try {
        await createOrUpdateOpeningBalanceJournalEntryForProfile(profileId, null, {
          accountId: account.id,
          openingBalance,
          openingDate,
          accountName: account.display_name || account.account_name,
          accountClass: account.class
        }, tx);
      } catch (err) {
        console.warn('[Plaid Balance] Opening balance journal entry warning:', err?.message || err);
      }
    }

    // Refresh ledger balance from journal lines
    try {
      await refreshBalancesForAccountIds(tx, [accountId]);
    } catch (_) {}
  }
}

async function mapPlaidAccountsForProfile(profileId, mappings = []) {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw ApiError.badRequest('Mappings array is required');
  }

  const isUuid = (val) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(val || ''));
  const updatedAccounts = [];

  for (const mapping of mappings) {
    const {
      plaid_account_id,
      user_chart_account_id,
      import_start_date,
      create_inline,
      inline_account_name,
      inline_account_type
    } = mapping;

    try {
      const plaidAccount = await prisma.plaidAccount.findFirst({
        where: {
          profile_id: profileId,
          OR: [
            { plaid_account_id: String(plaid_account_id) },
            ...(isUuid(plaid_account_id) ? [{ id: plaid_account_id }] : [])
          ]
        },
        include: { plaid_item: true }
      });

      if (!plaidAccount) {
        console.warn(`[Plaid Mapping] Plaid account ${plaid_account_id} not found for profile ${profileId}`);
        continue;
      }

      let targetChartAccountId = user_chart_account_id && isUuid(user_chart_account_id) ? user_chart_account_id : null;

      let parsedImportStartDate = null;
      if (import_start_date) {
        const dateStr = String(import_start_date).trim().slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
          const d = new Date(`${dateStr}T00:00:00.000Z`);
          if (!isNaN(d.getTime())) {
            parsedImportStartDate = d;
          }
        }
      }

      // Inline Account Creation if user chose "+ Create New"
      if (create_inline || user_chart_account_id === 'create_new' || !targetChartAccountId) {
        const type = normalizePlaidToken(plaidAccount.type);
        let accountClass = 'asset';
        let templateNumber = 1100;

        if (type === 'credit') {
          accountClass = 'liability';
          templateNumber = 2000;
        } else if (type === 'loan') {
          accountClass = 'liability';
          templateNumber = 2200;
        } else if (type === 'investment' || type === 'brokerage') {
          accountClass = 'asset';
          templateNumber = 1200;
        }

        const template = await prisma.chartOfAccountsTemplate.findFirst({
          where: { account_number: templateNumber }
        }) || await prisma.chartOfAccountsTemplate.findFirst({
          where: { class: accountClass }
        });

        const nextNum = await getNextAccountNumber(profileId, template?.account_number || templateNumber);
        const newAcc = await prisma.userChartOfAccount.create({
          data: {
            profile_id: profileId,
            display_name: inline_account_name || plaidAccount.name,
            account_name: inline_account_name || plaidAccount.name,
            institution_name: plaidAccount.plaid_item?.institution_name || null,
            account_mask: plaidAccount.mask || null,
            class: accountClass,
            account_type: inline_account_type || template?.account_type || 'bank_account',
            account_detail: mapPlaidToAccountDetail(plaidAccount),
            template_account_number: template?.account_number || null,
            account_number: nextNum,
            current_balance: normalizeMoney(plaidAccount.current_balance) ?? 0,
            available_balance: normalizeMoney(plaidAccount.available_balance),
            bank_current_balance: normalizeMoney(plaidAccount.current_balance),
            bank_available_balance: normalizeMoney(plaidAccount.available_balance),
            bank_balance_synced_at: new Date(),
            plaid_import_start_date: parsedImportStartDate,
            include_in_cash_balance: shouldIncludeInCashBalance(plaidAccount),
            is_active: true,
            is_user_created: true,
            metadata: {
              plaid_account_id: plaidAccount.plaid_account_id,
              plaid_type: plaidAccount.type,
              plaid_subtype: plaidAccount.subtype,
              plaid_import_start_date: parsedImportStartDate ? parsedImportStartDate.toISOString().slice(0, 10) : null
            }
          }
        });

        targetChartAccountId = newAcc.id;
      } else {
        // Existing COA selected: verify ownership and update with Plaid import start date & live bank balances
        const existingCoa = await prisma.userChartOfAccount.findFirst({
          where: { id: targetChartAccountId, profile_id: profileId, deleted_at: null }
        });

        if (existingCoa) {
          await prisma.userChartOfAccount.update({
            where: { id: targetChartAccountId },
            data: {
              institution_name: plaidAccount.plaid_item?.institution_name || existingCoa.institution_name,
              account_mask: plaidAccount.mask || existingCoa.account_mask || undefined,
              bank_current_balance: normalizeMoney(plaidAccount.current_balance),
              bank_available_balance: normalizeMoney(plaidAccount.available_balance),
              bank_balance_synced_at: new Date(),
              plaid_import_start_date: parsedImportStartDate,
              opening_balance_locked: false, // Reset lock to recalculate opening balance for new import range
              metadata: {
                ...(normalizeJson(existingCoa.metadata)),
                plaid_account_id: plaidAccount.plaid_account_id,
                plaid_type: plaidAccount.type,
                plaid_subtype: plaidAccount.subtype,
                plaid_import_start_date: parsedImportStartDate ? parsedImportStartDate.toISOString().slice(0, 10) : null
              }
            }
          });
        }
      }

      // Clear any prior links for this user_chart_account_id to prevent @unique constraint collision
      if (targetChartAccountId) {
        await prisma.plaidAccount.updateMany({
          where: {
            user_chart_account_id: targetChartAccountId,
            id: { not: plaidAccount.id }
          },
          data: {
            user_chart_account_id: null
          }
        });
      }

      // Link PlaidAccount to UserChartOfAccount
      await prisma.plaidAccount.update({
        where: { id: plaidAccount.id },
        data: {
          user_chart_account_id: targetChartAccountId
        }
      });

      // Update any existing transactions in DB for this Plaid account to point to the newly linked chart account
      if (targetChartAccountId) {
        await prisma.transaction.updateMany({
          where: {
            profile_id: profileId,
            source: 'plaid',
            OR: [
              { metadata: { path: ['plaid_account_id'], equals: plaidAccount.plaid_account_id } },
              { metadata: { path: ['account_id'], equals: plaidAccount.plaid_account_id } }
            ]
          },
          data: {
            bank_account_id: targetChartAccountId
          }
        });

        // Clean up / remove any existing pending Plaid transactions older than the selected import_start_date
        if (parsedImportStartDate) {
          await prisma.transaction.updateMany({
            where: {
              profile_id: profileId,
              bank_account_id: targetChartAccountId,
              source: 'plaid',
              status: 'pending',
              date: {
                lt: parsedImportStartDate
              },
              deleted_at: null
            },
            data: {
              status: 'deleted',
              deleted_at: new Date()
            }
          });
        }
      }

      // Reset transactions_cursor on the PlaidItem so syncPlaidItemForProfile will pull from beginning
      if (plaidAccount.plaid_item_id) {
        await prisma.plaidItem.update({
          where: { id: plaidAccount.plaid_item_id },
          data: {
            transactions_cursor: null
          }
        });
      }

      updatedAccounts.push(targetChartAccountId);
    } catch (mapErr) {
      console.error(`[Plaid Mapping] Failed to map account ${plaid_account_id}:`, mapErr);
      throw mapErr;
    }
  }

  let syncResult = null;
  // Trigger sync to pull historical transactions respecting import_start_date
  try {
    syncResult = await syncPlaidItemForProfile(profileId);
  } catch (syncErr) {
    console.warn('[Plaid Mapping] Background sync warning:', syncErr?.message || syncErr);
  }

  // Recalculate savvy balance & opening balance for updated accounts
  try {
    await recalculateSavvyBalanceForAccounts(prisma, profileId, updatedAccounts.filter(Boolean));
  } catch (calcErr) {
    console.warn('[Plaid Mapping] Recalculate balance warning:', calcErr?.message || calcErr);
  }

  return {
    success: true,
    mapped_account_ids: updatedAccounts,
    imported_count: syncResult?.added || 0,
    modified_count: syncResult?.modified || 0
  };
}

async function refreshPlaidAccountBalance(profileId, plaidAccountId) {
  const plaidAccount = await prisma.plaidAccount.findUnique({
    where: { plaid_account_id: plaidAccountId },
    include: { plaid_item: true, user_chart_account: true }
  });
  if (!plaidAccount || plaidAccount.profile_id !== profileId) {
    throw ApiError.notFound('Plaid account not found');
  }

  const client = getPlaidClient();
  const response = await client.accountsBalanceGet({
    access_token: plaidAccount.plaid_item.access_token,
    options: {
      account_ids: [plaidAccountId]
    }
  });

  const updatedPlaid = response.data.accounts?.[0];
  if (!updatedPlaid) {
    throw ApiError.badRequest('Could not retrieve balance from bank');
  }

  const balances = updatedPlaid.balances || {};
  const currentBankBal = normalizeMoney(balances.current);
  const availBankBal = normalizeMoney(balances.available);

  await prisma.$transaction(async (tx) => {
    await tx.plaidAccount.update({
      where: { id: plaidAccount.id },
      data: {
        current_balance: currentBankBal,
        available_balance: availBankBal
      }
    });

    if (plaidAccount.user_chart_account_id) {
      await tx.userChartOfAccount.update({
        where: { id: plaidAccount.user_chart_account_id },
        data: {
          bank_current_balance: currentBankBal,
          bank_available_balance: availBankBal,
          bank_balance_synced_at: new Date()
        }
      });

      await recalculateSavvyBalanceForAccounts(tx, profileId, [plaidAccount.user_chart_account_id]);
    }
  });

  return {
    success: true,
    plaid_account_id: plaidAccountId,
    bank_current_balance: currentBankBal,
    bank_available_balance: availBankBal,
    synced_at: new Date().toISOString()
  };
}

async function unlinkPlaidAccountForProfile(profileId, accountId) {
  if (!accountId) {
    throw ApiError.badRequest('Account ID is required');
  }

  // Find linked PlaidAccount by ID, user_chart_account_id, or plaid_account_id
  const plaidAccount = await prisma.plaidAccount.findFirst({
    where: {
      profile_id: profileId,
      deleted_at: null,
      OR: [
        { id: accountId },
        { user_chart_account_id: accountId },
        { plaid_account_id: accountId }
      ]
    },
    include: {
      plaid_item: true
    }
  });

  const chartAccount = await prisma.userChartOfAccount.findFirst({
    where: {
      id: accountId,
      profile_id: profileId,
      deleted_at: null
    }
  });

  const chartAccountId = chartAccount?.id || plaidAccount?.user_chart_account_id;

  const now = new Date();

  if (plaidAccount) {
    await prisma.plaidAccount.update({
      where: { id: plaidAccount.id },
      data: {
        user_chart_account_id: null,
        is_active: false,
        deleted_at: now
      }
    });

    // Check if there are other active plaid accounts under this item
    const remainingActive = await prisma.plaidAccount.count({
      where: {
        plaid_item_id: plaidAccount.plaid_item_id,
        profile_id: profileId,
        deleted_at: null
      }
    });

    if (remainingActive === 0 && plaidAccount.plaid_item) {
      try {
        const client = getPlaidClient();
        await client.itemRemove({ access_token: plaidAccount.plaid_item.access_token });
      } catch (_) {
        // Best effort item remove
      }

      await prisma.plaidItem.update({
        where: { id: plaidAccount.plaid_item_id },
        data: { status: 'disconnected', deleted_at: now }
      });
    }
  }

  if (chartAccountId) {
    const targetAccount = await prisma.userChartOfAccount.findUnique({
      where: { id: chartAccountId }
    });

    if (targetAccount) {
      const meta = typeof targetAccount.metadata === 'object' && targetAccount.metadata !== null ? { ...targetAccount.metadata } : {};
      delete meta.plaid_account_id;
      delete meta.plaid_item_id;

      await prisma.userChartOfAccount.update({
        where: { id: chartAccountId },
        data: {
          bank_current_balance: null,
          bank_available_balance: null,
          bank_balance_synced_at: null,
          metadata: meta
        }
      });
    }
  }

  return {
    success: true,
    message: 'Account successfully disconnected from bank'
  };
}

module.exports = {
  getPlaidStatusForProfile,
  createLinkTokenForProfile,
  createUpdateLinkTokenForProfile,
  exchangePublicTokenForProfile,
  syncPlaidItemForProfile,
  disconnectPlaidItemForProfile,
  unlinkPlaidAccountForProfile,
  mapPlaidAccountsForProfile,
  refreshPlaidAccountBalance,
  recalculateSavvyBalanceForAccounts
};
