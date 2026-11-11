const fs = require('fs');
const path = require('path');
const { buildOpenApiSpec } = require('../docs/swagger/spec');

const outputPath = path.join(__dirname, '..', 'docs', 'swagger', 'openapi.json');
const spec = buildOpenApiSpec({ includeDev: true });

fs.writeFileSync(outputPath, `${JSON.stringify(spec, null, 2)}\n`, 'utf8');

const pathCount = Object.keys(spec.paths).length;
const operationCount = Object.values(spec.paths).reduce(
  (total, methods) => total + Object.keys(methods).length,
  0
);

console.log(`OpenAPI spec exported to ${outputPath}`);
console.log(`Paths: ${pathCount}, Operations: ${operationCount}`);
