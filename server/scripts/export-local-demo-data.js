#!/usr/bin/env node
/**
 * Export Local Demo Data
 * Pulls the first profile's financial data from local DB and saves it as demo-seed-data.json
 * Run from server/: node scripts/export-local-demo-data.js
 */
require('dotenv').config();
const { prisma, disconnectDatabase } = require('../config/database');
const fs = require('fs');
const path = require('path');

async function main() {
  console.log('Finding first active profile...');

  // Get first active owner profile
  const membership = await prisma.profileMembership.findFirst({
    where: { role: 'owner' },
    include: { profile: true },
    orderBy: { created_at: 'asc' }
  });

  if (!membership) {
    console.error('No owner profile found. Make sure you have logged in at least once.');
    process.exit(1);
  }

  const profileId = membership.profile_id;
  const profile = membership.profile;
  console.log(`Using profile: ${profile.display_name || profile.name} (${profileId})`);

  // ── 1. Chart of Accounts (Income & Expense & Asset & Liability) ──────────────
  console.log('Exporting chart of accounts...');
  const chartAccounts = await prisma.userChartOfAccount.findMany({
    where: { profile_id: profileId, deleted_at: null },
    orderBy: [{ class: 'asc' }, { account_name: 'asc' }]
  });

  // ── 2. PlaidItems ─────────────────────────────────────────────────────────────
  console.log('Exporting Plaid items...');
  const plaidItems = await prisma.plaidItem.findMany({
    where: { profile_id: profileId, deleted_at: null }
  });

  // ── 3. PlaidAccounts ──────────────────────────────────────────────────────────
  console.log('Exporting Plaid accounts...');
  const plaidAccounts = await prisma.plaidAccount.findMany({
    where: { profile_id: profileId, deleted_at: null }
  });

  // ── 4. Transactions ───────────────────────────────────────────────────────────
  console.log('Exporting transactions...');
  const transactions = await prisma.transaction.findMany({
    where: { profile_id: profileId, deleted_at: null },
    orderBy: { date: 'asc' },
    take: 1000 // cap at 1000 to keep file reasonable
  });

  // ── 5. Journal Entries + Lines ────────────────────────────────────────────────
  console.log('Exporting journal entries...');
  const journalEntries = await prisma.journalEntry.findMany({
    where: { profile_id: profileId, deleted_at: null },
    include: { lines: true },
    orderBy: { entry_date: 'asc' }
  });

  // ── 6. Budgets ────────────────────────────────────────────────────────────────
  console.log('Exporting budgets...');
  const budgets = await prisma.budget.findMany({
    where: { profile_id: profileId, is_active: true }
  });

  // ── Build ID mapping for anonymization ───────────────────────────────────────
  // Map original UUIDs -> template keys like "acct_1", "acct_2", ...
  const acctMap = {};
  let acctIdx = 1;
  chartAccounts.forEach(a => {
    acctMap[a.id] = `acct_${acctIdx++}`;
  });

  const plaidItemMap = {};
  let piIdx = 1;
  plaidItems.forEach(pi => {
    plaidItemMap[pi.id] = `plaid_item_${piIdx++}`;
  });

  // ── Normalize chart accounts ──────────────────────────────────────────────────
  const normalizedAccounts = chartAccounts.map(a => ({
    _key: acctMap[a.id],
    template_account_number: a.template_account_number,
    account_number: a.account_number,
    account_name: a.account_name,
    display_name: a.display_name,
    class: a.class,
    account_type: a.account_type,
    account_detail: a.account_detail,
    parent_key: a.parent_account_id ? acctMap[a.parent_account_id] || null : null,
    institution_name: a.institution_name,
    account_mask: a.account_mask,
    current_balance: Number(a.current_balance) || 0,
    available_balance: a.available_balance !== null ? Number(a.available_balance) : null,
    opening_balance: a.opening_balance !== null ? Number(a.opening_balance) : null,
    include_in_cash_balance: a.include_in_cash_balance,
    is_active: a.is_active,
    is_system: a.is_system,
    is_user_created: a.is_user_created,
    icon: a.icon,
    color: a.color,
    metadata: a.metadata || {}
  }));

  // ── Normalize Plaid items ─────────────────────────────────────────────────────
  const normalizedPlaidItems = plaidItems.map(pi => ({
    _key: plaidItemMap[pi.id],
    institution_id: pi.institution_id,
    institution_name: pi.institution_name,
    products: pi.products,
    status: pi.status
  }));

  // ── Normalize Plaid accounts ──────────────────────────────────────────────────
  const normalizedPlaidAccounts = plaidAccounts.map(pa => ({
    plaid_item_key: plaidItemMap[pa.plaid_item_id] || null,
    user_chart_account_key: pa.user_chart_account_id ? acctMap[pa.user_chart_account_id] || null : null,
    name: pa.name,
    official_name: pa.official_name,
    mask: pa.mask,
    type: pa.type,
    subtype: pa.subtype,
    current_balance: pa.current_balance !== null ? Number(pa.current_balance) : null,
    available_balance: pa.available_balance !== null ? Number(pa.available_balance) : null,
    iso_currency_code: pa.iso_currency_code,
    is_active: pa.is_active
  }));

  // ── Find date range of transactions ──────────────────────────────────────────
  let minDate = null, maxDate = null;
  transactions.forEach(t => {
    const d = new Date(t.date);
    if (!minDate || d < minDate) minDate = d;
    if (!maxDate || d > maxDate) maxDate = d;
  });

  // ── Normalize transactions ─────────────────────────────────────────────────────
  const normalizedTransactions = transactions.map((t, i) => ({
    _key: `txn_${i + 1}`,
    bank_account_key: t.bank_account_id ? acctMap[t.bank_account_id] || null : null,
    category_account_key: t.category_account_id ? acctMap[t.category_account_id] || null : null,
    date_offset_days: minDate ? Math.round((new Date(t.date) - minDate) / 86400000) : 0,
    description: t.description,
    original_description: t.original_description,
    amount: Number(t.amount),
    transaction_type: t.transaction_type,
    status: t.status,
    memo: t.memo,
    source: t.source || 'demo'
  }));

  // ── Normalize journal entries ──────────────────────────────────────────────────
  const txnKeyByJeId = {};
  journalEntries.forEach(je => {
    if (je.source_transaction_id) {
      const txIdx = transactions.findIndex(t => t.id === je.source_transaction_id);
      if (txIdx >= 0) txnKeyByJeId[je.id] = `txn_${txIdx + 1}`;
    }
  });

  const normalizedJournalEntries = journalEntries.map((je, i) => ({
    _key: `je_${i + 1}`,
    source_transaction_key: txnKeyByJeId[je.id] || null,
    date_offset_days: minDate ? Math.round((new Date(je.entry_date) - minDate) / 86400000) : 0,
    description: je.description,
    memo: je.memo,
    source: je.source || 'demo',
    status: je.status,
    lines: je.lines.map(l => ({
      account_key: acctMap[l.account_id] || null,
      description: l.description,
      debit: Number(l.debit),
      credit: Number(l.credit)
    }))
  }));

  // ── Normalize budgets ──────────────────────────────────────────────────────────
  const normalizedBudgets = budgets.map((b, i) => ({
    _key: `budget_${i + 1}`,
    chart_account_key: b.chart_account_id ? acctMap[b.chart_account_id] || null : null,
    name: b.name,
    amount: Number(b.amount),
    cadence: b.cadence,
    rollover_enabled: b.rollover_enabled,
    is_active: b.is_active
  }));

  // ── Write output ───────────────────────────────────────────────────────────────
  const output = {
    _meta: {
      exported_at: new Date().toISOString(),
      source_profile: profile.display_name || profile.name,
      date_range: {
        min_date: minDate ? minDate.toISOString().slice(0, 10) : null,
        max_date: maxDate ? maxDate.toISOString().slice(0, 10) : null,
        span_days: minDate && maxDate ? Math.round((maxDate - minDate) / 86400000) : 0
      },
      counts: {
        chart_accounts: normalizedAccounts.length,
        plaid_items: normalizedPlaidItems.length,
        plaid_accounts: normalizedPlaidAccounts.length,
        transactions: normalizedTransactions.length,
        journal_entries: normalizedJournalEntries.length,
        budgets: normalizedBudgets.length
      }
    },
    chartAccounts: normalizedAccounts,
    plaidItems: normalizedPlaidItems,
    plaidAccounts: normalizedPlaidAccounts,
    transactions: normalizedTransactions,
    journalEntries: normalizedJournalEntries,
    budgets: normalizedBudgets
  };

  const outPath = path.join(__dirname, '../prisma/data/demo-seed-data.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf8');

  console.log('\n✅ Export complete!');
  console.log(`   Output: ${outPath}`);
  console.log(`   Chart accounts: ${normalizedAccounts.length}`);
  console.log(`   Plaid items:    ${normalizedPlaidItems.length}`);
  console.log(`   Plaid accounts: ${normalizedPlaidAccounts.length}`);
  console.log(`   Transactions:   ${normalizedTransactions.length}`);
  console.log(`   Journal entries:${normalizedJournalEntries.length}`);
  console.log(`   Budgets:        ${normalizedBudgets.length}`);
  console.log(`   Date span:      ${output._meta.date_range.span_days} days`);
}

main()
  .catch(err => {
    console.error('Export failed:', err);
    process.exit(1);
  })
  .finally(() => disconnectDatabase());
