const { prisma } = require("../config/database");
const { ApiError } = require("../middleware/errorHandler");
const { ERROR_CODES, HTTP_STATUS } = require("../constants/errorCodes");
const { generateOTP } = require("../utils/otp");
const { normalizeEmail } = require("./provisioning.helpers");
const { sendEmail, generateEmailTemplate } = require("../utils/mail");
const { env } = require("../config/env");
const { pickPublicUser } = require("../utils/sanitize");
const { buildSession } = require("../utils/session");
const { getActiveProfileForUser } = require("./profile.service");

async function requestOtpVerification({ email }) {
  const normalizedEmail = normalizeEmail(email);

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || user.deleted_at) {
    throw ApiError.badRequest("User not found for the provided email", {
      code: ERROR_CODES.USER_NOT_FOUND,
    });
  }

  if (user.verified_at) {
    throw ApiError.badRequest("Email is already verified", {
      code: ERROR_CODES.EMAIL_ALREADY_VERIFIED,
    });
  }

  const generatedOTP = generateOTP();
  const expiresAt = new Date(Date.now() + 60000 * 5); // 5 minutes expiration

  await prisma.otpVerification.deleteMany({
    where: {
      user_id: user.id,
      status: "pending",
    },
  });

  const result = await prisma.otpVerification.create({
    data: {
      email: normalizedEmail,
      otp: generatedOTP,
      expires_at: expiresAt,
      user_id: user.id,
    },
  });

  const emailSubject = "Verify your FirstSavvy account";
  const emailText = `Your verification code is: ${generatedOTP}\n\nThis code will expire in 5 minutes.\n\nIf you did not request this verification, please ignore this email.`;

  const emailHtml = generateEmailTemplate({
    title: "Verify Your Email Address",
    content: `
      <p style="margin: 0 0 20px 0;">Your verification code is:</p>
      <div style="background-color: #f0f9ff; border: 2px solid #2c4a6b; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
        <span style="font-size: 32px; font-weight: bold; color: #2c4a6b; letter-spacing: 4px;">${generatedOTP}</span>
      </div>
      <p style="margin: 20px 0;">This code will expire in <strong>5 minutes</strong>.</p>
    `,
    footerText: "If you did not request this verification, please ignore this email."
  });

  try {
    await sendEmail(email, emailSubject, emailText, emailHtml);
  } catch (error) {
    console.error("Failed to send OTP email:", error);
  }

  return {
    success: true,
    otpId: result.id,
    expiresAt: result.expires_at,
    message: "OTP sent successfully",
  };
}

async function verifyOtpCode({ email, otp }) {
  const normalizedEmail = normalizeEmail(email);
  if (!otp || otp.length !== 6 || !/^\d+$/.test(otp)) {
    throw ApiError.badRequest("Invalid OTP format. OTP must be 6 digits.", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const otpRecord = await prisma.otpVerification.findFirst({
    where: {
      email: normalizedEmail,
      otp: otp,
      status: "pending",
      expires_at: {
        gt: new Date(),
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });

  if (!otpRecord) {
    throw ApiError.badRequest("Invalid or expired OTP", {
      code: ERROR_CODES.INVALID_OTP,
    });
  }

  if (otpRecord.attempts >= 3) {
    await prisma.otpVerification.update({
      where: { id: otpRecord.id },
      data: { status: "failed" },
    });
    throw ApiError.badRequest("Too many failed attempts. Please request a new OTP.", {
      code: ERROR_CODES.OTP_ATTEMPTS_EXCEEDED,
    });
  }

  const updatedRecord = await prisma.otpVerification.update({
    where: { id: otpRecord.id },
    data: {
      status: "verified",
      attempts: otpRecord.attempts + 1,
    },
  });

  const user = await prisma.user.update({
    where: { id: otpRecord.user_id },
    data: { verified_at: new Date() },
  });

  await prisma.otpVerification.deleteMany({
    where: {
      user_id: otpRecord.user_id,
      status: "verified",
      id: { not: otpRecord.id },
    },
  });

  const session = buildSession(user);

  return {
    success: true,
    verifiedAt: updatedRecord.updated_at,
    message: "Email verified successfully",
    user: pickPublicUser(user),
    profile: await getActiveProfileForUser(user.id),
    session,
  };
}

async function resendOtpVerification({ email }) {
  const normalizedEmail = normalizeEmail(email);

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || user.deleted_at) {
    throw ApiError.badRequest("User not found for the provided email", {
      code: ERROR_CODES.USER_NOT_FOUND,
    });
  }

  if (user.verified_at) {
    throw ApiError.badRequest("Email is already verified", {
      code: ERROR_CODES.EMAIL_ALREADY_VERIFIED,
    });
  }

  const recentOtp = await prisma.otpVerification.findFirst({
    where: {
      user_id: user.id,
      status: "pending",
      created_at: {
        gt: new Date(Date.now() - 60000),
      },
    },
    orderBy: {
      created_at: "desc",
    },
  });

  if (recentOtp) {
    throw ApiError.badRequest("Please wait before requesting another OTP. Try again in 1 minute.", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  return requestOtpVerification({ email: normalizedEmail });
}

module.exports = {
  requestOtpVerification,
  verifyOtpCode,
  resendOtpVerification,
};
