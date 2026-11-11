require('dotenv').config();

const { prisma, disconnectDatabase } = require('../config/database');
const { chartOfAccountsTemplates } = require('./data/chartOfAccountsTemplates');

async function seedChartOfAccountsTemplates(prisma) {
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

  // Remove obsolete/business templates not present in the curated Personal Finance Master Catalog
  const validAccountNumbers = chartOfAccountsTemplates.map((t) => t.account_number);
  const deleteResult = await prisma.chartOfAccountsTemplate.deleteMany({
    where: {
      account_number: { notIn: validAccountNumbers }
    }
  });

  if (deleteResult.count > 0) {
    console.log(`Cleaned up ${deleteResult.count} obsolete template accounts.`);
  }

  const total = await prisma.chartOfAccountsTemplate.count();
  return { total, defined: chartOfAccountsTemplates.length };
}

async function seedFinancialInstitutions(prisma) {
  const institutions = [
    { name: 'Manual / Other', provider: 'manual', is_active: true },
    { name: 'Chase', provider: 'plaid', is_active: true },
    { name: 'Bank of America', provider: 'plaid', is_active: true },
    { name: 'Wells Fargo', provider: 'plaid', is_active: true }
  ];

  for (const institution of institutions) {
    const existing = await prisma.financialInstitution.findFirst({
      where: { name: institution.name }
    });

    if (!existing) {
      await prisma.financialInstitution.create({ data: institution });
    }
  }

  return prisma.financialInstitution.count();
}

async function cleanAutoSeededAccounts(prisma) {
  // Remove pre-seeded template accounts that are unused (no transactions, no journal entries)
  // so the user's account register starts clean and accounts are added strictly on-demand.
  const deleted = await prisma.userChartOfAccount.deleteMany({
    where: {
      is_user_created: false,
      template_account_number: { not: null },
      current_balance: 0,
      journal_entry_lines: { none: {} },
      category_transactions: { none: {} },
      bank_transactions: { none: {} },
      budgets: { none: {} }
    }
  });

  return deleted.count;
}

async function main() {
  try {
    console.log('Seeding personal finance chart of accounts templates...');
    const templateResult = await seedChartOfAccountsTemplates(prisma);
    console.log(`Chart of accounts templates ready: ${templateResult.total} rows (${templateResult.defined} defined).`);

    console.log('Seeding financial institutions...');
    const institutionCount = await seedFinancialInstitutions(prisma);
    console.log(`Financial institutions ready: ${institutionCount} rows.`);

    console.log('Cleaning up unused auto-seeded accounts for clean slate...');
    const cleanedCount = await cleanAutoSeededAccounts(prisma);
    console.log(`Cleaned up ${cleanedCount} auto-seeded accounts from user registers.`);

    console.log('Database seed completed.');
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error('Database seed failed:', error);
  process.exit(1);
});
