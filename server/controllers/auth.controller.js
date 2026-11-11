const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const {
  getCookie,
  setRefreshCookie,
  clearRefreshCookie,
  setOAuthStateCookie,
  clearOAuthStateCookie
} = require('../utils/cookies');
const { env } = require('../config/env');
const {
  registerUser,
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
  verifyUserPassword,
  searchUsers
} = require('../services/auth.service');
const { verifySecretKey } = require('../services/secretKey.service');

const register = asyncHandler(async (req, res) => {
  const { referral, ...body } = req.body;
  const result = await registerUser({ ...body, referral });

  if (result.session && result.session.refreshToken) {
    setRefreshCookie(res, result.session.refreshToken);
    return created(res, withoutRefreshToken(result));
  }

  return created(res, result);
});

const login = asyncHandler(async (req, res) => {
  const result = await loginUser(req.body);
  
  if (result.requiresTwoFactor) {
    return ok(res, result);
  }
  
  setRefreshCookie(res, result.session.refreshToken);

  return ok(res, withoutRefreshToken(result));
});

const loginWithPhoneOrEmail = asyncHandler(async (req, res) => {
  const result = await loginUserWithPhoneOrEmail(req.body);
  
  if (result.requiresTwoFactor) {
    return ok(res, result);
  }
  
  setRefreshCookie(res, result.session.refreshToken);

  return ok(res, withoutRefreshToken(result));
});

const phoneLogin = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;
  const { normalizePhoneNumber } = require('../utils/twilio');
  const normalizedPhone = normalizePhoneNumber(phone);
  
  if (password) {
    const result = await loginUserWithPhoneOrEmail({ identifier: phone, password });
    
    if (result.requiresTwoFactor) {
      return ok(res, result);
    }
    
    setRefreshCookie(res, result.session.refreshToken);
    return ok(res, withoutRefreshToken(result));
  }
  
  const { prisma } = require('../config/database');
  const user = await prisma.user.findUnique({
    where: { phone_number: normalizedPhone },
  });

  if (!user || user.deleted_at) {
    throw new ApiError(
      HTTP_STATUS.NOT_FOUND,
      'No account found with this phone number',
      {
        code: ERROR_CODES.USER_NOT_FOUND,
      }
    );
  }

  if (!user.phone_verified_at) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'Phone number not verified. Please verify your phone number first.',
      {
        code: ERROR_CODES.PHONE_NOT_VERIFIED,
      }
    );
  }

  return ok(res, {
    success: true,
    phone: normalizedPhone,
    message: 'Phone number found. Please request verification code.',
    userId: user.id,
  });
});

const childLogin = asyncHandler(async (req, res) => {
  const result = await loginChildUser(req.body);
  setRefreshCookie(res, result.session.refreshToken);

  return ok(res, withoutRefreshToken(result));
});

const refresh = asyncHandler(async (req, res) => {
  const result = await refreshSession(getCookie(req, env.refreshCookieName));
  setRefreshCookie(res, result.session.refreshToken);

  return ok(res, withoutRefreshToken(result));
});

const logout = asyncHandler(async (req, res) => {
  const result = await logoutUser(getCookie(req, env.refreshCookieName));
  clearRefreshCookie(res);

  return ok(res, result);
});

const me = asyncHandler(async (req, res) => {
  return ok(res, await getCurrentUser(req.auth.sub));
});

const changePassword = asyncHandler(async (req, res) => {
  const result = await updateUserPassword(req.auth.sub, req.body);
  setRefreshCookie(res, result.session.refreshToken);

  return ok(res, withoutRefreshToken(result));
});

const deleteAccount = asyncHandler(async (req, res) => {
  const result = await deleteUserAccount({
    userId: req.auth.sub,
    password: req.body.password,
    transferOwnerUserId: req.body.transferOwnerUserId || req.body.transfer_owner_user_id || null
  });
  clearRefreshCookie(res);
  return ok(res, result);
});

const forgotPassword = asyncHandler(async (req, res) => {
  const requestOrigin = req.get('origin') || (req.get('referer') ? new URL(req.get('referer')).origin : null);
  return ok(res, await requestPasswordReset({ ...req.body, clientOrigin: requestOrigin }));
});

const resetUserPassword = asyncHandler(async (req, res) => {
  const result = await resetPassword(req.body);
  clearRefreshCookie(res);

  return ok(res, result);
});

const startGoogleOAuth = asyncHandler(async (_req, res) => {
  const { authorizationUrl, stateToken } = getGoogleAuthorizationUrl();
  setOAuthStateCookie(res, stateToken);

  return res.redirect(authorizationUrl);
});

const googleOAuthCallback = asyncHandler(async (req, res) => {
  clearOAuthStateCookie(res);

  if (req.query.error) {
    return redirectGoogleOAuthFailure(res, req.query.error);
  }

  let result;

  try {
    result = await completeGoogleOAuth({
      code: req.query.code,
      state: req.query.state,
      expectedState: getCookie(req, env.oauthStateCookieName)
    });
  } catch (error) {
    return redirectGoogleOAuthFailure(res, error.code || error.message || 'google_oauth_failed');
  }

  if (result.requiresTwoFactor) {
    const loginBaseUrl = new URL(env.googleOAuthFailureRedirectUrl || `${env.clientSiteUrl}/login`);
    loginBaseUrl.searchParams.set('step', '2fa');
    loginBaseUrl.searchParams.set('userId', result.userId);
    loginBaseUrl.searchParams.set('method', result.twoFactorMethod || 'email');
    if (result.challengeToken) {
      loginBaseUrl.searchParams.set('challengeToken', result.challengeToken);
    }
    return res.redirect(loginBaseUrl.toString());
  }

  setRefreshCookie(res, result.session.refreshToken);

  const redirectUrl = new URL(env.googleOAuthSuccessRedirectUrl);
  const session = withoutRefreshToken(result).session;
  redirectUrl.hash = new URLSearchParams({
    provider: 'google',
    access_token: session.accessToken,
    token_type: session.tokenType,
    expires_in: String(session.expiresIn)
  }).toString();

  return res.redirect(redirectUrl.toString());
});

function redirectGoogleOAuthFailure(res, error) {
  const redirectUrl = new URL(env.googleOAuthFailureRedirectUrl);
  redirectUrl.searchParams.set('auth_error', String(error || 'google_oauth_failed'));

  return res.redirect(redirectUrl.toString());
}

const searchUsersHandler = asyncHandler(async (req, res) => {
  const { q } = req.query;
  const result = await searchUsers(q);
  return ok(res, result);
});

const checkUserExists = asyncHandler(async (req, res) => {
  const { email } = req.query;
  const { prisma } = require('../config/database');
  const { normalizeEmail } = require('../services/provisioning.helpers');

  if (!email) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'Email is required',
      {
        code: ERROR_CODES.VALIDATION_FAILED,
      }
    );
  }

  const normalizedEmail = normalizeEmail(email);
  const existingUser = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      email: true,
      full_name: true,
      unique_id: true,
      created_at: true,
    },
  });

  return ok(res, {
    exists: !!existingUser,
    user: existingUser ? {
      id: existingUser.id,
      email: existingUser.email,
      full_name: existingUser.full_name,
      unique_id: existingUser.unique_id,
      created_at: existingUser.created_at,
    } : null,
  });
});


const validateReferralHandler = asyncHandler(async (req, res) => {
  const { code } = req.query;
  const { validateReferralForSignup } = require('../services/referral.service');
  const result = await validateReferralForSignup(code);
  return ok(res, result);
});

const createInvitedUser = asyncHandler(async (req, res) => {
  const { email, fullName, referral, inviterName, profileType } = req.body;
  const { randomBytes } = require('crypto');
  const { provisionNewUser } = require('../services/provisioning.service');
  const { prisma } = require('../config/database');

  if (!email || !fullName) {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'Email and full name are required',
      {
        code: ERROR_CODES.VALIDATION_FAILED,
      }
    );
  }

  const tempPassword = randomBytes(16).toString('hex');

  const provisioned = await provisionNewUser({
    email,
    fullName,
    password: tempPassword,
    profileType: profileType || 'personal',
    phone: null,
  });

  await prisma.user.update({
    where: { id: provisioned.user.id },
    data: {
      password_hash: null,
      verified_at: null,
    },
  });

  let referralData = null;
  if (referral && referral.trim()) {
    const { validateReferralForSignup, processReferralUsage } = require('../services/referral.service');
    const validation = await validateReferralForSignup(referral.trim());
    if (!validation.valid) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        validation.reason || 'Invalid referral code',
        {
          code: ERROR_CODES.VALIDATION_FAILED,
          details: [{ location: 'body', field: 'referral', message: validation.reason || 'Invalid referral code' }],
        }
      );
    }
    referralData = await processReferralUsage(referral.trim(), provisioned.user.id);
  }

  return created(res, {
    success: true,
    user: provisioned.user,
    profile: provisioned.profile,
    tempPassword, 
    message: 'User created successfully (unverified)',
  });
});

const verifyPasswordHandler = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const result = await verifyUserPassword(req.auth.sub, password);
  return ok(res, result);
});

const { issueVaultAccessToken } = require('../middleware/requireVaultElevation');

const verifyIdentityHandler = asyncHandler(async (req, res) => {
  const { method, password, secretKey } = req.body;

  if (method === 'password') {
    if (!password) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        'Password is required',
        {
          code: ERROR_CODES.VALIDATION_FAILED,
        }
      );
    }
    await verifyUserPassword(req.auth.sub, password);
    return ok(res, {
      verified: true,
      method: 'password',
      vaultAccessToken: issueVaultAccessToken(req.auth.sub)
    });
  } else if (method === 'secretKey') {
    if (!secretKey) {
      throw new ApiError(
        HTTP_STATUS.BAD_REQUEST,
        'Secret key is required',
        {
          code: ERROR_CODES.VALIDATION_FAILED,
        }
      );
    }
    await verifySecretKey(req.auth.sub, secretKey);
    return ok(res, {
      verified: true,
      method: 'secretKey',
      vaultAccessToken: issueVaultAccessToken(req.auth.sub)
    });
  } else {
    throw new ApiError(
      HTTP_STATUS.BAD_REQUEST,
      'Invalid verification method',
      {
        code: ERROR_CODES.VALIDATION_FAILED,
      }
    );
  }
});

const completeTwoFactorLogin = asyncHandler(async (req, res) => {
  const { userId, completionToken } = req.body;
  const result = await completeLoginWithTwoFactor(userId, completionToken);
  setRefreshCookie(res, result.session.refreshToken);

  return ok(res, withoutRefreshToken(result));
});

const acceptInvitationPasswordHandler = asyncHandler(async (req, res) => {
  const result = await acceptInvitationPassword({
    ...req.body,
    authUserId: req.auth?.sub,
  });
  setRefreshCookie(res, result.session.refreshToken);

  return ok(res, withoutRefreshToken(result));
});

const getInvitationStatusHandler = asyncHandler(async (req, res) => {
  const { email } = req.query;
  if (!email) {
    throw ApiError.badRequest("Email is required");
  }
  const result = await getInvitationStatus(email);
  return ok(res, result);
});

const acceptInvitationLoginHandler = asyncHandler(async (req, res) => {
  const result = await acceptInvitationLogin(req.body);
  setRefreshCookie(res, result.session.refreshToken);
  return ok(res, withoutRefreshToken(result));
});

const acceptInvitationAuthenticatedHandler = asyncHandler(async (req, res) => {
  const result = await acceptInvitationForAuthenticatedUser(
    req.auth.sub,
    req.body.email,
    req.body.invitationData
  );
  return ok(res, result);
});

function withoutRefreshToken(result) {
  const { refreshToken: _refreshToken, ...session } = result.session;

  return {
    ...result,
    session
  };
}

module.exports = {
  register,
  login,
  loginWithPhoneOrEmail,
  phoneLogin,
  childLogin,
  refresh,
  logout,
  me,
  changePassword,
  forgotPassword,
  deleteAccount,
  resetUserPassword,
  startGoogleOAuth,
  googleOAuthCallback,
  verifyPasswordHandler,
  verifyIdentityHandler,
  completeTwoFactorLogin,
  acceptInvitationPasswordHandler,
  getInvitationStatusHandler,
  validateReferralHandler,
  acceptInvitationLoginHandler,
  acceptInvitationAuthenticatedHandler,
  searchUsersHandler,
  checkUserExists,
  createInvitedUser,
};
