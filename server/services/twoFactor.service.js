const { randomBytes } = require('crypto');
const { authenticator } = require('otplib');
const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { sendTwoFactorEmail } = require('../utils/email');
const { sendTwoFactorSms } = require('../utils/twilio');

const TWO_FACTOR_METHODS = new Set(['email', 'totp', 'sms']);
const TWO_FACTOR_CODE_LENGTH = 6;
const TWO_FACTOR_CODE_EXPIRY_MINUTES = 5;

authenticator.options = {
  digits: 6,
  algorithm: 'sha1',
  period: 30,
  window: 1,
};

async function generateTwoFactorCode() {
  const code = randomBytes(3).toString('hex').toUpperCase().slice(0, TWO_FACTOR_CODE_LENGTH);
  return code;
}

async function generateBackupCodes() {
  const codes = [];
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(4).toString('hex').toUpperCase();
    codes.push(code);
  }
  return codes;
}

async function enableTwoFactor(userId, method, options = {}) {
  if (!TWO_FACTOR_METHODS.has(method)) {
    throw ApiError.badRequest('Invalid 2FA method. Must be email, totp, or sms', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.NOT_FOUND,
    });
  }

  let targetPhone = options.phoneNumber?.trim() || user.phone_number;
  let targetEmail = options.email?.trim() || user.email;

  if (method === 'sms') {
    if (!targetPhone) {
      throw ApiError.badRequest('Phone number required for SMS 2FA', {
        code: ERROR_CODES.VALIDATION_FAILED,
      });
    }
    const { normalizePhoneNumber } = require('../utils/twilio');
    try {
      targetPhone = normalizePhoneNumber(targetPhone);
    } catch (e) {}
  }

  if (method === 'email' && !targetEmail) {
    throw ApiError.badRequest('Email required for email 2FA', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  if (method === 'totp') {
    const twoFactorSecret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(targetEmail || user.id, 'FirstSavvy', twoFactorSecret);

    // Store pending secret on user without flipping two_factor_enabled until confirmed
    await prisma.user.update({
      where: { id: userId },
      data: {
        two_factor_secret: twoFactorSecret,
      },
    });

    return {
      enabled: false,
      pendingVerification: true,
      method,
      secret: twoFactorSecret,
      otpauthUrl,
      message: 'Scan the QR code or enter the secret key in your authenticator app, then enter the 6-digit code to activate 2FA.',
    };
  }

  // If a new phone number was provided during setup, update user's phone_number
  if (method === 'sms' && options.phoneNumber && options.phoneNumber !== user.phone_number) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        phone_number: targetPhone
      }
    });
  }

  // For email or sms, generate and send a verification code first before activating 2FA
  const code = await generateTwoFactorCode();
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CODE_EXPIRY_MINUTES * 60 * 1000);

  await prisma.twoFactorVerification.create({
    data: {
      user_id: userId,
      method,
      code,
      expires_at: expiresAt,
    },
  });

  try {
    if (method === 'email') {
      await sendTwoFactorEmail(targetEmail, code);
    } else if (method === 'sms') {
      await sendTwoFactorSms(targetPhone, code);
    }
  } catch (error) {
    console.error('Error sending 2FA setup verification code:', error);
    throw ApiError.internal('Failed to send verification code. Please try again.', {
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  const destination = method === 'email' ? targetEmail : targetPhone;

  return {
    enabled: false,
    pendingVerification: true,
    method,
    destination,
    expiresAt,
    message: `Verification code sent to ${destination}. Enter the code to activate 2FA.`,
  };
}

async function confirmTwoFactorSetup(userId, method, code) {
  if (!TWO_FACTOR_METHODS.has(method)) {
    throw ApiError.badRequest('Invalid 2FA method. Must be email, totp, or sms', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode || normalizedCode.length < 6) {
    throw ApiError.badRequest('Verification code is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.NOT_FOUND,
    });
  }

  if (method === 'totp') {
    if (!user.two_factor_secret) {
      throw ApiError.badRequest('TOTP setup has not been initiated. Please start setup again.', {
        code: ERROR_CODES.VALIDATION_FAILED,
      });
    }

    const isValid = authenticator.verify({
      token: normalizedCode,
      secret: user.two_factor_secret,
    });

    if (!isValid) {
      throw ApiError.unauthorized('Invalid authenticator code. Please check your app and try again.', {
        code: ERROR_CODES.INVALID_CREDENTIALS,
      });
    }
  } else {
    const verification = await prisma.twoFactorVerification.findFirst({
      where: {
        user_id: userId,
        method,
        code: normalizedCode,
        verified: false,
        expires_at: {
          gt: new Date(),
        },
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    if (!verification) {
      throw ApiError.unauthorized('Invalid or expired verification code', {
        code: ERROR_CODES.INVALID_CREDENTIALS,
      });
    }

    await prisma.twoFactorVerification.update({
      where: { id: verification.id },
      data: { verified: true },
    });
  }

  const backupCodes = await generateBackupCodes();

  const updateData = {
    two_factor_enabled: true,
    two_factor_method: method,
    two_factor_secret: method === 'totp' ? user.two_factor_secret : null,
    two_factor_backup_codes: backupCodes,
  };

  if (method === 'sms') {
    updateData.phone_verified_at = new Date();
  } else if (method === 'email' && !user.verified_at) {
    updateData.verified_at = new Date();
  }

  await prisma.user.update({
    where: { id: userId },
    data: updateData,
  });

  return {
    enabled: true,
    method,
    secret: method === 'totp' ? user.two_factor_secret : null,
    backupCodes,
  };
}

async function disableTwoFactor(userId, password) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.NOT_FOUND,
    });
  }

  if (!user.two_factor_enabled) {
    throw ApiError.badRequest('2FA is not enabled', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  // Verify password (when account has a local password)
  if (user.password_hash && !user.google_id) {
    if (!password) {
      throw ApiError.badRequest('Password is required to disable 2FA', {
        code: ERROR_CODES.VALIDATION_FAILED,
      });
    }
    const bcrypt = require('bcrypt');
    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      throw ApiError.unauthorized('Invalid password', {
        code: ERROR_CODES.INVALID_CREDENTIALS,
      });
    }
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      two_factor_enabled: false,
      two_factor_method: null,
      two_factor_secret: null,
      two_factor_backup_codes: [],
    },
  });

  return { disabled: true };
}

async function requestTwoFactorVerification(userId) {
  if (!userId) {
    throw ApiError.badRequest('User ID is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.NOT_FOUND,
    });
  }

  if (!user.two_factor_enabled) {
    throw ApiError.badRequest('2FA is not enabled for this account', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const method = user.two_factor_method;
  const code = await generateTwoFactorCode();
  const expiresAt = new Date(Date.now() + TWO_FACTOR_CODE_EXPIRY_MINUTES * 60 * 1000);

  await prisma.twoFactorVerification.create({
    data: {
      user_id: userId,
      method,
      code,
      expires_at: expiresAt,
    },
  });

  try {
    if (method === 'email') {
      await sendTwoFactorEmail(user.email, code);
    } else if (method === 'sms') {
      await sendTwoFactorSms(user.phone_number, code);
    }
  } catch (error) {
    console.error('Error sending 2FA code:', error);
    throw ApiError.internal('Failed to send verification code', {
      code: ERROR_CODES.INTERNAL_ERROR,
    });
  }

  return {
    sent: true,
    method,
    expiresAt,
  };
}

async function verifyTwoFactorCode(userId, code, backupCode = null) {
  if (!userId) {
    throw ApiError.badRequest('User ID is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.NOT_FOUND,
    });
  }

  if (!user.two_factor_enabled) {
    throw ApiError.badRequest('2FA is not enabled for this account', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  if (backupCode) {
    const normalizedBackup = String(backupCode).trim().toUpperCase();
    const backupCodesList = Array.isArray(user.two_factor_backup_codes) ? user.two_factor_backup_codes : [];
    const backupCodeIndex = backupCodesList.indexOf(normalizedBackup);
    if (backupCodeIndex === -1) {
      throw ApiError.unauthorized('Invalid backup code', {
        code: ERROR_CODES.INVALID_CREDENTIALS,
      });
    }

    const updatedBackupCodes = [...backupCodesList];
    updatedBackupCodes.splice(backupCodeIndex, 1);

    await prisma.user.update({
      where: { id: userId },
      data: {
        two_factor_backup_codes: updatedBackupCodes,
      },
    });

    return { verified: true, method: 'backup' };
  }

  const normalizedCode = String(code || '').trim().toUpperCase();
  const verification = await prisma.twoFactorVerification.findFirst({
    where: {
      user_id: userId,
      code: normalizedCode,
      verified: false,
      expires_at: {
        gt: new Date(),
      },
    },
    orderBy: {
      created_at: 'desc',
    },
  });

  if (!verification) {
    const latestVerification = await prisma.twoFactorVerification.findFirst({
      where: {
        user_id: userId,
        verified: false,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    if (latestVerification) {
      await prisma.twoFactorVerification.update({
        where: { id: latestVerification.id },
        data: { attempts: latestVerification.attempts + 1 },
      });
    }

    throw ApiError.unauthorized('Invalid or expired verification code', {
      code: ERROR_CODES.INVALID_CREDENTIALS,
    });
  }

  await prisma.twoFactorVerification.update({
    where: { id: verification.id },
    data: { verified: true },
  });

  return { verified: true, method: verification.method };
}

async function verifyTotpCode(userId, totpCode) {
  if (!userId) {
    throw ApiError.badRequest('User ID is required', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.NOT_FOUND,
    });
  }

  if (!user.two_factor_enabled || user.two_factor_method !== 'totp') {
    throw ApiError.badRequest('TOTP is not enabled for this account', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  if (!user.two_factor_secret) {
    throw ApiError.badRequest('TOTP secret not found', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const isValid = authenticator.verify({
    token: String(totpCode || '').trim(),
    secret: user.two_factor_secret,
  });

  if (!isValid) {
    throw ApiError.unauthorized('Invalid TOTP code', {
      code: ERROR_CODES.INVALID_CREDENTIALS,
    });
  }

  return { verified: true, method: 'totp' };
}

async function getTwoFactorStatus(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      two_factor_enabled: true,
      two_factor_method: true,
      two_factor_backup_codes: true,
      phone_number: true,
      phone_verified_at: true,
      email: true,
      verified_at: true,
    },
  });

  if (!user) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.NOT_FOUND,
    });
  }

  return {
    enabled: user.two_factor_enabled,
    method: user.two_factor_method,
    hasPhone: !!user.phone_number,
    hasEmail: !!user.email,
    phoneNumber: user.phone_number,
    phoneVerified: !!user.phone_verified_at,
    email: user.email,
    emailVerified: !!user.verified_at,
    remainingBackupCodes: Array.isArray(user.two_factor_backup_codes) ? user.two_factor_backup_codes.length : 0,
  };
}

async function regenerateBackupCodes(userId, password) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw ApiError.notFound('User not found', {
      code: ERROR_CODES.NOT_FOUND,
    });
  }

  if (!user.two_factor_enabled) {
    throw ApiError.badRequest('2FA is not enabled', {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  if (user.password_hash && !user.google_id) {
    if (!password) {
      throw ApiError.badRequest('Password is required to regenerate backup codes', {
        code: ERROR_CODES.VALIDATION_FAILED,
      });
    }
    const bcrypt = require('bcrypt');
    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      throw ApiError.unauthorized('Invalid password', {
        code: ERROR_CODES.INVALID_CREDENTIALS,
      });
    }
  }

  const backupCodes = await generateBackupCodes();

  await prisma.user.update({
    where: { id: userId },
    data: {
      two_factor_backup_codes: backupCodes,
    },
  });

  return { backupCodes };
}

module.exports = {
  enableTwoFactor,
  confirmTwoFactorSetup,
  disableTwoFactor,
  requestTwoFactorVerification,
  verifyTwoFactorCode,
  verifyTotpCode,
  getTwoFactorStatus,
  regenerateBackupCodes,
  TWO_FACTOR_METHODS,
};
