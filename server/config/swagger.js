const swaggerUi = require('swagger-ui-express');
const { buildOpenApiSpec } = require('../docs/swagger/spec');

function mountSwagger(app) {
  const spec = buildOpenApiSpec();

  app.use(
    '/api/docs',
    swaggerUi.serve,
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
}

module.exports = { mountSwagger };
