const { connectDatabase, disconnectDatabase } = require('../config/database');
const { runCalendarScheduler } = require('../services/calendar.service');

async function run() {
  await connectDatabase();
  try {
    const result = await runCalendarScheduler();
    console.log(JSON.stringify({ worker: 'calendar-scheduler', ...result }));
  } finally {
    await disconnectDatabase();
  }
}

run().catch((error) => {
  console.error('Calendar scheduler failed', error);
  process.exitCode = 1;
});
