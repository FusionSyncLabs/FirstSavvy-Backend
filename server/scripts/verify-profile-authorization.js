const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { roleMeetsRequirement } = require('../middleware/authorizeProfile');

assert(roleMeetsRequirement('owner', 'viewer'), 'owner should satisfy viewer');
assert(roleMeetsRequirement('owner', 'admin'), 'owner should satisfy admin');
assert(roleMeetsRequirement('admin', 'editor'), 'admin should satisfy editor');
assert(roleMeetsRequirement('editor', 'viewer'), 'editor should satisfy viewer');
assert(roleMeetsRequirement('viewer', 'viewer'), 'viewer should satisfy viewer');
assert(!roleMeetsRequirement('viewer', 'editor'), 'viewer should not satisfy editor');
assert(!roleMeetsRequirement('editor', 'admin'), 'editor should not satisfy admin');
assert(!roleMeetsRequirement('unknown', 'viewer'), 'unknown role should not satisfy viewer');

const root = path.resolve(__dirname, '..');
const middleware = fs.readFileSync(path.join(root, 'middleware', 'authorizeProfile.js'), 'utf8');
assert(middleware.includes('profileMembership.findFirst'), 'authorization must verify profile membership');
assert(middleware.includes('deleted_at'), 'authorization must reject deleted profiles');
assert(middleware.includes('is_active'), 'authorization must reject inactive profiles');
assert(middleware.includes('PROFILE_NOT_FOUND'), 'missing profile access should use profile not found error');
assert(middleware.includes('PROFILE_ACCESS_DENIED'), 'insufficient role should use profile access denied error');
assert(middleware.includes('headers.x-profile-id'), 'authorization should support x-profile-id for future APIs');

const routes = fs.readFileSync(path.join(root, 'routes', 'v1', 'profile.routes.js'), 'utf8');
assert(routes.includes('authorizeProfile'), 'profile routes should use centralized profile authorization');

console.log('OK  profile authorization verified');
