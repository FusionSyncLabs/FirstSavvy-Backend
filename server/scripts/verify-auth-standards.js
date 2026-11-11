const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { signJwt, verifyJwt, hashToken, compareTokenHash } = require('../utils/tokens');

const secret = 'verify-auth-secret';

const accessToken = signJwt({
  sub: '00000000-0000-4000-8000-000000000000',
  type: 'access'
}, secret, 60);

const payload = verifyJwt(accessToken, secret, 'access');
assert.strictEqual(payload.type, 'access', 'access token should preserve token type');
assert.strictEqual(payload.sub, '00000000-0000-4000-8000-000000000000', 'access token should preserve subject');

const resetToken = signJwt({
  sub: '00000000-0000-4000-8000-000000000000',
  type: 'password_reset',
  jti: 'verify-reset'
}, secret, 60);
const resetPayload = verifyJwt(resetToken, secret, 'password_reset');
assert.strictEqual(resetPayload.type, 'password_reset', 'reset token should preserve token type');
assert(resetPayload.iat, 'reset token should include issued-at timestamp');
assert(resetPayload.exp, 'reset token should include expiry timestamp');
assert.strictEqual(hashToken(resetToken), hashToken(resetToken), 'token hashing should be deterministic');
assert(compareTokenHash(resetToken, hashToken(resetToken)), 'token hash comparison should verify the latest reset token');
assert.notStrictEqual(hashToken(resetToken), resetToken, 'stored reset token value should be hashed');

const root = path.resolve(__dirname, '..');
const authenticateMiddleware = fs.readFileSync(path.join(root, 'middleware', 'authenticate.js'), 'utf8');
assert(authenticateMiddleware.includes('ERROR_CODES.TOKEN_EXPIRED'), 'auth middleware should handle expired access tokens');
assert(authenticateMiddleware.includes('refreshSession(getCookie'), 'auth middleware should refresh from the HttpOnly cookie');
assert(authenticateMiddleware.includes("res.set('X-Access-Token'"), 'auth middleware should expose refreshed access tokens');

const cookieUtils = fs.readFileSync(path.join(root, 'utils', 'cookies.js'), 'utf8');
assert(cookieUtils.includes("path: '/api/v1'"), 'refresh cookie must be scoped to protected API routes');

const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
assert(app.includes('exposedHeaders'), 'CORS should expose refreshed token headers');
assert(app.includes('X-Access-Token'), 'CORS should expose X-Access-Token');

const authRoutes = fs.readFileSync(path.join(root, 'routes', 'v1', 'auth.routes.js'), 'utf8');
assert(authRoutes.includes("router.get('/google'"), 'Google OAuth start route should exist');
assert(authRoutes.includes("router.get('/google/callback'"), 'Google OAuth callback route should exist');

const authService = fs.readFileSync(path.join(root, 'services', 'auth.service.js'), 'utf8');
assert(authService.includes('getGoogleAuthorizationUrl'), 'Google OAuth authorization helper should exist');
assert(authService.includes('completeGoogleOAuth'), 'Google OAuth callback completion helper should exist');
assert(authService.includes('https://oauth2.googleapis.com/token'), 'Google OAuth token exchange endpoint should be used');
assert(authService.includes('https://openidconnect.googleapis.com/v1/userinfo'), 'Google userinfo endpoint should be used');
assert(authService.includes('GOOGLE_OAUTH_NOT_CONFIGURED'), 'Google OAuth should fail closed when credentials are missing');

const envConfig = fs.readFileSync(path.join(root, 'config', 'env.js'), 'utf8');
assert(envConfig.includes('googleOAuthClientId'), 'Google OAuth client ID env should be configured');
assert(envConfig.includes('googleOAuthClientSecret'), 'Google OAuth client secret env should be configured');

console.log('OK  auth token helpers verified');
