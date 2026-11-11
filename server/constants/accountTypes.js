const ACCOUNT_TYPE_GROUPS = [
  {
    category: 'ASSET',
    class: 'asset',
    barColor: 'bg-[#10b981]',
    types: [
      {
        value: 'bank_account',
        label: 'Bank Account',
        class: 'asset',
        backendType: 'bank',
        detailTypes: [
          { value: 'checking', label: 'Checking' },
          { value: 'savings', label: 'Savings' },
          { value: 'money_market', label: 'Money Market' },
          { value: 'certificate_of_deposit', label: 'Certificate of Deposit (CD)' },
          { value: 'other_bank_account', label: 'Other Bank Account' }
        ]
      },
      {
        value: 'cash',
        label: 'Cash',
        class: 'asset',
        backendType: 'bank',
        detailTypes: [
          { value: 'cash_on_hand', label: 'Cash on Hand' },
          { value: 'petty_cash', label: 'Petty Cash' },
          { value: 'cash_equivalents', label: 'Cash Equivalents' }
        ]
      },
      {
        value: 'fixed_asset',
        label: 'Fixed Asset',
        class: 'asset',
        backendType: 'fixed_asset',
        detailTypes: [
          { value: 'real_estate', label: 'Real Estate / Primary Residence' },
          { value: 'vehicle', label: 'Vehicle / Automobile' },
          { value: 'machinery_equipment', label: 'Machinery & Equipment' },
          { value: 'furniture_fixtures', label: 'Furniture & Fixtures' },
          { value: 'land', label: 'Land' },
          { value: 'other_fixed_asset', label: 'Other Fixed Asset' }
        ]
      },
      {
        value: 'investment_account',
        label: 'Investment Account',
        class: 'asset',
        backendType: 'investment',
        detailTypes: [
          { value: '401k', label: '401(k)' },
          { value: 'roth_401k', label: 'Roth 401(k)' },
          { value: 'traditional_ira', label: 'Traditional IRA' },
          { value: 'roth_ira', label: 'Roth IRA' },
          { value: 'brokerage', label: 'Brokerage / Taxable' },
          { value: 'crypto', label: 'Cryptocurrency' },
          { value: 'hsa', label: 'Health Savings Account (HSA)' },
          { value: '529_plan', label: '529 College Savings' },
          { value: 'rrsp', label: 'RRSP (Canada)' },
          { value: 'tfsa', label: 'TFSA (Canada)' },
          { value: 'other_investment', label: 'Other Investment' }
        ]
      }
    ]
  },
  {
    category: 'LIABILITY',
    class: 'liability',
    barColor: 'bg-[#ef4444]',
    types: [
      {
        value: 'credit_card',
        label: 'Credit Card',
        class: 'liability',
        backendType: 'credit_card',
        detailTypes: [
          { value: 'credit_card', label: 'Credit Card' },
          { value: 'line_of_credit', label: 'Line of Credit' },
          { value: 'store_credit_card', label: 'Store Credit Card' }
        ]
      },
      {
        value: 'long_term_liability',
        label: 'Long-Term Liability',
        class: 'liability',
        backendType: 'long_term_liability',
        detailTypes: [
          { value: 'mortgage', label: 'Mortgage' },
          { value: 'auto_loan', label: 'Auto / Vehicle Loan' },
          { value: 'student_loan', label: 'Student Loan' },
          { value: 'personal_loan', label: 'Personal Loan' },
          { value: 'home_equity_loan', label: 'Home Equity Loan (HELOC)' },
          { value: 'other_long_term_liability', label: 'Other Long-Term Liability' }
        ]
      }
    ]
  },
  {
    category: 'INCOME',
    class: 'income',
    barColor: 'bg-[#3b82f6]',
    types: [
      {
        value: 'personal_income',
        label: 'Personal Income',
        class: 'income',
        backendType: 'income',
        detailTypes: [
          { value: 'salary_wages', label: 'Salary & Wages' },
          { value: 'bonus_commission', label: 'Bonus & Commission' },
          { value: 'investment_income', label: 'Investment Dividends / Interest' },
          { value: 'rental_income', label: 'Rental Income' },
          { value: 'business_income', label: 'Business / Side Income' },
          { value: 'other_income', label: 'Other Income' }
        ]
      }
    ]
  },
  {
    category: 'EXPENSE',
    class: 'expense',
    barColor: 'bg-[#f59e0b]',
    types: [
      {
        value: 'expense',
        label: 'Expense',
        class: 'expense',
        backendType: 'expense',
        detailTypes: [
          { value: 'housing', label: 'Housing & Rent' },
          { value: 'utilities', label: 'Utilities & Bills' },
          { value: 'food_dining', label: 'Food & Groceries' },
          { value: 'transportation', label: 'Transportation & Gas' },
          { value: 'healthcare', label: 'Healthcare & Medical' },
          { value: 'insurance', label: 'Insurance' },
          { value: 'entertainment', label: 'Entertainment & Leisure' },
          { value: 'personal_care', label: 'Personal Care & Shopping' },
          { value: 'education', label: 'Education' },
          { value: 'general_expense', label: 'General / Miscellaneous' }
        ]
      }
    ]
  }
];

const TEMPLATE_TYPE_CONFIG_MAP = {
  1000: { accountType: 'cash', detailType: 'cash_on_hand' },
  1100: { accountType: 'bank_account', detailType: 'checking' },
  1150: { accountType: 'bank_account', detailType: 'savings' },
  1200: { accountType: 'investment_account', detailType: 'brokerage' },
  1250: { accountType: 'investment_account', detailType: '401k' },
  1260: { accountType: 'investment_account', detailType: 'hsa' },
  1270: { accountType: 'investment_account', detailType: 'crypto' },
  1400: { accountType: 'fixed_asset', detailType: 'real_estate' },
  1500: { accountType: 'fixed_asset', detailType: 'vehicle' },
  2000: { accountType: 'credit_card', detailType: 'credit_card' },
  2100: { accountType: 'long_term_liability', detailType: 'mortgage' },
  2200: { accountType: 'long_term_liability', detailType: 'personal_loan' },
  2250: { accountType: 'long_term_liability', detailType: 'auto_loan' },
  3000: { accountType: 'bank_account', detailType: 'checking' },
  3100: { accountType: 'bank_account', detailType: 'checking' },
  7900: { accountType: 'personal_income', detailType: 'salary_wages' },
  7910: { accountType: 'personal_income', detailType: 'business_income' },
  7920: { accountType: 'personal_income', detailType: 'rental_income' },
  7930: { accountType: 'personal_income', detailType: 'investment_income' },
  7940: { accountType: 'personal_income', detailType: 'investment_income' },
  7950: { accountType: 'personal_income', detailType: 'other_income' },
  7960: { accountType: 'personal_income', detailType: 'other_income' },
  7970: { accountType: 'personal_income', detailType: 'other_income' },
  7999: { accountType: 'personal_income', detailType: 'other_income' },
  9900: { accountType: 'expense', detailType: 'housing' },
  9910: { accountType: 'expense', detailType: 'food_dining' },
  9920: { accountType: 'expense', detailType: 'transportation' },
  9930: { accountType: 'expense', detailType: 'healthcare' },
  9940: { accountType: 'expense', detailType: 'personal_care' },
  9950: { accountType: 'expense', detailType: 'entertainment' },
  9960: { accountType: 'expense', detailType: 'general_expense' },
  9970: { accountType: 'expense', detailType: 'general_expense' },
  9999: { accountType: 'expense', detailType: 'general_expense' },
  8999: { accountType: 'expense', detailType: 'general_expense' }
};

module.exports = {
  ACCOUNT_TYPE_GROUPS,
  TEMPLATE_TYPE_CONFIG_MAP
};
