const fs = require('fs');
const path = require('path');
const { buildOpenApiSpec } = require('../docs/swagger/spec');
const { buildAdminOpenApiSpec } = require('../docs/swagger/admin-spec');
const { env } = require('../config/env');

const routesRoot = path.join(__dirname, '..', 'routes');

function normalizePath(routePath) {
  return routePath.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function expressPathToOpenApi(routePath) {
  return normalizePath(
    routePath
      .replace(/:(\w+)/g, '{$1}')
      .replace(/\/\^\(\\\/public\\\/\(\.\+\)\$\//, '/public/{filePath}')
  );
}

function parseRouteMounts() {
  const v1IndexPath = path.join(routesRoot, 'v1', 'index.js');
  const source = fs.readFileSync(v1IndexPath, 'utf8');
  const mounts = [{ base: '', prefix: '', file: path.join(routesRoot, 'index.js') }];

  const usePattern = /router\.use\((['"])(.*?)\1,\s*(\w+)Routes\)/g;
  const requirePattern = /const\s+(\w+)Routes\s+=\s+require\((['"])\.\/(.*?)\2\)/g;

  const requireMap = {};
  let match;

  while ((match = requirePattern.exec(source)) !== null) {
    requireMap[match[1]] = match[3];
  }

  while ((match = usePattern.exec(source)) !== null) {
    const [, , prefix, routeVar] = match;
    const routeFile = requireMap[routeVar];

    if (!routeFile) {
      throw new Error(`Could not resolve route module for ${routeVar}`);
    }

    mounts.push({
      base: '/api/v1',
      prefix,
      file: path.join(routesRoot, 'v1', `${routeFile}.js`)
    });
  }

  if (!env.isProduction) {
    mounts.push({
      base: '/api/v1',
      prefix: '/dev',
      file: path.join(routesRoot, 'v1', 'dev.routes.js')
    });
  }

  return mounts;
}

function parseRouteFile(filePath, base, prefix) {
  const source = fs.readFileSync(filePath, 'utf8');
  const routes = [];
  const quotedRoutePattern = /router\.(get|post|put|patch|delete)\(\s*(['"`])(.*?)\2/g;
  const regexRoutePattern = /router\.(get|post|put|patch|delete)\(\/\^\\\/public\\\/\(\.\+\)\$\//g;
  const nestedRequirePattern = /const\s+(\w+)\s*=\s*require\((['"])(\.[^'"]+\.routes(?:\.js)?)\2\)/g;
  const nestedMountPattern = /router\.use\(\s*(['"])(.*?)\1,\s*(\w+)\s*\)/g;
  const nestedRouteFiles = {};

  let match;
  while ((match = quotedRoutePattern.exec(source)) !== null) {
    const [, method, , routePath] = match;

    routes.push({
      method: method.toUpperCase(),
      path: expressPathToOpenApi(normalizePath(`${base}${prefix}${routePath}`))
    });
  }

  while ((match = regexRoutePattern.exec(source)) !== null) {
    const [, method] = match;

    routes.push({
      method: method.toUpperCase(),
      path: expressPathToOpenApi(normalizePath(`${base}${prefix}/public/{filePath}`))
    });
  }

  while ((match = nestedRequirePattern.exec(source)) !== null) {
    nestedRouteFiles[match[1]] = match[3];
  }

  while ((match = nestedMountPattern.exec(source)) !== null) {
    const [, , routePrefix, routeVariable] = match;
    const routeModule = nestedRouteFiles[routeVariable];
    if (!routeModule) {
      continue;
    }

    const nestedFileCandidates = [
      path.resolve(
        path.dirname(filePath),
        routeModule.endsWith('.js') ? routeModule : `${routeModule}.js`
      ),
      path.resolve(path.dirname(filePath), routeModule, 'index.js')
    ];
    const nestedFile = nestedFileCandidates.find((candidate) => fs.existsSync(candidate));
    if (!nestedFile) {
      throw new Error(`Could not resolve nested route module ${routeModule} from ${filePath}`);
    }

    routes.push(...parseRouteFile(
      nestedFile,
      base,
      normalizePath(`${prefix}${routePrefix}`)
    ));
  }

  return routes;
}

function collectExpressRoutes() {
  const mounts = parseRouteMounts();
  const routes = [];
  const seen = new Set();

  for (const mount of mounts) {
    for (const route of parseRouteFile(mount.file, mount.base, mount.prefix)) {
      const key = operationKey(route);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      routes.push(route);
    }
  }

  return routes;
}

function collectSwaggerOperations(spec) {
  const operations = [];

  for (const [routePath, methods] of Object.entries(spec.paths)) {
    for (const method of Object.keys(methods)) {
      operations.push({
        method: method.toUpperCase(),
        path: normalizePath(routePath)
      });
    }
  }

  return operations;
}

function operationKey({ method, path: routePath }) {
  return `${method} ${routePath}`;
}

function diffOperations(label, expected, actual) {
  const expectedKeys = new Set(expected.map(operationKey));
  const actualKeys = new Set(actual.map(operationKey));

  const missing = [...expectedKeys].filter((key) => !actualKeys.has(key)).sort();
  const extra = [...actualKeys].filter((key) => !expectedKeys.has(key)).sort();

  if (missing.length === 0 && extra.length === 0) {
    console.log(`OK  ${label}: ${expected.length} operations in sync`);
    return true;
  }

  console.error(`FAIL ${label}`);

  if (missing.length > 0) {
    console.error(`  Missing from swagger (${missing.length}):`);
    missing.forEach((entry) => console.error(`    - ${entry}`));
  }

  if (extra.length > 0) {
    console.error(`  Swagger-only (${extra.length}):`);
    extra.forEach((entry) => console.error(`    - ${entry}`));
  }

  return false;
}

function run() {
  console.log('Verifying swagger route coverage...\n');

  const expressRoutes = collectExpressRoutes();
  const spec = buildOpenApiSpec({ includeDev: !env.isProduction });
  const adminSpec = buildAdminOpenApiSpec();
  const adminExpressRoutes = expressRoutes.filter((route) => route.path.startsWith('/api/v1/admin/'));
  const customerExpressRoutes = expressRoutes.filter((route) => !route.path.startsWith('/api/v1/admin/'));
  const swaggerRoutes = collectSwaggerOperations(spec);
  const adminSwaggerRoutes = collectSwaggerOperations(adminSpec);

  const customerExpressKeys = new Set(customerExpressRoutes.map(operationKey));
  const invalidCustomerDocs = swaggerRoutes.filter(
    (route) => !customerExpressKeys.has(operationKey(route))
  );
  const apiOk = invalidCustomerDocs.length === 0;
  if (apiOk) {
    console.log(`OK  Customer Swagger operations map to Express routes: ${swaggerRoutes.length} operations`);
  } else {
    console.error(`FAIL Customer Swagger contains ${invalidCustomerDocs.length} operations without Express routes`);
    invalidCustomerDocs.forEach((route) => console.error(`    - ${operationKey(route)}`));
  }

  const adminOk = diffOperations('Admin Express routes vs isolated admin swagger spec', adminExpressRoutes, adminSwaggerRoutes);

  const documentedCustomerKeys = new Set(swaggerRoutes.map(operationKey));
  const undocumentedCustomerRoutes = customerExpressRoutes.filter(
    (route) => !documentedCustomerKeys.has(operationKey(route))
  );
  if (undocumentedCustomerRoutes.length > 0) {
    console.warn(`\nWARN ${undocumentedCustomerRoutes.length} existing customer routes are not documented in the unchanged customer Swagger spec.`);
  }

  console.log(`\nCustomer Express routes: ${customerExpressRoutes.length}`);
  console.log(`Customer Swagger operations: ${swaggerRoutes.length}`);
  console.log(`Admin Express routes: ${adminExpressRoutes.length}`);
  console.log(`Admin Swagger operations: ${adminSwaggerRoutes.length}`);

  if (!apiOk || !adminOk) {
    process.exit(1);
  }

  console.log('\nSwagger route verification passed.');
}

run();
