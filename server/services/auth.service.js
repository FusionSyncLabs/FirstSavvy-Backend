const bcrypt = require("bcrypt");
const { randomBytes, randomUUID } = require("crypto");
const { prisma } = require("../config/database");
const { env } = require("../config/env");
const { ApiError } = require("../middleware/errorHandler");
const { ERROR_CODES, HTTP_STATUS } = require("../constants/errorCodes");
const {
  provisionNewUser,
  provisionProfileForUser,
  verifyUserProvisioning,
} = require("./provisioning.service");
const { normalizeEmail } = require("./provisioning.helpers");
const { getActiveProfileForUser } = require("./profile.service");
const { pickPublicUser } = require("../utils/sanitize");
const {
  signJwt,
  verifyJwt,
  hashToken,
  compareTokenHash,
} = require("../utils/tokens");
const { buildSession } = require("../utils/session");
const { sendPasswordResetEmail } = require("../utils/email");
const { logServerError } = require("../utils/safeLogger");
const { generateUniqueUsername } = require("../utils/username");
const { generateUniqueId } = require("../utils/uniqueId");
const {
  validateReferralForSignup,
  processReferralUsage,
} = require("./referral.service");
const {
  requestOtpVerification,
} = require("./otp.service");
const {
  issueChallengeToken,
  consumeCompletionToken,
} = require("../utils/twoFactorTokens");

const BCRYPT_ROUNDS = 12;

async function registerUser({
  email,
  fullName,
  password,
  profileType,
  referral,
  phone,
}) {
  if (phone && String(phone).trim()) {
    const digitsOnly = String(phone).replace(/\D/g, "");
    if (digitsOnly.length < 10 || digitsOnly.length > 15) {
      throw ApiError.badRequest("Please enter a valid phone number (10 to 15 digits).", {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: "body", field: "phone", message: "Phone number must contain 10 to 15 digits." }],
      });
    }
  }

  const trimmedReferral = referral && String(referral).trim() ? String(referral).trim() : null;
  if (trimmedReferral) {
    const validation = await validateReferralForSignup(trimmedReferral);
    if (!validation.valid) {
      throw ApiError.badRequest(validation.reason || "Invalid referral code", {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [{ location: "body", field: "referral", message: validation.reason || "Invalid referral code" }],
      });
    }
  }

  const provisioned = await provisionNewUser({
    email,
    fullName,
    password,
    profileType,
    phone,
  });
  const user = await findActiveUserById(provisioned.user.id);

  let referralData = null;
  if (trimmedReferral) {
    try {
      referralData = await processReferralUsage(trimmedReferral, user.id);
    } catch (error) {
      logServerError("referral-processing", error);
    }
  }

  let otpData = null;
  try {
    otpData = await requestOtpVerification({ email: user.email });
  } catch (error) {
    logServerError("otp-generation", error);
  }

  return {
    user: pickPublicUser(user),
    profile: provisioned.profile,
    chartAccountCount: provisioned.chartAccountCount,
    verification: await verifyUserProvisioning(user.id),
    referral: referralData,
    otpSent: otpData?.success || false,
    requiresVerification: !user.verified_at,
    message: "Registration successful. Please verify your email to activate your account.",
  };
}

async function registerUserInTransaction(
  tx,
  { email, fullName, password, profileType, phone },
) {
  const normalizedEmail = normalizeEmail(email);
  const { normalizePhoneNumber } = require("../utils/twilio");
  const normalizedPhone = phone ? normalizePhoneNumber(phone) : null;

  if (!normalizedEmail) {
    throw ApiError.badRequest("Please enter a valid email address.", {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [
        {
          location: "body",
          field: "email",
          message: "Please enter a valid email address.",
        },
      ],
    });
  }

  const existingUser = await tx.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    throw ApiError.conflict("An account with this email address already exists. Please sign in instead.", {
      code: ERROR_CODES.EMAIL_ALREADY_EXISTS,
    });
  }

  if (normalizedPhone) {
    const existingPhoneUser = await tx.user.findUnique({
      where: { phone_number: normalizedPhone },
    });

    if (existingPhoneUser) {
      throw ApiError.conflict("An account with this phone number already exists. Please sign in instead.", {
        code: ERROR_CODES.PHONE_ALREADY_EXISTS,
      });
    }
  }

  if (!password || String(password).length < 8) {
    throw ApiError.badRequest("Password must be at least 8 characters long.", {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [
        {
          location: "body",
          field: "password",
          message: "Password must be at least 8 characters long.",
        },
      ],
    });
  }

  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const displayName = fullName?.trim() || normalizedEmail.split("@")[0];

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
}

async function loginUser({ email, password }) {
  const normalizedEmail = normalizeEmail(email);

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || user.deleted_at) {
    throw invalidCredentials();
  }

  if (user.google_id) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      "This account uses Google Sign-In. Please sign in with Google instead.",
      {
        code: ERROR_CODES.FORBIDDEN,
      },
    );
  }

  if (!user.password_hash) {
    throw invalidCredentials();
  }

  if (!user.verified_at) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      "Email verification required. Please verify your email before logging in.",
      {
        code: ERROR_CODES.VERIFICATION_REQUIRED,
      }
    );
  }

  const passwordMatches = await bcrypt.compare(
    String(password || ""),
    user.password_hash,
  );

  if (!passwordMatches) {
    throw invalidCredentials();
  }

  if (user.two_factor_enabled) {
    if (user.two_factor_method === "email" || user.two_factor_method === "sms") {
      try {
        const { requestTwoFactorVerification } = require("./twoFactor.service");
        await requestTwoFactorVerification(user.id);
      } catch (err) {
        logServerError("two-factor-login-request", err);
      }
    }
    return {
      requiresTwoFactor: true,
      twoFactorMethod: user.two_factor_method,
      userId: user.id,
      challengeToken: issueChallengeToken(user.id),
      message: "Two-factor authentication required",
    };
  }

  return {
    user: pickPublicUser(user),
    profile: await getActiveProfileForUser(user.id),
    session: buildSession(user),
  };
}

async function loginUserWithPhoneOrEmail({ identifier, password }) {
  const { normalizePhoneNumber } = require("../utils/twilio");
  const normalizedEmail = normalizeEmail(identifier);
  const normalizedPhone = normalizePhoneNumber(identifier);

  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    user = await prisma.user.findUnique({
      where: { phone_number: normalizedPhone },
    });
  }

  if (!user || user.deleted_at) {
    throw invalidCredentials("Invalid email, phone number, or password. Please check your credentials and try again.");
  }

  if (user.google_id) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      "This account uses Google Sign-In. Please sign in with Google instead.",
      {
        code: ERROR_CODES.FORBIDDEN,
      },
    );
  }

  if (!user.password_hash) {
    throw invalidCredentials("Invalid email, phone number, or password. Please check your credentials and try again.");
  }

  if (user.email === normalizedEmail && !user.verified_at) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      "Email verification required. Please verify your email before logging in.",
      {
        code: ERROR_CODES.VERIFICATION_REQUIRED,
      }
    );
  }

  if (user.phone_number === normalizedPhone && !user.phone_verified_at) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      "Phone verification required. Please verify your phone number before logging in.",
      {
        code: ERROR_CODES.PHONE_NOT_VERIFIED,
      }
    );
  }

  const passwordMatches = await bcrypt.compare(
    String(password || ""),
    user.password_hash,
  );

  if (!passwordMatches) {
    throw invalidCredentials("Invalid password");
  }

  if (user.two_factor_enabled) {
    if (user.two_factor_method === "email" || user.two_factor_method === "sms") {
      try {
        const { requestTwoFactorVerification } = require("./twoFactor.service");
        await requestTwoFactorVerification(user.id);
      } catch (err) {
        logServerError("two-factor-login-request", err);
      }
    }
    return {
      requiresTwoFactor: true,
      twoFactorMethod: user.two_factor_method,
      userId: user.id,
      challengeToken: issueChallengeToken(user.id),
      message: "Two-factor authentication required",
    };
  }

  return {
    user: pickPublicUser(user),
    profile: await getActiveProfileForUser(user.id),
    session: buildSession(user),
  };
}

async function completeLoginWithTwoFactor(userId, completionToken) {
  const verifiedUserId = consumeCompletionToken(completionToken);
  if (userId && verifiedUserId !== userId) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, "Two-factor verification mismatch.", {
      code: ERROR_CODES.UNAUTHORIZED,
    });
  }
  const user = await findActiveUserById(verifiedUserId);

  return {
    user: pickPublicUser(user),
    profile: await getActiveProfileForUser(user.id),
    session: buildSession(user),
  };
}

async function acceptInvitationPassword({ email, password, otp, token, authUserId }) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) {
    throw ApiError.badRequest("Valid email is required", { code: ERROR_CODES.VALIDATION_FAILED });
  }
  if (!password || String(password).length < 8) {
    throw ApiError.badRequest("Password must be at least 8 characters long.", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || user.deleted_at) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, "Invited account not found", {
      code: ERROR_CODES.USER_NOT_FOUND,
    });
  }

  let isVerifiedSession = Boolean(authUserId && authUserId === user.id);
  let decodedTokenData = null;

  if (!isVerifiedSession && token) {
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
      if (decoded && decoded.email && normalizeEmail(decoded.email) === normalizedEmail) {
        isVerifiedSession = true;
        decodedTokenData = decoded;
      }
    } catch {
      // Invalid token, fallback to OTP
    }
  }

  if (!isVerifiedSession) {
    const recentVerifiedOtp = await prisma.otpVerification.findFirst({
      where: {
        user_id: user.id,
        email: normalizedEmail,
        status: "verified",
        updated_at: { gt: new Date(Date.now() - 15 * 60 * 1000) },
      },
      orderBy: { updated_at: "desc" },
    });
    if (recentVerifiedOtp) {
      isVerifiedSession = true;
    } else if (otp && String(otp).length === 6) {
      const { verifyOtpCode } = require("./otp.service");
      await verifyOtpCode({ email: normalizedEmail, otp: String(otp) });
      isVerifiedSession = true;
    }
  }

  if (!isVerifiedSession) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      "Please verify your invitation link or enter the OTP code before setting your password.",
      { code: ERROR_CODES.VERIFICATION_REQUIRED }
    );
  }

  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      password_hash: passwordHash,
      verified_at: user.verified_at || new Date(),
      refresh_token_version: { increment: 1 },
    },
  });

  await linkHouseholdInvitationForUser(updatedUser.id, updatedUser.email, decodedTokenData || {});

  return {
    success: true,
    user: pickPublicUser(updatedUser),
    profile: await getActiveProfileForUser(updatedUser.id),
    session: buildSession(updatedUser),
  };
}

async function linkHouseholdInvitationForUser(userId, userEmail, invitationData = {}) {
  const normalizedEmail = normalizeEmail(userEmail);
  try {
    let matchingHouseholdProfiles = await prisma.childProfile.findMany({
      where: {
        email: { equals: normalizedEmail, mode: "insensitive" },
        deleted_at: null,
      },
    });

    // If no childProfile exists for this email, try to find the inviter and auto-create the childProfile
    if (matchingHouseholdProfiles.length === 0) {
      let inviterUserId = invitationData?.inviterId || null;
      let relationRole = invitationData?.relationRole || 'spouse_partner';

      if (!inviterUserId) {
        // Find most recent referral involving this user or email
        const recentReferral = await prisma.referral.findFirst({
          where: {
            OR: [
              { used_by: { has: userId } },
              { code: invitationData?.referralId || undefined },
              { short_id: invitationData?.referralId || undefined }
            ],
            deleted_at: null,
          },
          orderBy: { created_at: 'desc' }
        });
        if (recentReferral && recentReferral.referred_by_id !== userId) {
          inviterUserId = recentReferral.referred_by_id;
        }
      }

      if (inviterUserId) {
        // Find inviter's primary/owner profile
        const inviterMembership = await prisma.profileMembership.findFirst({
          where: {
            user_id: inviterUserId,
            role: 'owner',
            profile: {
              deleted_at: null,
              profile_type: { in: ['personal', 'family'] }
            }
          },
          include: { profile: true }
        }) || await prisma.profileMembership.findFirst({
          where: {
            user_id: inviterUserId,
            role: 'owner',
            profile: { deleted_at: null }
          },
          include: { profile: true }
        });

        if (inviterMembership?.profile) {
          const inviterProfile = inviterMembership.profile;
          const userRecord = await prisma.user.findUnique({ where: { id: userId } });
          const candidateName = userRecord?.full_name || invitationData?.userData?.fullName || 'Family Member';
          const parts = candidateName.trim().split(/\s+/);
          const firstName = parts[0] || 'Family';
          const lastName = parts.slice(1).join(' ') || firstName;
          const safeUsername = `${firstName.toLowerCase().replace(/[^a-z0-9]/g, '')}_${Date.now().toString(36).slice(-4)}_${Math.random().toString(36).substring(2, 5)}`;

          const newChild = await prisma.childProfile.create({
            data: {
              parent_profile_id: inviterProfile.id,
              parent_user_id: inviterUserId,
              unique_id: require('../utils/uniqueId').generateUniqueId?.() || Math.random().toString(36).substring(2, 12).toUpperCase(),
              first_name: firstName,
              last_name: lastName,
              name: candidateName,
              display_name: candidateName,
              username: safeUsername,
              email: normalizedEmail,
              avatar_url: userRecord?.avatar_url || null,
              family_role: relationRole,
              auth_user_id: userId,
              metadata: {
                family_role: relationRole,
                invitation_status: 'accepted',
                accepted_at: new Date().toISOString(),
              }
            }
          });

          matchingHouseholdProfiles = [newChild];
        }
      }
    }

    for (const hp of matchingHouseholdProfiles) {
      const existingMeta =
        hp.metadata && typeof hp.metadata === "object" && !Array.isArray(hp.metadata)
          ? hp.metadata
          : {};
      await prisma.childProfile.update({
        where: { id: hp.id },
        data: {
          auth_user_id: userId,
          metadata: {
            ...existingMeta,
            invitation_status: "accepted",
            accepted_at: new Date().toISOString(),
          },
        },
      });

      if (hp.parent_profile_id) {
        const isAdultCoOwner = [
          'spouse_partner',
          'spouse',
          'partner',
          'co_parent',
          'parent',
          'grandparent',
          'other',
        ].includes(String(hp.family_role || '').toLowerCase());
        const assignedRole = isAdultCoOwner ? 'admin' : 'editor';

        await prisma.profileMembership.upsert({
          where: {
            user_id_profile_id: {
              user_id: userId,
              profile_id: hp.parent_profile_id,
            },
          },
          update: {
            role: assignedRole,
          },
          create: {
            user_id: userId,
            profile_id: hp.parent_profile_id,
            role: assignedRole,
          },
        });
      }
    }

    const primaryHouseholdProfileId = matchingHouseholdProfiles.find(
      (hp) => hp.parent_profile_id
    )?.parent_profile_id;
    if (primaryHouseholdProfileId) {
      const existingSettings = await prisma.userSetting.findUnique({
        where: { user_id: userId },
      });
      const currentSettings =
        existingSettings?.settings && typeof existingSettings.settings === 'object'
          ? existingSettings.settings
          : {};
      await prisma.userSetting.upsert({
        where: { user_id: userId },
        update: {
          settings: {
            ...currentSettings,
            activeProfileId: primaryHouseholdProfileId,
          },
        },
        create: {
          user_id: userId,
          settings: {
            activeProfileId: primaryHouseholdProfileId,
          },
        },
      });
    }

    await prisma.profileInvitation.updateMany({
      where: {
        invited_email: { equals: normalizedEmail, mode: "insensitive" },
        status: "pending",
      },
      data: {
        status: "accepted",
        accepted_at: new Date(),
      },
    });
  } catch (linkErr) {
    logServerError("invitation-household-link", linkErr);
  }
}

async function acceptInvitationLogin({ email, password, invitationData }) {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user || user.deleted_at) {
    throw invalidCredentials();
  }

  if (user.google_id) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      "This account uses Google Sign-In. Please sign in with Google instead.",
      { code: ERROR_CODES.FORBIDDEN }
    );
  }

  if (!user.password_hash) {
    throw invalidCredentials();
  }

  const isPasswordValid = await bcrypt.compare(String(password), user.password_hash);
  if (!isPasswordValid) {
    throw invalidCredentials("Invalid password. Please check your credentials and try again.");
  }

  if (!user.verified_at) {
    await prisma.user.update({
      where: { id: user.id },
      data: { verified_at: new Date() },
    });
  }

  await linkHouseholdInvitationForUser(user.id, user.email, invitationData);

  return {
    success: true,
    user: pickPublicUser(user),
    profile: await getActiveProfileForUser(user.id),
    session: buildSession(user),
  };
}

async function acceptInvitationForAuthenticatedUser(userId, invitedEmail, invitationData) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || user.deleted_at) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, "User not found", {
      code: ERROR_CODES.USER_NOT_FOUND,
    });
  }

  const targetEmail = invitedEmail || user.email;
  await linkHouseholdInvitationForUser(user.id, targetEmail, invitationData || {});

  return {
    success: true,
    user: pickPublicUser(user),
    profile: await getActiveProfileForUser(user.id),
  };
}

async function getInvitationStatus(email) {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      full_name: true,
      verified_at: true,
      password_hash: true,
      google_id: true,
    },
  });

  if (!user) {
    return {
      exists: false,
      isVerified: false,
      hasPassword: false,
      needsPasswordSetup: false,
    };
  }

  const hasRealPassword = Boolean(user.verified_at && user.password_hash);

  return {
    exists: true,
    isVerified: Boolean(user.verified_at),
    hasPassword: hasRealPassword,
    needsPasswordSetup: !hasRealPassword,
    isGoogleUser: Boolean(user.google_id),
    fullName: user.full_name,
    email: user.email,
  };
}



async function loginChildUser({ usernameOrEmail, pin }) {
  const loginId = String(usernameOrEmail || "")
    .trim()
    .toLowerCase();

  if (!loginId || !pin) {
    throw invalidCredentials("Invalid username or PIN");
  }

  const childProfile = await prisma.childProfile.findFirst({
    where: {
      deleted_at: null,
      is_active: true,
      OR: [
        {
          username: {
            equals: loginId,
            mode: "insensitive",
          },
        },
        {
          email: {
            equals: loginId,
            mode: "insensitive",
          },
        },
      ],
    },
  });

  if (!childProfile) {
    throw invalidCredentials("Invalid username or PIN");
  }

  const metadata =
    childProfile.metadata &&
    typeof childProfile.metadata === "object" &&
    !Array.isArray(childProfile.metadata)
      ? childProfile.metadata
      : {};

  if (
    !metadata.login_enabled ||
    !childProfile.pin_hash ||
    !childProfile.auth_user_id
  ) {
    await logChildLoginAttempt(
      childProfile.id,
      false,
      "Child login is not enabled",
    );
    throw invalidCredentials(
      "This child account has not been set up yet. Please contact your parent.",
    );
  }

  if (childProfile.locked_until && childProfile.locked_until > new Date()) {
    await logChildLoginAttempt(childProfile.id, false, "Account locked");
    throw invalidCredentials("Account is locked. Please contact your parent.");
  }

  const pinMatches = await bcrypt.compare(
    String(pin || ""),
    childProfile.pin_hash,
  );

  if (!pinMatches) {
    const failedAttempts = childProfile.failed_login_attempts + 1;
    const shouldLock = failedAttempts >= 5;

    await prisma.childProfile.update({
      where: {
        id: childProfile.id,
      },
      data: {
        failed_login_attempts: failedAttempts,
        locked_until: shouldLock
          ? new Date(Date.now() + 24 * 60 * 60 * 1000)
          : null,
      },
    });

    await logChildLoginAttempt(
      childProfile.id,
      false,
      `Invalid PIN attempt ${failedAttempts}`,
    );
    throw invalidCredentials("Invalid username or PIN");
  }

  const user = await prisma.user.findFirst({
    where: {
      id: childProfile.auth_user_id,
      deleted_at: null,
    },
  });

  if (!user) {
    await logChildLoginAttempt(childProfile.id, false, "Auth user inactive");
    throw invalidCredentials(
      "This child account has not been set up yet. Please contact your parent.",
    );
  }

  await prisma.childProfile.update({
    where: {
      id: childProfile.id,
    },
    data: {
      failed_login_attempts: 0,
      locked_until: null,
      last_login_at: new Date(),
    },
  });

  await logChildLoginAttempt(childProfile.id, true);

  return {
    user: pickPublicUser(user),
    profile: null,
    childProfile: {
      id: childProfile.id,
      parent_profile_id: childProfile.parent_profile_id,
      display_name: childProfile.display_name || childProfile.name,
      child_name: childProfile.display_name || childProfile.name,
      username: childProfile.username,
    },
    session: buildSession(user),
  };
}

async function refreshSession(refreshToken) {
  if (!refreshToken) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, "Refresh token is required", {
      code: ERROR_CODES.REFRESH_TOKEN_REQUIRED,
    });
  }

  const payload = verifyJwt(refreshToken, env.jwtRefreshSecret, "refresh");
  const user = await findActiveUserById(payload.sub);

  if (payload.tokenVersion !== user.refresh_token_version) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, "Invalid refresh token", {
      code: ERROR_CODES.INVALID_TOKEN,
    });
  }

  return {
    user: pickPublicUser(user),
    profile: await getActiveProfileForUser(user.id),
    session: buildSession(user),
  };
}

async function logoutUser(refreshToken) {
  if (!refreshToken) {
    return { loggedOut: true };
  }

  try {
    const payload = verifyJwt(refreshToken, env.jwtRefreshSecret, "refresh");

    await prisma.user.updateMany({
      where: {
        id: payload.sub,
        refresh_token_version: payload.tokenVersion,
      },
      data: {
        refresh_token_version: { increment: 1 },
      },
    });
  } catch (_error) {
    // Logout is intentionally idempotent. Clearing the cookie is enough if the token is already invalid.
  }

  return { loggedOut: true };
}

async function getCurrentUser(userId) {
  const user = await findActiveUserById(userId);

  return {
    user: pickPublicUser(user),
    profile: await getActiveProfileForUser(user.id),
    verification: await verifyUserProvisioning(user.id),
  };
}

async function updateUserPassword(userId, input = {}) {
  const user = await findActiveUserById(userId);
  const currentPassword = String(
    input.currentPassword ?? input.current_password ?? "",
  );
  const newPassword = String(
    input.newPassword ?? input.new_password ?? input.password ?? "",
  );
  const hasLocalPassword = Boolean(user.password_hash);
  const isGoogleUser = Boolean(user.google_id);

  if (isGoogleUser) {
    throw ApiError.badRequest(
      "Users who sign in with Google cannot change their password from within the app, as their passwords are managed by Google.",
      {
        code: ERROR_CODES.VALIDATION_FAILED,
      },
    );
  }

  if (!hasLocalPassword) {
    throw ApiError.badRequest(
      "Password updates are not available for this account",
      {
        code: ERROR_CODES.VALIDATION_FAILED,
      },
    );
  }

  if (newPassword.length < 8) {
    throw ApiError.badRequest("Password must be at least 8 characters", {
      code: ERROR_CODES.VALIDATION_FAILED,
      details: [
        {
          location: "body",
          field: "newPassword",
          message: "Must be at least 8 characters",
        },
      ],
    });
  }

  if (!currentPassword) {
    throw ApiError.badRequest("Current password is required", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const passwordMatches = await bcrypt.compare(
    currentPassword,
    user.password_hash,
  );
  if (!passwordMatches) {
    throw invalidCredentials("Current password is incorrect");
  }

  const isSamePassword =
    currentPassword === newPassword ||
    (await bcrypt.compare(newPassword, user.password_hash));
  if (isSamePassword) {
    throw ApiError.badRequest(
      "New password must be different from your current password",
      {
        code: ERROR_CODES.VALIDATION_FAILED,
      },
    );
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      password_hash: passwordHash,
      refresh_token_version: { increment: 1 },
    },
  });

  return {
    passwordUpdated: true,
    user: pickPublicUser(updatedUser),
    session: buildSession(updatedUser),
  };
}

async function requestPasswordReset({ email, clientOrigin }) {
  const normalizedEmail = normalizeEmail(email);
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  const publicMessage =
    "If an account exists for this email, a password reset link will be sent.";
  let resetToken = null;
  const { isEmailConfigured } = require("../utils/email");

  if (!isEmailConfigured() && !env.mailApiKey) {
    throw new ApiError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      "We could not send email right now. Please try again later.",
      { code: ERROR_CODES.SERVICE_UNAVAILABLE }
    );
  }

  if (user && !user.deleted_at && !user.google_id) {
    const rawToken = signJwt(
      {
        sub: user.id,
        type: "password_reset",
        jti: randomUUID(),
      },
      env.jwtPasswordResetSecret,
      env.passwordResetTtlMinutes * 60,
    );

    await prisma.user.update({
      where: { id: user.id },
      data: {
        password_reset_token_hash: hashToken(rawToken),
      },
    });

    const baseResetUrl =
      clientOrigin && env.passwordResetUrl.includes("localhost")
        ? `${clientOrigin.replace(/\/$/, "")}/reset-password`
        : env.passwordResetUrl;
    const resetUrl = new URL(baseResetUrl);
    resetUrl.searchParams.set("token", rawToken);

    try {
      await sendPasswordResetEmail({
        to: user.email,
        resetUrl: resetUrl.toString(),
        expiresInMinutes: env.passwordResetTtlMinutes,
      });
    } catch (error) {
      logServerError("password-reset-email", error);
      await prisma.user.update({
        where: { id: user.id },
        data: { password_reset_token_hash: null }
      });
      throw new ApiError(
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        "We could not send email right now. Please try again later.",
        { code: ERROR_CODES.SERVICE_UNAVAILABLE }
      );
    }

    if (!env.isProduction) {
      resetToken = rawToken;
    }
  }

  return {
    message: publicMessage,
    resetToken,
    expiresInMinutes: resetToken ? env.passwordResetTtlMinutes : undefined,
  };
}

async function resetPassword({ token, password }) {
  let payload;

  try {
    payload = verifyJwt(token, env.jwtPasswordResetSecret, "password_reset");
  } catch (_error) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      "Password reset token is invalid or expired",
      {
        code: ERROR_CODES.PASSWORD_RESET_TOKEN_INVALID,
      },
    );
  }

  const user = await prisma.user.findFirst({
    where: {
      id: payload.sub,
      deleted_at: null,
    },
  });

  if (!user || !compareTokenHash(token, user.password_reset_token_hash)) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      "Password reset token is invalid or expired",
      {
        code: ERROR_CODES.PASSWORD_RESET_TOKEN_INVALID,
      },
    );
  }

  if (user.google_id) {
    throw new ApiError(
      HTTP_STATUS.FORBIDDEN,
      "This account uses Google Sign-In. Password reset is not available for Google-authenticated accounts.",
      {
        code: ERROR_CODES.FORBIDDEN,
      },
    );
  }

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

  const passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      password_hash: passwordHash,
      password_reset_token_hash: null,
      refresh_token_version: { increment: 1 },
    },
  });

  return { passwordReset: true, email: user.email };
}

function getGoogleAuthorizationUrl() {
  assertGoogleOAuthConfigured();

  const stateToken = signJwt(
    {
      type: "google_oauth_state",
      nonce: randomBytes(16).toString("hex"),
    },
    env.jwtAccessSecret,
    10 * 60,
  );

  const authorizationUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  authorizationUrl.searchParams.set("client_id", env.googleOAuthClientId);
  authorizationUrl.searchParams.set("redirect_uri", env.googleOAuthRedirectUrl);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("scope", "openid email profile");
  authorizationUrl.searchParams.set("state", stateToken);
  authorizationUrl.searchParams.set("prompt", "select_account");

  return {
    authorizationUrl: authorizationUrl.toString(),
    stateToken,
  };
}

async function completeGoogleOAuth({ code, state, expectedState }) {
  assertGoogleOAuthConfigured();

  if (!code || !state || !expectedState || state !== expectedState) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      "Google OAuth state is invalid or expired",
      {
        code: ERROR_CODES.INVALID_TOKEN,
      },
    );
  }

  verifyJwt(state, env.jwtAccessSecret, "google_oauth_state");

  const tokens = await exchangeGoogleAuthorizationCode(code);
  const googleUser = await fetchGoogleUserInfo(tokens.access_token);
  const user = await findOrProvisionGoogleUser(googleUser);

  if (user.two_factor_enabled) {
    if (user.two_factor_method === "email" || user.two_factor_method === "sms") {
      try {
        const { requestTwoFactorVerification } = require("./twoFactor.service");
        await requestTwoFactorVerification(user.id);
      } catch (err) {
        logServerError("two-factor-google-login-request", err);
      }
    }
    return {
      requiresTwoFactor: true,
      twoFactorMethod: user.two_factor_method,
      userId: user.id,
      challengeToken: issueChallengeToken(user.id),
      message: "Two-factor authentication required",
    };
  }

  return {
    user: pickPublicUser(user),
    profile: await getActiveProfileForUser(user.id),
    session: buildSession(user),
  };
}

async function exchangeGoogleAuthorizationCode(code) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: env.googleOAuthClientId,
      client_secret: env.googleOAuthClientSecret,
      redirect_uri: env.googleOAuthRedirectUrl,
      grant_type: "authorization_code",
    }),
  });
  const body = await parseGoogleJsonResponse(response);

  if (!response.ok || !body.access_token) {
    throw googleOAuthFailed("Google OAuth token exchange failed");
  }

  return body;
}

async function fetchGoogleUserInfo(accessToken) {
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );
  const body = await parseGoogleJsonResponse(response);

  if (!response.ok || !body.sub || !body.email) {
    throw googleOAuthFailed("Google OAuth user lookup failed");
  }

  if (body.email_verified !== true) {
    throw new ApiError(
      HTTP_STATUS.UNAUTHORIZED,
      "Google account email must be verified",
      {
        code: ERROR_CODES.GOOGLE_OAUTH_EMAIL_UNVERIFIED,
      },
    );
  }

  return {
    googleId: String(body.sub),
    email: normalizeEmail(body.email),
    fullName: body.name || body.given_name || null,
    avatarUrl: body.picture || null,
  };
}

async function parseGoogleJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function findOrProvisionGoogleUser(googleUser) {
  const googleIdUser = await prisma.user.findUnique({
    where: { google_id: googleUser.googleId },
  });

  if (googleIdUser) {
    if (googleIdUser.deleted_at) {
      throw invalidCredentials("Google account is not active");
    }

    if (googleIdUser.password_hash || googleIdUser.password_reset_token_hash) {
      return prisma.user.update({
        where: { id: googleIdUser.id },
        data: {
          password_hash: null,
          password_reset_token_hash: null,
        },
      });
    }

    return googleIdUser;
  }

  const emailUser = await prisma.user.findUnique({
    where: { email: googleUser.email },
  });

  if (emailUser) {
    if (emailUser.deleted_at) {
      throw invalidCredentials("Google account is not active");
    }

    if (emailUser.google_id && emailUser.google_id !== googleUser.googleId) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        "This email is already linked to a different Google account",
        {
          code: ERROR_CODES.GOOGLE_OAUTH_ACCOUNT_CONFLICT,
        },
      );
    }

    return prisma.user.update({
      where: { id: emailUser.id },
      data: {
        google_id: googleUser.googleId,
        password_hash: null,
        password_reset_token_hash: null,
        verified_at: emailUser.verified_at || new Date(),
        avatar_url: emailUser.avatar_url || googleUser.avatarUrl,
      },
    });
  }

  const displayName = googleUser.fullName || googleUser.email.split("@")[0];
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email: googleUser.email,
        user_name: generateUniqueUsername(displayName, displayName),
        unique_id: generateUniqueId(),
        google_id: googleUser.googleId,
        full_name: displayName,
        avatar_url: googleUser.avatarUrl,
        verified_at: new Date(),
      },
    });

    const provisioned = await provisionProfileForUser(tx, user, {
      displayName,
      profileType: "personal",
    });

    return {
      user,
      profile: provisioned.profile,
      chartAccountCount: provisioned.chartAccountCount,
    };
  });

  return result.user;
}

function assertGoogleOAuthConfigured() {
  if (
    !env.googleOAuthClientId ||
    !env.googleOAuthClientSecret ||
    !env.googleOAuthRedirectUrl
  ) {
    throw new ApiError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      "Google OAuth is not configured",
      {
        code: ERROR_CODES.GOOGLE_OAUTH_NOT_CONFIGURED,
      },
    );
  }
}

function googleOAuthFailed(message) {
  return new ApiError(HTTP_STATUS.UNAUTHORIZED, message, {
    code: ERROR_CODES.GOOGLE_OAUTH_FAILED,
  });
}

async function findActiveUserById(userId) {
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      deleted_at: null,
    },
  });

  if (!user) {
    throw new ApiError(HTTP_STATUS.UNAUTHORIZED, "Authentication required", {
      code: ERROR_CODES.UNAUTHORIZED,
    });
  }

  return user;
}

function verifyAccessToken(accessToken) {
  return verifyJwt(accessToken, env.jwtAccessSecret, "access");
}

function invalidCredentials(message = "Invalid email or password. Please check your credentials and try again.") {
  return new ApiError(HTTP_STATUS.UNAUTHORIZED, message, {
    code: ERROR_CODES.INVALID_CREDENTIALS,
  });
}

async function logChildLoginAttempt(
  childProfileId,
  success,
  failureReason = null,
) {
  await prisma.childLoginAuditLog.create({
    data: {
      child_profile_id: childProfileId,
      success,
      failure_reason: failureReason,
    },
  });
}

async function verifyUserPassword(userId, password) {
  const user = await findActiveUserById(userId);

  if (!user.password_hash) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      "Password verification is not available for this account",
      {
        code: ERROR_CODES.VALIDATION_FAILED,
      }
    );
  }

  const passwordMatches = await bcrypt.compare(
    String(password || ""),
    user.password_hash,
  );

  if (!passwordMatches) {
    throw invalidCredentials("Invalid password");
  }

  return {
    verified: true,
  };
}

async function searchUsers(searchQuery) {
  if (!searchQuery || String(searchQuery).trim().length < 2) {
    return { users: [] };
  }

  const query = String(searchQuery).trim();

  // 1. Search registered users
  const users = await prisma.user.findMany({
    where: {
      deleted_at: null,
      OR: [
        {
          email: {
            contains: query,
            mode: 'insensitive',
          },
        },
        {
          user_name: {
            contains: query,
            mode: 'insensitive',
          },
        },
        {
          full_name: {
            contains: query,
            mode: 'insensitive',
          },
        },
        {
          unique_id: {
            contains: query,
            mode: 'insensitive',
          },
        },
      ],
    },
    take: 20,
  });

  // 2. Search child & family profiles where visible_for_everyone is enabled
  let visibleChildUsers = [];
  try {
    const childProfiles = await prisma.childProfile.findMany({
      where: {
        deleted_at: null,
        OR: [
          {
            unique_id: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            username: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            display_name: {
              contains: query,
              mode: 'insensitive',
            },
          },
          {
            email: {
              contains: query,
              mode: 'insensitive',
            },
          },
        ],
      },
      take: 20,
    });

    visibleChildUsers = childProfiles
      .filter((child) => {
        const metadata = child.metadata && typeof child.metadata === 'object' && !Array.isArray(child.metadata)
          ? child.metadata
          : {};
        return Boolean(metadata.visible_for_everyone || metadata.is_visible_by_unique_id);
      })
      .map((child) => ({
        id: child.id,
        user_id: child.auth_user_id || child.id,
        unique_id: child.unique_id,
        email: child.email,
        user_name: child.username,
        display_name: child.display_name || child.name,
        full_name: child.name || child.display_name,
        avatar_url: child.avatar_url,
        is_child_profile: true,
      }));
  } catch (err) {
    console.warn('Error searching child profiles in searchUsers:', err);
  }

  const userResults = users.map(pickPublicUser);

  return {
    users: [...userResults, ...visibleChildUsers],
  };
}

async function deleteUserAccount({ userId, password, transferOwnerUserId = null }) {
  await verifyUserPassword(userId, password);

  const ownedProfiles = await prisma.profile.findMany({
    where: { owner_user_id: userId, deleted_at: null }
  });

  for (const profile of ownedProfiles) {
    const otherMembers = await prisma.profileMembership.count({
      where: { profile_id: profile.id, user_id: { not: userId } }
    });
    if (otherMembers > 0 && !transferOwnerUserId) {
      throw new ApiError(
        HTTP_STATUS.CONFLICT,
        "Transfer ownership of shared profiles before deleting this account.",
        { code: ERROR_CODES.CONFLICT }
      );
    }
    if (otherMembers > 0) {
      const targetMembership = await prisma.profileMembership.findFirst({
        where: { profile_id: profile.id, user_id: transferOwnerUserId }
      });
      if (!targetMembership) {
        throw ApiError.badRequest("The new owner must already be a member of the shared profile");
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const profile of ownedProfiles) {
      const otherMembers = await tx.profileMembership.count({
        where: { profile_id: profile.id, user_id: { not: userId } }
      });
      if (otherMembers > 0 && transferOwnerUserId) {
        const targetHasDefault = await tx.profile.findFirst({
          where: {
            owner_user_id: transferOwnerUserId,
            is_default: true,
            deleted_at: null
          }
        });
        await tx.profile.update({
          where: { id: profile.id },
          data: {
            owner_user_id: transferOwnerUserId,
            is_default: targetHasDefault ? false : profile.is_default
          }
        });
        await tx.profileMembership.updateMany({
          where: { profile_id: profile.id, user_id: transferOwnerUserId },
          data: { role: "owner" }
        });
      } else {
        await tx.profile.update({
          where: { id: profile.id },
          data: { is_active: false, deleted_at: new Date() }
        });
      }
    }

    await tx.profileMembership.deleteMany({ where: { user_id: userId } });
    await tx.childProfile.updateMany({
      where: { auth_user_id: userId },
      data: { auth_user_id: null }
    });
    await tx.user.update({
      where: { id: userId },
      data: {
        deleted_at: new Date(),
        email: `deleted.${userId}@users.invalid`,
        phone_number: null,
        password_reset_token_hash: null,
        refresh_token_version: { increment: 1 }
      }
    });
  });

  return { deleted: true };
}

module.exports = {
  registerUser,
  registerUserInTransaction,
  loginUser,
  loginUserWithPhoneOrEmail,
  completeLoginWithTwoFactor,
  acceptInvitationPassword,
  acceptInvitationLogin,
  acceptInvitationForAuthenticatedUser,
  getInvitationStatus,
  loginChildUser,
  refreshSession,
  logoutUser,
  getCurrentUser,
  updateUserPassword,
  requestPasswordReset,
  resetPassword,
  deleteUserAccount,
  getGoogleAuthorizationUrl,
  completeGoogleOAuth,
  verifyAccessToken,
  verifyUserPassword,
  searchUsers,
};
