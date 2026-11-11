const { connectDatabase, disconnectDatabase } = require('../config/database');
const { env } = require('../config/env');
const { runScheduledCreditPulls } = require('../services/credit.service');

async function run() {
  if (!env.creditAutoPullEnabled) {
    console.log(JSON.stringify({
      worker: 'credit-scheduler',
      skipped: true,
      reason: 'CREDIT_AUTO_PULL_ENABLED is false'
    }));
    return;
  }

  await connectDatabase();
  try {
    const result = await runScheduledCreditPulls();
    console.log(JSON.stringify({ worker: 'credit-scheduler', ...result }));
  } finally {
    await disconnectDatabase();
  }
}

run().catch((error) => {
  console.error('Credit scheduler failed', error);
  process.exitCode = 1;
});
