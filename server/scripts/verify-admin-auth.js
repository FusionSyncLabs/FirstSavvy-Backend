const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { signJwt, verifyJwt } = require('../utils/tokens');

const root = path.resolve(__dirname, '..');
const secret = 'verify-admin-token-secret';
const subject = '550e8400-e29b-41d4-a716-446655440000';
const adminToken = signJwt({ sub: subject, type: 'admin_access', tokenVersion: 0 }, secret, 60);
const userToken = signJwt({ sub: subject, type: 'access' }, secret, 60);

assert.strictEqual(verifyJwt(adminToken, secret, 'admin_access').sub, subject);
assert.throws(() => verifyJwt(adminToken, secret, 'access'), 'user auth must reject admin access tokens');
assert.throws(() => verifyJwt(userToken, secret, 'admin_access'), 'admin auth must reject user access tokens');

const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
const migration = fs.readFileSync(
  path.join(root, 'prisma', 'migrations', '20261110180000_create_admins_table', 'migration.sql'),
  'utf8'
);
assert(schema.includes('@@unique([role], where: raw("role = \'SUPER_ADMIN\'")'), 'schema must represent the single-Super-Admin constraint');
assert(migration.includes('WHERE "role" = \'SUPER_ADMIN\''), 'migration must enforce one Super Admin in PostgreSQL');
assert(migration.includes('"permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]'), 'permissions must default to an empty array');

const adminService = fs.readFileSync(path.join(root, 'services', 'admin.service.js'), 'utf8');
const adminMiddleware = fs.readFileSync(path.join(root, 'middleware', 'authenticateAdmin.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(root, 'routes', 'v1', 'admin.routes.js'), 'utf8');
assert(adminService.includes("role: 'SUPER_ADMIN'"), 'bootstrap must set Super Admin role server-side');
assert(adminService.includes("role: 'SUB_ADMIN'"), 'Sub Admin creation must set its role server-side');
assert(adminService.includes('permissions: []'), 'admin permissions must default to empty');
assert(adminService.includes('created_by_id: creatorAdminId'), 'Sub Admin creator must come from the authenticated admin');
assert(adminService.includes('refresh_token_version: { increment: 1 }'), 'admin refresh and logout must revoke old sessions');
assert(adminMiddleware.includes('payload.tokenVersion !== admin.refresh_token_version'), 'admin middleware must enforce session revocation');
assert(adminRoutes.includes("requireAdminRole('SUPER_ADMIN')"), 'Sub Admin creation must require Super Admin role');

const adminSpec = require('../docs/swagger/admin-spec').buildAdminOpenApiSpec();
const documentedPaths = Object.keys(adminSpec.paths).sort();
assert.deepStrictEqual(documentedPaths, [
  '/api/v1/admin/login',
  '/api/v1/admin/logout',
  '/api/v1/admin/me',
  '/api/v1/admin/refresh',
  '/api/v1/admin/setup-super-admin',
  '/api/v1/admin/sub-admins'
]);
assert.strictEqual(adminSpec.paths['/api/v1/admin/sub-admins'].post.responses[403].description,
  'A Sub Admin cannot create admins.');

console.log('OK  admin token separation, database constraints, role guards, and isolated API docs verified');
