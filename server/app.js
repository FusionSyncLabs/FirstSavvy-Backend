const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const { notFound } = require('./middleware/notFound');
const { requestContext } = require('./middleware/requestContext');
const { adminBodyParsers, adminBodyParserErrorHandler } = require('./middleware/admin/adminBodyParser');
const { env } = require('./config/env');
const { mountSwagger } = require('./config/swagger');

function createApp() {
  const app = express();

  /*
    By default Express sends: X-Powered-By: Express
    This exposes your backend framework. Disabling it is a minor security hardening step.
  */
  app.disable('x-powered-by');

  if (env.trustProxy) {
    app.set('trust proxy', 1);
  }

  app.use(requestContext);

  if (!env.isProduction) {
    const { devRequestLog } = require('./middleware/devRequestLog');
    app.use(devRequestLog);
  }

  app.use(cors({
    origin: env.corsOrigin,
    credentials: true,
    exposedHeaders: ['X-Access-Token', 'X-Token-Type', 'X-Token-Expires-In']
  }));

  app.use('/api/v1/admin', helmet({
    frameguard: { action: 'deny' }
  }));
  app.use(
    '/api/v1/admin',
    ...adminBodyParsers,
    adminBodyParserErrorHandler
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Rate limiting disabled / commented out because it was creating issue while fetching the data when swithcing the profiles
  // const { globalRateLimiter } = require('./middleware/rateLimit');
  // app.use(globalRateLimiter);

  mountSwagger(app);

  app.use(routes);
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
