const swaggerUi = require('swagger-ui-express');
const { buildOpenApiSpec } = require('../docs/swagger/spec');
const { env } = require('./env');

function mountSwagger(app) {
  const spec = buildOpenApiSpec();

  app.use(
    '/api/docs',
    ...swaggerUi.serveFiles(spec),
    swaggerUi.setup(spec, {
      customSiteTitle: 'FirstSavvy API Docs',
      swaggerOptions: {
        persistAuthorization: true,
        docExpansion: 'none',
        filter: true,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha'
      }
    })
  );

  if (!env.isProduction) {
    const { buildAdminOpenApiSpec } = require('../docs/swagger/admin-spec');
    const adminSpec = buildAdminOpenApiSpec();
    const adminSwaggerOptions = {
      persistAuthorization: true,
      docExpansion: 'none',
      filter: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
      withCredentials: true
    };

    app.use(
      '/api-docs/admin',
      ...swaggerUi.serveFiles(adminSpec, { swaggerOptions: adminSwaggerOptions }),
      swaggerUi.setup(adminSpec, {
        customSiteTitle: 'FirstSavvy Admin API Docs',
        swaggerOptions: adminSwaggerOptions
      })
    );
  }
}

module.exports = { mountSwagger };
