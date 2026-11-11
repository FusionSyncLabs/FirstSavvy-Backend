const { prisma } = require('../config/database');

async function listRecurringPaymentsForProfile(profileId) {
  const transactions = await prisma.transaction.findMany({
    where: {
      profile_id: profileId,
      status: 'posted',
      deleted_at: null,
      transaction_type: { in: ['expense', 'income'] }
    },
    include: {
      bank_account: true,
      category_account: true,
      contact: true
    },
    orderBy: [{ date: 'desc' }, { created_at: 'desc' }],
    take: 10000
  });

  const groups = new Map();
  transactions.forEach((transaction) => {
    const key = [
      normalizeDescription(transaction.description),
      transaction.transaction_type,
      transaction.category_account_id || 'uncategorized',
      transaction.contact_id || 'no-contact'
    ].join('|');

    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(transaction);
  });

  const recurringPayments = Array.from(groups.values())
    .filter((group) => group.length >= 2)
    .map(buildRecurringPayment)
    .filter(Boolean)
    .sort((a, b) => {
      if (a.nextExpectedDate && b.nextExpectedDate) {
        return a.nextExpectedDate.localeCompare(b.nextExpectedDate);
      }
      return b.confidence - a.confidence;
    });

  return { recurringPayments };
}

function buildRecurringPayment(group) {
  const sorted = [...group].sort((a, b) => new Date(a.date) - new Date(b.date));
  const intervals = [];

  for (let index = 1; index < sorted.length; index += 1) {
    intervals.push(daysBetween(sorted[index - 1].date, sorted[index].date));
  }

  const averageInterval = intervals.reduce((sum, days) => sum + days, 0) / intervals.length;
  const frequency = classifyFrequency(averageInterval);
  if (!frequency) return null;

  const latest = sorted[sorted.length - 1];
  const amounts = sorted.map((transaction) => Math.abs(Number(transaction.amount || 0)));
  const averageAmount = amounts.reduce((sum, amount) => sum + amount, 0) / amounts.length;
  const intervalVariance = intervals.reduce((sum, days) => sum + Math.abs(days - averageInterval), 0) / intervals.length;
  const amountVariance = amounts.reduce((sum, amount) => sum + Math.abs(amount - averageAmount), 0) / amounts.length;
  const confidence = Math.max(25, Math.min(99, 100 - (intervalVariance * 2) - ((amountVariance / Math.max(averageAmount, 1)) * 50)));

  return {
    id: `${latest.id}-${frequency}`,
    name: latest.contact?.name || latest.description,
    description: latest.description,
    type: latest.transaction_type,
    frequency,
    averageAmount,
    lastAmount: Math.abs(Number(latest.amount || 0)),
    lastDate: toDateString(latest.date),
    nextExpectedDate: addDays(latest.date, Math.round(averageInterval)),
    transactionCount: sorted.length,
    confidence: Math.round(confidence),
    bankAccount: latest.bank_account ? pickAccountSummary(latest.bank_account) : null,
    categoryAccount: latest.category_account ? pickAccountSummary(latest.category_account) : null,
    contact: latest.contact ? {
      id: latest.contact.id,
      name: latest.contact.name
    } : null
  };
}

function classifyFrequency(days) {
  if (days >= 5 && days <= 9) return 'weekly';
  if (days >= 12 && days <= 18) return 'biweekly';
  if (days >= 25 && days <= 35) return 'monthly';
  if (days >= 80 && days <= 100) return 'quarterly';
  if (days >= 350 && days <= 380) return 'yearly';
  return null;
}

function normalizeDescription(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[0-9]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function daysBetween(left, right) {
  const diff = new Date(right).getTime() - new Date(left).getTime();
  return Math.round(diff / (1000 * 60 * 60 * 24));
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return toDateString(next);
}

function toDateString(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function pickAccountSummary(account) {
  return {
    id: account.id,
    display_name: account.display_name,
    account_name: account.account_name,
    class: account.class,
    account_type: account.account_type,
    account_detail: account.account_detail,
    color: account.color,
    icon: account.icon
  };
}

module.exports = {
  listRecurringPaymentsForProfile
};
