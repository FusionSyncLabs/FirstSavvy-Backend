const { randomBytes } = require('crypto');
const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');

function generateSecretKey() {
  return randomBytes(16).toString('hex').toUpperCase();
}

async function createSecretKey(userId, options = {}) {
  const { name = null } = options;

  await prisma.secretKey.updateMany({
    where: {
      user_id: userId,
      is_active: true,
      deleted_at: null,
    },
    data: {
      is_active: false,
      expires_at: new Date(),
      updated_at: new Date(),
    },
  });

  const keyValue = generateSecretKey();

  const secretKey = await prisma.secretKey.create({
    data: {
      user_id: userId,
      key_value: keyValue,
      name: name || 'Secret Key',
      is_active: true,
    },
  });

  return {
    secretKey: {
      id: secretKey.id,
      key_value: secretKey.key_value,
      name: secretKey.name,
      created_at: secretKey.created_at,
    },
  };
}

async function verifySecretKey(userId, keyInput) {
  const normalizedKey = String(keyInput || '').trim().toUpperCase();

  if (!normalizedKey) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'Secret key is required',
      {
        code: ERROR_CODES.VALIDATION_FAILED,
      }
    );
  }

  const secretKey = await prisma.secretKey.findFirst({
    where: {
      user_id: userId,
      key_value: normalizedKey,
      is_active: true,
      deleted_at: null,
      OR: [
        { expires_at: null },
        { expires_at: { gt: new Date() } },
      ],
    },
  });

  if (!secretKey) {
    throw new ApiError(
      HTTP_STATUS.UNAUTHORIZED,
      'Invalid or expired secret key',
      {
        code: ERROR_CODES.INVALID_CREDENTIALS,
      }
    );
  }

  await prisma.secretKey.update({
    where: { id: secretKey.id },
    data: {
      last_used_at: new Date(),
    },
  });

  return {
    verified: true,
    keyId: secretKey.id,
  };
}

async function getActiveSecretKey(userId) {
  const secretKey = await prisma.secretKey.findFirst({
    where: {
      user_id: userId,
      is_active: true,
      deleted_at: null,
      OR: [
        { expires_at: null },
        { expires_at: { gt: new Date() } },
      ],
    },
    orderBy: {
      created_at: 'desc',
    },
  });

  if (!secretKey) {
    return null;
  }

  return {
    id: secretKey.id,
    name: secretKey.name,
    key_value: secretKey.key_value,
    created_at: secretKey.created_at,
    last_used_at: secretKey.last_used_at,
    expires_at: secretKey.expires_at,
  };
}

async function expireSecretKey(userId, keyId) {
  const secretKey = await prisma.secretKey.findFirst({
    where: {
      id: keyId,
      user_id: userId,
      is_active: true,
      deleted_at: null,
    },
  });

  if (!secretKey) {
    throw new ApiError(
      HTTP_STATUS.NOT_FOUND,
      'Active secret key not found',
      {
        code: ERROR_CODES.NOT_FOUND,
      }
    );
  }

  await prisma.secretKey.update({
    where: { id: keyId },
    data: {
      is_active: false,
      expires_at: new Date(),
      updated_at: new Date(),
    },
  });

  return {
    expired: true,
  };
}

async function deleteSecretKey(userId, keyId) {
  const secretKey = await prisma.secretKey.findFirst({
    where: {
      id: keyId,
      user_id: userId,
      deleted_at: null,
    },
  });

  if (!secretKey) {
    throw new ApiError(
      HTTP_STATUS.NOT_FOUND,
      'Secret key not found',
      {
        code: ERROR_CODES.NOT_FOUND,
      }
    );
  }

  await prisma.secretKey.update({
    where: { id: keyId },
    data: {
      deleted_at: new Date(),
      is_active: false,
      updated_at: new Date(),
    },
  });

  return {
    deleted: true,
  };
}

module.exports = {
  createSecretKey,
  verifySecretKey,
  getActiveSecretKey,
  expireSecretKey,
  deleteSecretKey,
};