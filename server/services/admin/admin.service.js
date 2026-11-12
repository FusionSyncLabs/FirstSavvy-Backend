const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { prisma } = require('../../config/database');
const { env } = require('../../config/env');
const { ApiError } = require('../../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../../constants/errorCodes');
const { normalizeEmail } = require('.././provisioning.helpers');
const { signJwt, verifyJwt } = require('../../utils/tokens');

const BCRYPT_ROUNDS = 12;
const MAX_BCRYPT_PASSWORD_BYTES = 72;

function safeAdmin(admin) {
  return {
    id: admin.id,
    name: admin.name,
    email: admin.email,
    role: admin.role,
    status: admin.status,
    permissions: admin.permissions,
    created_by_id: admin.created_by_id,
    last_login_at: admin.last_login_at,
    created_at: admin.created_at,
    updated_at: admin.updated_at
  };
}

function createAdminSession(admin) {
  return {
    accessToken: signJwt({
      sub: admin.id,
      email: admin.email,
      type: 'admin_access',
      tokenVersion: admin.refresh_token_version
    }, env.jwtAccessSecret, env.accessTokenTtlSeconds),
    refreshToken: signJwt({
      sub: admin.id,
      type: 'admin_refresh',
      tokenVersion: admin.refresh_token_version,
      jti: crypto.randomUUID()
    }, env.jwtRefreshSecret, env.refreshTokenTtlSeconds),
    tokenType: 'Bearer',
    expiresIn: env.accessTokenTtlSeconds
  };
}

function validatePassword(password) {
  const value = String(password || '');
  const byteLength = Buffer.byteLength(value, 'utf8');

  if (value.length < 8 || byteLength > MAX_BCRYPT_PASSWORD_BYTES) {
    throw ApiError.badRequest('Password must be at least 8 characters and at most 72 UTF-8 bytes.', {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [{
        location: 'body',
        field: 'password',
        message: 'Password must be at least 8 characters and at most 72 UTF-8 bytes.'
      }]
    });
  }
}

function verifyBootstrapSecret(suppliedSecret) {
  const configuredSecret = env.adminBootstrapSecret;

  if (!configuredSecret || Buffer.byteLength(configuredSecret, 'utf8') < 32) {
    throw new ApiError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'Admin bootstrap is not configured.', {
      code: ERROR_CODES.SERVICE_UNAVAILABLE
    });
  }

  const expected = Buffer.from(configuredSecret, 'utf8');
  const actual = Buffer.from(String(suppliedSecret || ''), 'utf8');

  if (
    expected.length === 0 ||
    actual.length === 0 ||
    expected.length !== actual.length ||
    !crypto.timingSafeEqual(expected, actual)
  ) {
    throw ApiError.unauthorized('Invalid admin bootstrap secret.', {
      code: ERROR_CODES.UNAUTHORIZED
    });
  }
}

async function setupSuperAdmin({ secret_key: secretKey, name, email, password }) {
  verifyBootstrapSecret(secretKey);

  const existingSuperAdmin = await prisma.admin.findFirst({
    where: { role: 'SUPER_ADMIN' },
    select: { id: true }
  });

  if (existingSuperAdmin) {
    throw ApiError.conflict('Super Admin has already been created.', {
      code: ERROR_CODES.CONFLICT
    });
  }

  validatePassword(password);
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const admin = await prisma.admin.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      permissions: []
    }
  });

  return { admin: safeAdmin(admin), session: createAdminSession(admin) };
}

async function loginAdmin({ email, password }) {
  const normalizedEmail = normalizeEmail(email);
  const admin = await prisma.admin.findUnique({
    where: { email: normalizedEmail }
  });

  if (
    !admin ||
    admin.deleted_at ||
    admin.status !== 'ACTIVE' ||
    !admin.password_hash ||
    Buffer.byteLength(String(password || ''), 'utf8') > MAX_BCRYPT_PASSWORD_BYTES
  ) {
    throw invalidAdminCredentials();
  }

  const passwordMatches = await bcrypt.compare(String(password), admin.password_hash);
  if (!passwordMatches) {
    throw invalidAdminCredentials();
  }

  const updatedAdmin = await prisma.admin.update({
    where: { id: admin.id },
    data: { last_login_at: new Date() }
  });

  return { admin: safeAdmin(updatedAdmin), session: createAdminSession(updatedAdmin) };
}

async function getActiveAdminById(adminId) {
  const admin = await prisma.admin.findUnique({ where: { id: adminId } });

  if (!admin || admin.deleted_at || admin.status !== 'ACTIVE') {
    throw ApiError.unauthorized('Admin session is no longer active.', {
      code: ERROR_CODES.UNAUTHORIZED
    });
  }

  return admin;
}

async function invalidateAdminSessionsAfterRefreshReuse(adminId, staleTokenVersion) {
  if (!Number.isInteger(staleTokenVersion)) {
    return;
  }

  await prisma.admin.updateMany({
    where: {
      id: adminId,
      status: 'ACTIVE',
      deleted_at: null,
      refresh_token_version: { gt: staleTokenVersion }
    },
    data: { refresh_token_version: { increment: 1 } }
  });
}

async function refreshAdminSession(refreshToken) {
  if (!refreshToken) {
    throw ApiError.unauthorized('Admin refresh token is required.', {
      code: ERROR_CODES.REFRESH_TOKEN_REQUIRED
    });
  }

  const payload = verifyJwt(refreshToken, env.jwtRefreshSecret, 'admin_refresh');
  const admin = await getActiveAdminById(payload.sub);

  if (payload.tokenVersion !== admin.refresh_token_version) {
    if (payload.tokenVersion < admin.refresh_token_version) {
      await invalidateAdminSessionsAfterRefreshReuse(admin.id, payload.tokenVersion);
    }

    throw ApiError.unauthorized('Admin session has expired. Please sign in again.', {
      code: ERROR_CODES.INVALID_TOKEN
    });
  }

  const rotation = await prisma.admin.updateMany({
    where: {
      id: admin.id,
      status: 'ACTIVE',
      deleted_at: null,
      refresh_token_version: payload.tokenVersion
    },
    data: { refresh_token_version: { increment: 1 } }
  });

  if (rotation.count !== 1) {
    await invalidateAdminSessionsAfterRefreshReuse(admin.id, payload.tokenVersion);

    throw ApiError.unauthorized('Admin session has expired. Please sign in again.', {
      code: ERROR_CODES.INVALID_TOKEN
    });
  }

  const refreshedAdmin = await getActiveAdminById(admin.id);
  if (refreshedAdmin.refresh_token_version !== payload.tokenVersion + 1) {
    throw ApiError.unauthorized('Admin session has expired. Please sign in again.', {
      code: ERROR_CODES.INVALID_TOKEN
    });
  }

  return { admin: safeAdmin(refreshedAdmin), session: createAdminSession(refreshedAdmin) };
}

async function logoutAdmin(adminId) {
  await prisma.admin.update({
    where: { id: adminId },
    data: { refresh_token_version: { increment: 1 } }
  });

  return { message: 'Admin logged out successfully.' };
}

async function createSubAdmin({ name, email, password }, creatorAdminId) {
  validatePassword(password);
  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const admin = await prisma.admin.create({
    data: {
      name: name.trim(),
      email: normalizedEmail,
      password_hash: passwordHash,
      role: 'SUB_ADMIN',
      status: 'ACTIVE',
      permissions: [],
      created_by_id: creatorAdminId
    }
  });

  return safeAdmin(admin);
}

function invalidAdminCredentials() {
  return ApiError.unauthorized('Invalid admin email or password.', {
    code: ERROR_CODES.INVALID_CREDENTIALS
  });
}

module.exports = {
  setupSuperAdmin,
  loginAdmin,
  getActiveAdminById,
  refreshAdminSession,
  logoutAdmin,
  createSubAdmin,
  safeAdmin
};
