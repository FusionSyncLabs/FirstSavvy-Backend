const { prisma } = require('../config/database');
const {
  findTransferMatchesForProfile,
  pairTransfersForProfile,
  matchAndPostTransfersForProfile,
  unmatchTransferForProfile,
  autoMatchTransfersForProfile,
  determineTransferClassification
} = require('../services/transferMatching.service');
const { undoPostedTransactionForProfile } = require('../services/transaction.service');

async function runTests() {
  console.log('--- Starting Transfer Matching Acceptance Tests ---');

  // 1. Get or create a test profile
  const profile = await prisma.profile.findFirst({
    where: { deleted_at: null },
    orderBy: { created_at: 'asc' }
  });

  if (!profile) {
    console.error('No profile found to run test');
    process.exit(1);
  }

  const profileId = profile.id;
  console.log(`Using Profile: ${profile.name} (${profileId})`);

  // 2. Setup test accounts: Chase Checking (Asset), Chase Savings (Asset), Chase Credit Card (Liability)
  let checking = await prisma.userChartOfAccount.findFirst({
    where: { profile_id: profileId, display_name: 'Test Chase Checking', deleted_at: null }
  });
  if (!checking) {
    checking = await prisma.userChartOfAccount.create({
      data: {
        profile_id: profileId,
        account_name: 'Test Chase Checking',
        display_name: 'Test Chase Checking',
        account_number: 1110,
        class: 'asset',
        account_type: 'bank_account',
        account_detail: 'checking_account',
        current_balance: 5000,
        is_active: true,
        is_user_created: true
      }
    });
  }

  let savings = await prisma.userChartOfAccount.findFirst({
    where: { profile_id: profileId, display_name: 'Test Chase Savings', deleted_at: null }
  });
  if (!savings) {
    savings = await prisma.userChartOfAccount.create({
      data: {
        profile_id: profileId,
        account_name: 'Test Chase Savings',
        display_name: 'Test Chase Savings',
        account_number: 1120,
        class: 'asset',
        account_type: 'bank_account',
        account_detail: 'savings_account',
        current_balance: 10000,
        is_active: true,
        is_user_created: true
      }
    });
  }

  let creditCard = await prisma.userChartOfAccount.findFirst({
    where: { profile_id: profileId, display_name: 'Test Chase Credit Card', deleted_at: null }
  });
  if (!creditCard) {
    creditCard = await prisma.userChartOfAccount.create({
      data: {
        profile_id: profileId,
        account_name: 'Test Chase Credit Card',
        display_name: 'Test Chase Credit Card',
        account_number: 2010,
        class: 'liability',
        account_type: 'credit_card',
        account_detail: 'credit_card',
        current_balance: 1500,
        is_active: true,
        is_user_created: true
      }
    });
  }

  console.log('Test Accounts initialized:');
  console.log(`- Checking: ${checking.id}`);
  console.log(`- Savings: ${savings.id}`);
  console.log(`- Credit Card: ${creditCard.id}`);

  // Clean up any previous test transactions
  await prisma.transaction.deleteMany({
    where: {
      profile_id: profileId,
      description: { startsWith: '[TEST]' }
    }
  });

  // TEST 1: Bank Transfer (Savings -> Checking: -$1,000 & +$1,000)
  console.log('\n--- TEST 1: Bank Transfer (Bank -> Bank) ---');
  const txSavingsOut = await prisma.transaction.create({
    data: {
      profile_id: profileId,
      bank_account_id: savings.id,
      date: new Date('2026-08-15'),
      description: '[TEST] Transfer to Checking',
      amount: -1000,
      transaction_type: 'expense',
      status: 'pending'
    }
  });

  const txCheckingIn = await prisma.transaction.create({
    data: {
      profile_id: profileId,
      bank_account_id: checking.id,
      date: new Date('2026-08-15'),
      description: '[TEST] Transfer from Savings',
      amount: 1000,
      transaction_type: 'income',
      status: 'pending'
    }
  });

  const matches = await findTransferMatchesForProfile(profileId, txSavingsOut.id);
  console.log(`Found ${matches.length} matches for Savings withdrawal:`);
  console.log(matches[0]);
  if (!matches.length || matches[0].match_transaction_id !== txCheckingIn.id) {
    throw new Error('TEST 1 FAILED: Expected txCheckingIn to be top match');
  }
  if (matches[0].transfer_type !== 'bank_transfer') {
    throw new Error(`TEST 1 FAILED: Expected transfer_type bank_transfer, got ${matches[0].transfer_type}`);
  }
  console.log('✓ TEST 1 Classification & Match detection PASSED');

  // Pair and Post atomically
  const postResult = await matchAndPostTransfersForProfile(profileId, txSavingsOut.id, txCheckingIn.id);
  console.log('Match and Post Result:', postResult);

  const postedSavings = await prisma.transaction.findUnique({ where: { id: txSavingsOut.id } });
  const postedChecking = await prisma.transaction.findUnique({ where: { id: txCheckingIn.id } });
  const journalEntry = await prisma.journalEntry.findUnique({
    where: { id: postResult.journal_entry_id },
    include: { lines: true }
  });

  if (postedSavings.status !== 'posted' || postedChecking.status !== 'posted') {
    throw new Error('TEST 1 FAILED: Both transactions must be posted');
  }
  if (postedSavings.journal_entry_id !== postedChecking.journal_entry_id) {
    throw new Error('TEST 1 FAILED: Both transactions must share the same journal_entry_id');
  }
  if (journalEntry.lines.length !== 2) {
    throw new Error(`TEST 1 FAILED: Expected 2 journal entry lines, got ${journalEntry.lines.length}`);
  }
  console.log('Journal Entry lines:', journalEntry.lines.map(l => ({
    accountId: l.account_id,
    debit: Number(l.debit),
    credit: Number(l.credit)
  })));
  console.log('✓ TEST 1 Atomic Posting & Single Journal Entry PASSED');

  // TEST 2: Undo Posted Match
  console.log('\n--- TEST 2: Undo Posted Match ---');
  await undoPostedTransactionForProfile(profileId, txSavingsOut.id);
  const undoneSavings = await prisma.transaction.findUnique({ where: { id: txSavingsOut.id } });
  const undoneChecking = await prisma.transaction.findUnique({ where: { id: txCheckingIn.id } });
  const voidedJournal = await prisma.journalEntry.findUnique({ where: { id: postResult.journal_entry_id } });

  if (undoneSavings.status !== 'pending' || undoneChecking.status !== 'pending') {
    throw new Error('TEST 2 FAILED: Both transactions must be pending after undo');
  }
  if (undoneSavings.journal_entry_id !== null || undoneChecking.journal_entry_id !== null) {
    throw new Error('TEST 2 FAILED: journal_entry_id must be cleared on both sides');
  }
  if (voidedJournal !== null) {
    throw new Error('TEST 2 FAILED: Journal Entry must be removed from active records');
  }
  const journalAudit = await prisma.auditLog.findFirst({
    where: { profile_id: profileId, entity_type: 'journal_entry', entity_id: postResult.journal_entry_id, action: 'delete_journal_entry' }
  });
  if (!journalAudit) {
    throw new Error('TEST 2 FAILED: Journal entry deletion must be recorded in audit log');
  }
  console.log('✓ TEST 2 Dual-Sided Undo PASSED');

  // TEST 3: Unpair / Unmatch
  console.log('\n--- TEST 3: Unpair / Unmatch ---');
  const unpairResult = await unmatchTransferForProfile(profileId, txSavingsOut.id);
  console.log('Unpair Result:', unpairResult);

  const unpairedSavings = await prisma.transaction.findUnique({ where: { id: txSavingsOut.id } });
  const unpairedChecking = await prisma.transaction.findUnique({ where: { id: txCheckingIn.id } });

  if (unpairedSavings.metadata?.paired_transfer_id || unpairedChecking.metadata?.paired_transfer_id) {
    throw new Error('TEST 3 FAILED: paired_transfer_id must be null after unpair');
  }
  console.log('✓ TEST 3 Unpairing PASSED');

  // TEST 4: Credit Card Payment (Checking -$500 & CC +$500)
  console.log('\n--- TEST 4: Credit Card Payment (Bank -> Credit Card) ---');
  const txCheckingPayment = await prisma.transaction.create({
    data: {
      profile_id: profileId,
      bank_account_id: checking.id,
      date: new Date('2026-08-15'),
      description: '[TEST] Chase AutoPay Payment',
      amount: -500,
      transaction_type: 'expense',
      status: 'pending'
    }
  });

  const txCreditCardPayment = await prisma.transaction.create({
    data: {
      profile_id: profileId,
      bank_account_id: creditCard.id,
      date: new Date('2026-08-15'),
      description: '[TEST] Payment Thank You - Web',
      amount: 500,
      transaction_type: 'income',
      status: 'pending'
    }
  });

  const ccMatches = await findTransferMatchesForProfile(profileId, txCheckingPayment.id);
  console.log(`Found ${ccMatches.length} CC matches:`, ccMatches[0]);
  if (ccMatches[0].transfer_type !== 'credit_card_payment') {
    throw new Error(`TEST 4 FAILED: Expected credit_card_payment, got ${ccMatches[0].transfer_type}`);
  }

  const ccPostResult = await matchAndPostTransfersForProfile(profileId, txCheckingPayment.id, txCreditCardPayment.id);
  const ccJournal = await prisma.journalEntry.findUnique({
    where: { id: ccPostResult.journal_entry_id },
    include: { lines: true }
  });
  console.log('Credit Card Payment Journal Lines:', ccJournal.lines.map(l => ({
    account_id: l.account_id,
    debit: Number(l.debit),
    credit: Number(l.credit)
  })));

  // Checking line (Asset decrease -> Credit 500)
  const checkingLine = ccJournal.lines.find(l => l.account_id === checking.id);
  // CC line (Liability decrease -> Debit 500)
  const ccLine = ccJournal.lines.find(l => l.account_id === creditCard.id);

  if (!checkingLine || Number(checkingLine.credit) !== 500 || Number(checkingLine.debit) !== 0) {
    throw new Error('TEST 4 FAILED: Checking account line must have Credit: 500');
  }
  if (!ccLine || Number(ccLine.debit) !== 500 || Number(ccLine.credit) !== 0) {
    throw new Error('TEST 4 FAILED: Credit card liability line must have Debit: 500');
  }
  console.log('✓ TEST 4 Credit Card Payment & Accounting Lines PASSED');

  // TEST 5: Potential Matches Ranking
  console.log('\n--- TEST 5: Multiple Candidates Ranking ---');
  const txMain = await prisma.transaction.create({
    data: {
      profile_id: profileId,
      bank_account_id: checking.id,
      date: new Date('2026-08-15'),
      description: '[TEST] Transfer Out $250',
      amount: -250,
      transaction_type: 'expense',
      status: 'pending'
    }
  });

  const txCand1 = await prisma.transaction.create({
    data: {
      profile_id: profileId,
      bank_account_id: savings.id,
      date: new Date('2026-08-15'), // Same date
      description: '[TEST] Transfer In $250',
      amount: 250,
      transaction_type: 'income',
      status: 'pending'
    }
  });

  const txCand2 = await prisma.transaction.create({
    data: {
      profile_id: profileId,
      bank_account_id: savings.id,
      date: new Date('2026-08-18'), // 3 days later
      description: '[TEST] Deposit $250',
      amount: 250,
      transaction_type: 'income',
      status: 'pending'
    }
  });

  const multiMatches = await findTransferMatchesForProfile(profileId, txMain.id);
  console.log('Ranked Candidates:');
  multiMatches.forEach((m, idx) => {
    console.log(`Rank ${idx + 1}: ID ${m.match_transaction_id}, Date: ${m.match_date}, Score: ${m.confidence_score}%, Reasons: ${m.match_reasons.join(', ')}`);
  });

  if (multiMatches[0].match_transaction_id !== txCand1.id) {
    throw new Error('TEST 5 FAILED: Same-date candidate must be ranked #1');
  }
  if (multiMatches[0].confidence_score <= multiMatches[1].confidence_score) {
    throw new Error('TEST 5 FAILED: Same-date candidate must have higher confidence than 3-day later candidate');
  }
  console.log('✓ TEST 5 Ranking & Multiple Candidates PASSED');

  // Clean up test transactions
  await prisma.transaction.deleteMany({
    where: {
      profile_id: profileId,
      description: { startsWith: '[TEST]' }
    }
  });

  console.log('\n=============================================');
  console.log('ALL TRANSFER MATCHING ACCEPTANCE TESTS PASSED!');
  console.log('=============================================');
}

runTests()
  .catch(err => {
    console.error('Test Execution Error:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
