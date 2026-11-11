const { randomUUID } = require("crypto");
const bcrypt = require("bcrypt");
const { prisma } = require("../config/database");
const { ApiError } = require("../middleware/errorHandler");
const { ERROR_CODES, HTTP_STATUS } = require("../constants/errorCodes");
const {
  shouldIncludeInCashBalance,
  normalizeEmail,
  buildDefaultDisplayName,
} = require("./provisioning.helpers");
const { pickPublicUser } = require("../utils/sanitize");
const { generateUniqueUsername } = require("../utils/username");
const { generateUniqueId } = require("../utils/uniqueId");

const BCRYPT_ROUNDS = 12;

async function copyChartOfAccountsForProfile(tx, profileId) { 
  return 0;
}

async function provisionProfileForUser(tx, user, options = {}) {
  const displayName = buildDefaultDisplayName({
    fullName: options.displayName || user.full_name,
    email: user.email,
  });

  const profile = await tx.profile.create({
    data: {
      owner_user_id: user.id,
      unique_id: generateUniqueId(),
      name: displayName,
      display_name: displayName,
      profile_type: options.profileType || "personal",
      is_default: options.isDefault ?? true,
      is_active: true,
      avatar_url: user.avatar_url ? user.avatar_url : null,
      metadata: user.phone_number ? { phone: user.phone_number } : {},
    },
  });

  await tx.profileMembership.create({
    data: {
      user_id: user.id,
      profile_id: profile.id,
      role: "owner",
    },
  });

  await tx.profileTab.create({
    data: {
      owner_user_id: user.id,
      profile_id: profile.id,
      display_name: displayName,
      is_active: true,
      sort_order: options.sortOrder ?? 0,
    },
  });

  await tx.userSetting.upsert({
    where: { user_id: user.id },
    create: {
      user_id: user.id,
      settings: {},
    },
    update: {},
  });

  const chartAccountCount = await copyChartOfAccountsForProfile(tx, profile.id);

  return {
    profile,
    chartAccountCount,
  };
}

async function provisionExistingUser(userId, options = {}) {
  const user = await txSafeUserLookup(userId);

  const existingMembership = await prisma.profileMembership.findFirst({
    where: { user_id: userId },
    include: { profile: true },
  });

  if (existingMembership) {
    const chartAccountCount = await prisma.userChartOfAccount.count({
      where: { profile_id: existingMembership.profile_id },
    });

    return {
      alreadyProvisioned: true,
      user,
      profile: existingMembership.profile,
      chartAccountCount,
      message: "Profile already exists",
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const provisioned = await provisionProfileForUser(tx, user, options);
    return provisioned;
  });

  return {
    alreadyProvisioned: false,
    user,
    profile: result.profile,
    chartAccountCount: result.chartAccountCount,
    message: "Profile created successfully with chart of accounts",
  };
}

async function provisionNewUser({ email, fullName, password, profileType, phone }) {
  const normalizedEmail = normalizeEmail(email);
  const { normalizePhoneNumber } = require("../utils/twilio");
  const normalizedPhone = phone ? normalizePhoneNumber(phone) : null;

  if (!normalizedEmail) {
    throw ApiError.badRequest("Email is required", {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [
        {
          location: "body",
          field: "email",
          message: "Required field is missing",
        },
      ],
    });
  }

  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    throw ApiError.conflict("A user with this email already exists", {
      code: ERROR_CODES.EMAIL_ALREADY_EXISTS,
    });
  }

  // Check if phone number already exists
  if (normalizedPhone) {
    const existingPhoneUser = await prisma.user.findUnique({
      where: { phone_number: normalizedPhone },
    });

    if (existingPhoneUser) {
      throw ApiError.conflict("A user with this phone number already exists", {
        code: ERROR_CODES.PHONE_ALREADY_EXISTS,
      });
    }
  }

  let passwordHash = null;

  if (password) {
    if (String(password).length < 8) {
      throw ApiError.badRequest("Password must be at least 8 characters", {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [
          {
            location: "body",
            field: "password",
            message: "Must be at least 8 characters",
          },
        ],
      });
    }

    passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  }

  const displayName = buildDefaultDisplayName({
    fullName,
    email: normalizedEmail,
  });

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: normalizedEmail,
        user_name: generateUniqueUsername(displayName, displayName),
        unique_id: generateUniqueId(),
        password_hash: passwordHash,
        full_name: displayName,
        phone_number: normalizedPhone,
      },
    });

    const provisioned = await provisionProfileForUser(tx, user, {
      displayName,
      profileType,
    });

    return {
      user,
      profile: provisioned.profile,
      chartAccountCount: provisioned.chartAccountCount,
    };
  });

  return {
    user: pickPublicUser(result.user),
    profile: result.profile,
    chartAccountCount: result.chartAccountCount,
    message: "User provisioned successfully",
  };
}

async function verifyUserProvisioning(userId) {
  await txSafeUserLookup(userId);

  const profile = await prisma.profile.findFirst({
    where: {
      owner_user_id: userId,
      deleted_at: null,
    },
    orderBy: { created_at: "asc" },
  });

  const membership = await prisma.profileMembership.findFirst({
    where: { user_id: userId },
  });

  const tab = await prisma.profileTab.findFirst({
    where: { owner_user_id: userId },
  });

  const settings = await prisma.userSetting.findUnique({
    where: { user_id: userId },
  });

  const chartAccountCount = profile
    ? await prisma.userChartOfAccount.count({
        where: { profile_id: profile.id },
      })
    : 0;

  const isFullyProvisioned = Boolean(
    profile && membership && tab && settings,
  );

  return {
    userId,
    profileId: profile?.id || null,
    hasProfile: Boolean(profile),
    hasMembership: Boolean(membership),
    hasTab: Boolean(tab),
    hasSettings: Boolean(settings),
    chartAccountCount,
    isFullyProvisioned,
  };
}

async function txSafeUserLookup(userId) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deleted_at: null,
    },
  });

  if (!user) {
    throw ApiError.notFound("User not found", {
      code: ERROR_CODES.USER_NOT_FOUND,
    });
  }

  return user;
}

module.exports = {
  copyChartOfAccountsForProfile,
  provisionProfileForUser,
  provisionExistingUser,
  provisionNewUser,
  verifyUserProvisioning,
};
