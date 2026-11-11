const CASH_BALANCE_ACCOUNT_DETAILS = new Set([
  'Cash on Hand',
  'Checking',
  'Savings',
  'checking_account',
  'savings_account',
  'high_yield_savings',
  'money_market',
  'cash_on_hand',
  'physical_cash',
  'emergency_cash',
  'petty_cash',
  'digital_wallet_cash'
]);

function shouldIncludeInCashBalance(template) {
  if (!template) return false;

  if (template.account_type === 'Cash' || template.account_type === 'Bank Account') {
    return true;
  }

  return CASH_BALANCE_ACCOUNT_DETAILS.has(template.account_detail);
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function buildDefaultDisplayName({ fullName, email }) {
  if (fullName?.trim()) {
    return fullName.trim();
  }

  if (email?.includes('@')) {
    return email.split('@')[0];
  }

  return 'My Profile';
}

module.exports = {
  shouldIncludeInCashBalance,
  normalizeEmail,
  buildDefaultDisplayName
};
