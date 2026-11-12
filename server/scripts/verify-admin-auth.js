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

const adminService = fs.readFileSync(path.join(root, 'services', 'admin', 'admin.service.js'), 'utf8');
const adminMiddleware = fs.readFileSync(path.join(root, 'middleware', 'admin', 'authenticateAdmin.js'), 'utf8');
const adminRoutes = fs.readFileSync(path.join(root, 'routes', 'v1', 'admin', 'admin.routes.js'), 'utf8');
const adminUsersRoutes = fs.readFileSync(path.join(root, 'routes', 'v1', 'admin', 'users.routes.js'), 'utf8');
const adminUsersService = fs.readFileSync(path.join(root, 'services', 'admin', 'users.service.js'), 'utf8');
assert(adminService.includes("role: 'SUPER_ADMIN'"), 'bootstrap must set Super Admin role server-side');
assert(adminService.includes("role: 'SUB_ADMIN'"), 'Sub Admin creation must set its role server-side');
assert(adminService.includes('permissions: []'), 'admin permissions must default to empty');
assert(adminService.includes('created_by_id: creatorAdminId'), 'Sub Admin creator must come from the authenticated admin');
assert(adminService.includes('refresh_token_version: { increment: 1 }'), 'admin refresh and logout must revoke old sessions');
assert(adminMiddleware.includes('payload.tokenVersion !== admin.refresh_token_version'), 'admin middleware must enforce session revocation');
assert(adminRoutes.includes("requireAdminRole('SUPER_ADMIN')"), 'Sub Admin creation must require Super Admin role');
assert(adminRoutes.includes("router.use('/users', usersRoutes)"), 'Admin user routes must be mounted as a separate admin subrouter');
assert(/router\.get\(\s*['"]\/['"]/.test(adminUsersRoutes), 'Admin user listing route must be registered in its own route module');
assert(/router\.get\(\s*['"]\/:userId\/referrals\/:referralId\/users['"]/.test(adminUsersRoutes),
  'Referral user details must be registered in the admin user route module');
assert.strictEqual((adminRoutes.match(/requireAdminRole\('SUPER_ADMIN'\)/g) || []).length, 1,
  'Sub Admin creation must retain its Super Admin role requirement');
assert.strictEqual((adminUsersRoutes.match(/requireAdminRole\('SUPER_ADMIN'\)/g) || []).length, 2,
  'Both admin user endpoints must require Super Admin role');
assert(adminUsersService.includes('unnest('), 'Referral used_by IDs must be expanded for the linked-user query');
assert(adminUsersService.includes('LIMIT ${pagination.limit}') && adminUsersService.includes('OFFSET ${pagination.skip}'),
  'Both admin user queries must use bounded pagination');
assert(adminUsersService.includes('ORDER BY has_referral DESC'),
  'Users with non-deleted referrals must be listed before users without referrals');
assert(adminUsersService.includes('r.deleted_at IS NULL'), 'Deleted referrals must be excluded');
assert(adminUsersService.includes('u.deleted_at IS NULL'), 'Deleted users must be excluded');
assert(adminUsersService.includes('used_by_count'), 'Referral summaries must expose the recorded referred-user count');
assert(adminUsersService.includes('LOWER(u.id::text) = LOWER(linked.user_id)'),
  'Text IDs in referrals.used_by must be joined safely to UUID user IDs');
assert(!adminUsersService.includes('u.password_hash,'), 'Password hashes must not be selected into API profile results');
assert(!adminUsersService.includes('u.google_id,'), 'Google IDs must not be selected into API profile results');
assert(!adminUsersService.includes('two_factor_secret'), 'Two-factor secrets must not be selected into API profile results');

const adminSpec = require('../docs/swagger/admin-spec').buildAdminOpenApiSpec();
const documentedPaths = Object.keys(adminSpec.paths).sort();
assert.deepStrictEqual(documentedPaths, [
  '/api/v1/admin/login',
  '/api/v1/admin/logout',
  '/api/v1/admin/me',
  '/api/v1/admin/refresh',
  '/api/v1/admin/setup-super-admin',
  '/api/v1/admin/sub-admins',
  '/api/v1/admin/users',
  '/api/v1/admin/users/{userId}/referrals/{referralId}/users'
]);
assert.strictEqual(adminSpec.paths['/api/v1/admin/sub-admins'].post.responses[403].description,
  'A Sub Admin cannot create admins.');
const usersListOperation = adminSpec.paths['/api/v1/admin/users'].get;
const referralUsersOperation = adminSpec.paths['/api/v1/admin/users/{userId}/referrals/{referralId}/users'].get;
for (const status of [200, 400, 401, 403]) {
  assert(usersListOperation.responses[status], `Admin users response ${status} must be documented`);
  assert(referralUsersOperation.responses[status], `Referral users response ${status} must be documented`);
}
assert(referralUsersOperation.responses[404], 'Missing or mismatched referral must be documented');
assert.strictEqual(
  usersListOperation.responses[200].content['application/json'].schema.properties.data.$ref,
  '#/components/schemas/AdminUserListData'
);
assert.strictEqual(
  referralUsersOperation.responses[200].content['application/json'].schema.properties.data.$ref,
  '#/components/schemas/AdminReferralUsersData'
);
assert.strictEqual(usersListOperation.summary, 'Get all users by Admin');
assert.strictEqual(referralUsersOperation.summary, 'Get referred users by Admin');
assert.deepStrictEqual(usersListOperation.tags, ['Get All Users by Admin']);
assert.deepStrictEqual(referralUsersOperation.tags, ['Get Referred Users by Admin']);
const adminApiGuide = fs.readFileSync(path.join(root, 'docs', 'admin-api.md'), 'utf8');
assert(adminApiGuide.includes('GET {{baseUrl}}/api/v1/admin/users'), 'Postman/API guide must document the users listing endpoint');
assert(adminApiGuide.includes('GET {{baseUrl}}/api/v1/admin/users/{{userId}}/referrals/{{referralId}}/users'),
  'Postman/API guide must document referral user details');

console.log('OK  admin token separation, database constraints, Super Admin user routes, referral query safety, and isolated API docs verified');
