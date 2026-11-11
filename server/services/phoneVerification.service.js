const { prisma } = require("../config/database");
const { ApiError } = require("../middleware/errorHandler");
const { ERROR_CODES, HTTP_STATUS } = require("../constants/errorCodes");
const { generateOTP } = require("../utils/otp");
const { sendSMS, verifyTwilioCode, normalizePhoneNumber } = require("../utils/twilio");
const { pickPublicUser } = require("../utils/sanitize");
const { buildSession } = require("../utils/session");
const { getActiveProfileForUser } = require("./profile.service");

async function requestPhoneVerification({ phone, userId }) {
  const normalizedPhone = normalizePhoneNumber(phone);

  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.deleted_at) {
      throw ApiError.badRequest("User not found", {
        code: ERROR_CODES.USER_NOT_FOUND,
      });
    }

    if (user.phone_verified_at) {
      throw ApiError.badRequest("Phone number is already verified", {
        code: ERROR_CODES.PHONE_ALREADY_VERIFIED,
      });
    }
  } else {
    const existingUser = await prisma.user.findUnique({
      where: { phone_number: normalizedPhone },
    });

    if (existingUser && !existingUser.deleted_at) {
      throw ApiError.badRequest("Phone number is already registered", {
        code: ERROR_CODES.PHONE_ALREADY_EXISTS,
      });
    }
  }

  const recentVerification = await prisma.phoneVerification.findFirst({
    where: {
      phone: normalizedPhone,
      status: "pending",
      created_at: {
        gt: new Date(Date.now() - 60000), // 1 minute cooldown
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });

  if (recentVerification) {
    throw ApiError.badRequest("Please wait before requesting another verification code. Try again in 1 minute.", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  await prisma.phoneVerification.deleteMany({
    where: {
      phone: normalizedPhone,
      status: "pending",
      OR: [
        { expires_at: { lt: new Date() } },
        { created_at: { lt: new Date(Date.now() - 300000) } }, 
      ],
    },
  });

  const generatedCode = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); 

  const verification = await prisma.phoneVerification.create({
    data: {
      phone: normalizedPhone,
      code: generatedCode,
      expires_at: expiresAt,
      user_id: userId,
    },
  });

  try {
    const message = `Your FirstSavvy verification code is: ${generatedCode}\n\nThis code will expire in 5 minutes.\n\nIf you did not request this verification, please ignore this message.`;
    await sendSMS(normalizedPhone, message, generatedCode);
  } catch (error) {
    console.error("Failed to send SMS verification:", error);
  }

  return {
    success: true,
    verificationId: verification.id,
    expiresAt: verification.expires_at,
    message: "Verification code sent successfully",
  };
}

async function verifyPhoneCode({ phone, code, email, password, fullName, userId, referral }) {
  const normalizedPhone = normalizePhoneNumber(phone);

  if (!code || code.length !== 6 || !/^\d+$/.test(code)) {
    throw ApiError.badRequest("Invalid code format. Code must be 6 digits.", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const verificationRecord = await prisma.phoneVerification.findFirst({
    where: {
      phone: normalizedPhone,
      status: "pending",
      expires_at: {
        gt: new Date(),
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });

  if (!verificationRecord) {
    throw ApiError.badRequest("Invalid or expired verification code", {
      code: ERROR_CODES.INVALID_OTP,
    });
  }

  if (verificationRecord.attempts >= 3) {
    await prisma.phoneVerification.update({
      where: { id: verificationRecord.id },
      data: { status: "failed" },
    });
    throw ApiError.badRequest("Too many failed attempts. Please request a new code.", {
      code: ERROR_CODES.OTP_ATTEMPTS_EXCEEDED,
    });
  }

  const isLocalCodeMatch = verificationRecord.code === code;
  const isTwilioVerifyMatch = !isLocalCodeMatch
    ? await verifyTwilioCode(normalizedPhone, code)
    : false;

  if (!isLocalCodeMatch && !isTwilioVerifyMatch) {
    const nextAttempts = (verificationRecord.attempts || 0) + 1;
    await prisma.phoneVerification.update({
      where: { id: verificationRecord.id },
      data: {
        attempts: nextAttempts,
        ...(nextAttempts >= 3 ? { status: "failed" } : {}),
      },
    });
    throw ApiError.badRequest("Invalid or expired verification code", {
      code: ERROR_CODES.INVALID_OTP,
    });
  }

  await prisma.phoneVerification.update({
    where: { id: verificationRecord.id },
    data: {
      status: "verified",
      attempts: (verificationRecord.attempts || 0) + 1,
    },
  });

  let user;
  let isNewUser = false;

  if (userId) {
    user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.deleted_at) {
      throw ApiError.badRequest("User not found", {
        code: ERROR_CODES.USER_NOT_FOUND,
      });
    }

    user = await prisma.user.update({
      where: { id: userId },
      data: {
        phone_number: normalizedPhone,
        phone_verified_at: new Date(),
      },
    });
  } else if (verificationRecord.user_id) {
    user = await prisma.user.update({
      where: { id: verificationRecord.user_id },
      data: {
        phone_number: normalizedPhone,
        phone_verified_at: new Date(),
      },
    });
  } else if (password) {
    const { registerUserInTransaction } = require("./auth.service");
    const { normalizeEmail } = require("./provisioning.helpers");
    
    try {
      const cleanDigits = normalizedPhone.replace(/\D/g, "");
      const userEmail = email && email.trim()
        ? normalizeEmail(email)
        : `${cleanDigits}@phone.firstsavvy.local`;

      const result = await prisma.$transaction(async (tx) => {
        return registerUserInTransaction(tx, {
          email: userEmail,
          fullName: fullName?.trim() || "User",
          password,
          phone: normalizedPhone,
        });
      });
      
      user = result.user;
      isNewUser = true;
      
      // User verified via phone SMS OTP, so mark both phone_verified_at and verified_at
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          phone_verified_at: new Date(),
          verified_at: new Date(),
        },
      });
    } catch (error) {
      await prisma.phoneVerification.update({
        where: { id: verificationRecord.id },
        data: { status: "failed" },
      });
      throw error;
    }
  } else {
    user = await prisma.user.findUnique({
      where: { phone_number: normalizedPhone },
    });

    if (!user || user.deleted_at) {
      throw ApiError.badRequest("No account found with this phone number", {
        code: ERROR_CODES.USER_NOT_FOUND,
      });
    }

    if (!user.phone_verified_at) {
      throw ApiError.badRequest("Phone number not verified", {
        code: ERROR_CODES.PHONE_NOT_VERIFIED,
      });
    }
  }

  await prisma.phoneVerification.deleteMany({
    where: {
      phone: normalizedPhone,
      status: "verified",
      id: { not: verificationRecord.id },
    },
  });

  const session = userId ? null : buildSession(user);

  return {
    success: true,
    verifiedAt: verificationRecord.updated_at,
    message: userId ? "Phone number added successfully" : (isNewUser ? "Account created successfully" : "Phone verified successfully"),
    user: pickPublicUser(user),
    profile: userId ? null : await getActiveProfileForUser(user.id),
    session,
    isNewUser,
  };
}

async function resendPhoneVerification({ phone, userId }) {
  const normalizedPhone = normalizePhoneNumber(phone);

  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || user.deleted_at) {
      throw ApiError.badRequest("User not found", {
        code: ERROR_CODES.USER_NOT_FOUND,
      });
    }

    if (user.phone_verified_at) {
      throw ApiError.badRequest("Phone number is already verified", {
        code: ERROR_CODES.PHONE_ALREADY_VERIFIED,
      });
    }
  }

  const recentVerification = await prisma.phoneVerification.findFirst({
    where: {
      phone: normalizedPhone,
      status: "pending",
      created_at: {
        gt: new Date(Date.now() - 60000),
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });

  if (recentVerification) {
    throw ApiError.badRequest("Please wait before requesting another verification code. Try again in 1 minute.", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  return requestPhoneVerification({ phone: normalizedPhone, userId });
}

async function removePhoneNumber({ userId }) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || user.deleted_at) {
    throw ApiError.badRequest("User not found", {
      code: ERROR_CODES.USER_NOT_FOUND,
    });
  }

  if (!user.phone_number) {
    throw ApiError.badRequest("No phone number associated with this account", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: {
      phone_number: null,
      phone_verified_at: null,
    },
  });

  await prisma.phoneVerification.deleteMany({
    where: {
      user_id: userId,
    },
  });

  return {
    success: true,
    message: "Phone number removed successfully",
    user: pickPublicUser(updatedUser),
  };
}

module.exports = {
  requestPhoneVerification,
  verifyPhoneCode,
  resendPhoneVerification,
  removePhoneNumber,
};
