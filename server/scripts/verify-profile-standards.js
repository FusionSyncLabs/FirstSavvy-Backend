const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

const schema = fs.readFileSync(path.join(root, 'prisma', 'schema.prisma'), 'utf8');
assert(schema.includes('model Profile {'), 'Profile model must exist');
assert(schema.includes('model ProfileMembership {'), 'ProfileMembership model must exist');
assert(schema.includes('@@unique([user_id, profile_id])'), 'Profile membership must be unique per user/profile');
assert(schema.includes('owner_user_id String'), 'Profile ownership field must exist');

const routes = fs.readFileSync(path.join(root, 'routes', 'v1', 'profile.routes.js'), 'utf8');
assert(routes.includes('router.use(authenticate)'), 'Profile routes must require authentication');
assert(routes.includes('authorizeProfile'), 'Profile routes must use centralized profile authorization');
assert(routes.includes("router.get('/', listProfiles)"), 'Profile list route must exist');
assert(routes.includes("router.post(\n  '/'"), 'Profile create route must exist');
assert(routes.includes("router.patch(\n  '/:profileId'"), 'Profile update route must exist');
assert(routes.includes("router.post(\n  '/:profileId/switch'"), 'Profile switch route must exist');
assert(routes.includes("profileId: { required: true, type: 'string', uuid: true }"), 'Profile ID params must be UUID validated');

const service = fs.readFileSync(path.join(root, 'services', 'profile.service.js'), 'utf8');
assert(service.includes('profileMembership.findMany'), 'Profile listing must be membership based');
assert(service.includes('profileMembership.findFirst'), 'Profile access must be membership based');
assert(service.includes('provisionProfileForUser'), 'Profile creation must reuse provisioning');
assert(service.includes('updateProfileForUser'), 'Profile updates must be implemented in the profile service');
assert(service.includes("['owner', 'admin'].includes(membership.role)"), 'Profile field updates must require owner/admin access');
assert(service.includes('profileTab.upsert'), 'Profile updates should support per-user tab updates');
assert(service.includes('activeProfileId'), 'Profile switching must persist active profile selection');
assert(service.includes('userSetting.upsert'), 'Profile switching must store active profile in user settings');
assert(service.includes('copyChartOfAccountsForProfile') === false, 'Profile service should reuse provisioning instead of duplicating chart copy logic');

const authService = fs.readFileSync(path.join(root, 'services', 'auth.service.js'), 'utf8');
assert(authService.includes('getActiveProfileForUser'), 'Auth bootstrap should return the active profile');

console.log('OK  profile engine standards verified');
