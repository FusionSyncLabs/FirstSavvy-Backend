const { createApp } = require('./app');
const { connectDatabase, disconnectDatabase } = require('./config/database');
const { env } = require('./config/env');

const app = createApp();

let server;

async function startServer() {
  try {
    await connectDatabase();

    server = app.listen(env.port, '0.0.0.0', () => {
      console.log(`FirstSavvy API listening on http://localhost:${env.port}`);
      console.log(`Swagger Docs available on http://localhost:${env.port}/api/docs`);
    });
  } catch (error) {
    console.error('Failed to start FirstSavvy API:', error);
    process.exit(1);
  }
};

// Graceful shutdown
async function shutdown(signal) {
  console.log(`${signal} received. Closing FirstSavvy Server...`);

  if (server) {
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  } else {
    await disconnectDatabase();
    process.exit(0);
  }
};

process.on('SIGINT', shutdown);   // Usually triggered by `Ctrl+C` in the terminal.
process.on('SIGTERM', shutdown);  // Usually triggered by the system (e.g., Docker stop)

startServer();
