const { prisma } = require("../config/database");
const { ApiError } = require("../middleware/errorHandler");
const { ERROR_CODES, HTTP_STATUS } = require("../constants/errorCodes");
const { logServerError } = require("../utils/safeLogger");
const { sendEmail, generateEmailTemplate, escapeHtml } = require("../utils/mail");
const { env } = require("../config/env");

function generateShortId() {
  const characters =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let shortId = "";
  for (let i = 0; i < 8; i++) {
    shortId += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return shortId;
}

function extractReferralCode(input) {
  if (!input || typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  try {
    if (trimmed.includes('http://') || trimmed.includes('https://') || trimmed.startsWith('/') || trimmed.includes('?')) {
      const urlStr = trimmed.startsWith('http') ? trimmed : ('http://dummy.local/' + trimmed.replace(/^\/+/, ''));
      const parsed = new URL(urlStr);
      const code = parsed.searchParams.get('referral') || parsed.searchParams.get('ref') || parsed.searchParams.get('code');
      if (code) return code.trim();
    }
  } catch (e) {
    // fallback
  }

  const match = trimmed.match(/[?&](?:referral|ref|code)=([^&#\s]+)/i);
  if (match && match[1]) {
    return decodeURIComponent(match[1]).trim();
  }

  return trimmed;
}


function generateReferralCode() {
  const characters =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let referralCode = "";
  for (let i = 0; i < 12; i++) {
    referralCode += characters.charAt(
      Math.floor(Math.random() * characters.length),
    );
  }
  return referralCode;
}

async function createReferral(userId, rawInput = {}) {
  const input = rawInput.payload ? { ...rawInput.payload, ...rawInput } : rawInput;
  const shortId = generateShortId();
  const code = input.code || generateReferralCode();

  if (input.max_uses !== undefined && input.max_uses !== null) {
    if (typeof input.max_uses !== "number" || input.max_uses < 1) {
      throw ApiError.badRequest("Max Uses must be a positive number or null", {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [
          {
            location: "body",
            field: "max_uses",
            message: "Must be a positive number or null for unlimited",
          },
        ],
      });
    }
  }

  if (input.expires_at) {
    const expiryDate = new Date(input.expires_at);
    if (isNaN(expiryDate.getTime())) {
      throw ApiError.badRequest("Invalid expiry date", {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [
          {
            location: "body",
            field: "expires_at",
            message: "Must be a valid date",
          },
        ],
      });
    }

    if (expiryDate <= new Date()) {
      throw ApiError.badRequest("expiry date must be in the future", {
        code: ERROR_CODES.VALIDATION_FAILED,
        details: [
          {
            location: "body",
            field: "expires_at",
            message: "Expiry date must be in the future",
          },
        ],
      });
    }
  }

  const referral = await prisma.referral.create({
    data: {
      referred_by_id: userId,
      code: code,
      short_id: shortId,
      max_uses: input.max_uses || null,
      current_uses: 0,
      status: input.status || "active",
      expires_at: input.expires_at ? new Date(input.expires_at) : null,
      description: input.description || null,
    },
    include: {
      referred_by: {
        select: {
          id: true,
          email: true,
          full_name: true,
        },
      },
    },
  });

  return pickPublicReferral(referral);
}

async function processReferralUsage(shortId, newUserId) {
  const codeToVerify = extractReferralCode(shortId);
  if (!codeToVerify) {
    throw ApiError.badRequest("Invalid referral code", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const referral = await prisma.referral.findFirst({
    where: {
      OR: [
        { short_id: { equals: codeToVerify, mode: 'insensitive' } },
        { code: { equals: codeToVerify, mode: 'insensitive' } }
      ],
      deleted_at: null,
    },
  });

  if (!referral || referral.deleted_at) {
    throw ApiError.badRequest("Invalid referral code", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  if (referral.status !== "active") {
    throw ApiError.badRequest("Referral code is not active", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  if (referral.expires_at && new Date(referral.expires_at) < new Date()) {
    throw ApiError.badRequest("Referral code has expired", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  if (
    referral.max_uses !== null &&
    referral.current_uses >= referral.max_uses
  ) {
    throw ApiError.badRequest("Referral code has reached maximum uses", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  if (referral.used_by && referral.used_by.includes(newUserId)) {
    throw ApiError.badRequest("You have already used this referral code", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  if (referral.referred_by_id === newUserId) {
    throw ApiError.badRequest("You cannot use your own referral code", {
      code: ERROR_CODES.VALIDATION_FAILED,
    });
  }

  const updated = await prisma.referral.update({
    where: { id: referral.id },
    data: {
      used_by: {
        push: newUserId,
      },
      current_uses: {
        increment: 1,
      },
    },
    include: {
      referred_by: {
        select: {
          id: true,
          email: true,
          full_name: true,
        },
      },
    },
  });

  await prisma.user.update({
    where: { id: newUserId },
    data: { referral_code: referral.code },
  });

  return pickPublicReferral(updated);
}

async function listReferrals(filters = {}) {
  const where = { deleted_at: null };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.referred_by_id) {
    where.referred_by_id = filters.referred_by_id;
  }

  const referrals = await prisma.referral.findMany({
    where,
    include: {
      referred_by: {
        select: {
          id: true,
          email: true,
          full_name: true,
        },
      },
    },
    orderBy: [{ created_at: "desc" }],
  });

  return referrals.map(pickPublicReferral);
}

async function validateReferralForSignup(shortId) {
  const codeToVerify = extractReferralCode(shortId);
  if (!codeToVerify) {
    return { valid: false, reason: "No referral code provided" };
  }

  const referral = await prisma.referral.findFirst({
    where: {
      OR: [
        { short_id: { equals: codeToVerify, mode: 'insensitive' } },
        { code: { equals: codeToVerify, mode: 'insensitive' } }
      ],
      deleted_at: null,
    },
    include: {
      referred_by: {
        select: {
          id: true,
          email: true,
          full_name: true,
        },
      },
    },
  });

  if (!referral || referral.deleted_at) {
    return { valid: false, reason: "Referral code not found in database" };
  }

  if (referral.status !== "active") {
    return { valid: false, reason: "Referral code is not active" };
  }

  if (referral.expires_at && new Date(referral.expires_at) < new Date()) {
    return { valid: false, reason: "Referral code has expired" };
  }

  if (
    referral.max_uses !== null &&
    referral.current_uses >= referral.max_uses
  ) {
    return { valid: false, reason: "Referral code has reached maximum uses" };
  }

  return {
    valid: true,
    referral: pickPublicReferral(referral),
    referrerName: referral.referred_by?.full_name || null,
  };
}

async function deliverInvitationEmail(to, subject, text, html) {
  try {
    await sendEmail(to, subject, text, html);
  } catch (error) {
    logServerError('referral-invitation-email', error);
    throw new ApiError(HTTP_STATUS.SERVICE_UNAVAILABLE, 'The invitation could not be emailed. Check the mail settings and try again.', {
      code: ERROR_CODES.SERVICE_UNAVAILABLE
    });
  }
}

function resolveClientSiteUrl(preferredBaseUrl) {
  const configured = String(env.clientSiteUrl || '').trim();
  const isLocalConfigured = !configured || configured.includes('localhost') || configured.includes('127.0.0.1');
  if (preferredBaseUrl && /^https?:\/\//i.test(preferredBaseUrl) && isLocalConfigured) {
    return preferredBaseUrl.replace(/\/+$/, '');
  }
  return (configured || preferredBaseUrl || 'http://localhost:5173').replace(/\/+$/, '');
}

function getReferralLink(shortId, baseUrl) {
  const base = resolveClientSiteUrl(baseUrl);
  return `${base}/login?tab=signup&referral=${shortId}`;
}

function pickPublicReferral(referral) {
  if (!referral) return null;

  return {
    id: referral.id,
    referred_by_id: referral.referred_by_id,
    code: referral.code,
    short_id: referral.short_id,
    max_uses: referral.max_uses,
    current_uses: referral.current_uses,
    status: referral.status,
    expires_at: referral.expires_at,
    description: referral.description,
    referral_link: getReferralLink(referral.short_id),
    referred_by: referral.referred_by,
    created_at: referral.created_at,
    updated_at: referral.updated_at,
  };
}

async function sendReferralEmail(userId, targetEmail, options = {}) {
  const referral = await createReferral(userId, {
    max_uses: 1,
    description: "Personal invitation",
    status: "active",
  });

  const referralLink = getReferralLink(referral.short_id, options.clientOrigin);
  const inviterName = options.inviterName || 'A FirstSavvy member';

  const emailText = [
    `${inviterName} invited you to join FirstSavvy.`,
    '',
    `Sign up using this link: ${referralLink}`,
    '',
    'This invitation link is unique to you and will help you get started with your family financial network.'
  ].join('\n');

  const emailHtml = generateEmailTemplate({
    title: 'You have been invited to FirstSavvy',
    content: `
      <p style="margin: 0 0 20px 0;">${escapeHtml(inviterName)} invited you to join FirstSavvy.</p>
      <p style="margin: 20px 0;">This invitation link is unique to you and will help you get started with your family financial network.</p>
    `,
    buttonText: 'Sign Up Now',
    buttonLink: referralLink
  });

  await deliverInvitationEmail(targetEmail, 'You have been invited to FirstSavvy', emailText, emailHtml);

  return {
    success: true,
    referral: pickPublicReferral(referral),
    email: targetEmail
  };
}

async function sendInvitationWithAutoVerification(userId, targetEmail, userData, options = {}) {
  const referral = await createReferral(userId, {
    max_uses: 1,
    description: "Auto-verification invitation",
    status: "active",
  });

  const inviterName = options.inviterName || 'A FirstSavvy member';
  const relationRole = options.relationRole || 'family member';

  const invitationToken = Buffer.from(JSON.stringify({
    referralId: referral.short_id,
    email: targetEmail,
    userData: userData,
    inviterId: userId,
    relationRole: relationRole
  })).toString('base64');

  const acceptInvitationLink = `${resolveClientSiteUrl(options.clientOrigin)}/accept-invitation?token=${invitationToken}`;

  const emailText = [
    `${inviterName} invited you to join FirstSavvy.`,
    '',
    `Your account has been created with the following details:`,
    `Name: ${userData.fullName}`,
    `Email: ${targetEmail}`,
    '',
    `Please set your password and complete your registration: ${acceptInvitationLink}`,
    '',
    'This invitation link will automatically verify your account when you set your password.'
  ].join('\n');

  const emailHtml = generateEmailTemplate({
    title: 'Complete your FirstSavvy registration',
    content: `
      <p style="margin: 0 0 20px 0;">${escapeHtml(inviterName)} invited you to join FirstSavvy.</p>
      <div style="background-color: #f0f9ff; border-left: 4px solid #0F766E; padding: 15px; margin: 20px 0;">
        <h3 style="color: #0F766E; margin: 0 0 10px 0; font-size: 18px;">Your Account Details</h3>
        <p style="color: #334155; margin: 5px 0;"><strong>Name:</strong> ${escapeHtml(userData.fullName)}</p>
        <p style="color: #334155; margin: 5px 0;"><strong>Email:</strong> ${escapeHtml(targetEmail)}</p>
      </div>
      <p style="margin: 20px 0;">Please set your password and complete your registration by clicking the button below.</p>
    `,
    buttonText: 'Set Password & Complete Registration',
    buttonLink: acceptInvitationLink,
    footerText: 'This invitation link will automatically verify your account when you set your password.'
  });

  await deliverInvitationEmail(targetEmail, 'Complete your FirstSavvy registration', emailText, emailHtml);

  return {
    success: true,
    referral: pickPublicReferral(referral),
    email: targetEmail,
    token: invitationToken,
    link: acceptInvitationLink
  };
}

async function sendInvitationWithAcceptButton(userId, targetEmail, userData, options = {}) {
  const referral = await createReferral(userId, {
    max_uses: 1,
    description: "Invitation with accept button",
    status: "active",
  });

  const inviterName = options.inviterName || 'A FirstSavvy member';
  const relationRole = options.relationRole || 'family member';
  
  const invitationToken = Buffer.from(JSON.stringify({
    referralId: referral.short_id,
    email: targetEmail,
    userData: userData,
    inviterId: userId,
    relationRole: relationRole
  })).toString('base64');

  const acceptInvitationLink = `${resolveClientSiteUrl(options.clientOrigin)}/accept-invitation?token=${invitationToken}`;

  const emailText = [
    `${inviterName} invited you to join FirstSavvy as a ${relationRole}.`,
    '',
    `You have been invited with the following details:`,
    `Name: ${userData.fullName}`,
    `Email: ${targetEmail}`,
    '',
    `To accept this invitation and create your account, click the button below:`,
    '',
    acceptInvitationLink,
    '',
    'This invitation is unique to you and will expire after use.'
  ].join('\n');

  const emailHtml = generateEmailTemplate({
    title: 'You have been invited to FirstSavvy',
    content: `
      <p style="margin: 0 0 20px 0;">${escapeHtml(inviterName)} invited you to join FirstSavvy as a <strong>${escapeHtml(relationRole)}</strong>.</p>
      <div style="background-color: #f0f9ff; border-left: 4px solid #0F766E; padding: 15px; margin: 20px 0;">
        <h3 style="color: #0F766E; margin: 0 0 10px 0; font-size: 18px;">Invitation Details</h3>
        <p style="color: #334155; margin: 5px 0;"><strong>Name:</strong> ${escapeHtml(userData.fullName)}</p>
        <p style="color: #334155; margin: 5px 0;"><strong>Email:</strong> ${escapeHtml(targetEmail)}</p>
      </div>
      <p style="margin: 20px 0;">To accept this invitation and create your account, click the button below.</p>
    `,
    buttonText: 'Accept Invitation',
    buttonLink: acceptInvitationLink,
    footerText: 'This invitation is unique to you and will expire after use.'
  });

  await deliverInvitationEmail(targetEmail, 'You have been invited to FirstSavvy', emailText, emailHtml);

  return {
    success: true,
    referral: pickPublicReferral(referral),
    email: targetEmail,
    invitationLink: acceptInvitationLink
  };
}

module.exports = {
  listReferrals,
  validateReferralForSignup,
  extractReferralCode,
  createReferral,
  processReferralUsage,
  getReferralLink,
  pickPublicReferral,
  sendReferralEmail,
  sendInvitationWithAutoVerification,
  sendInvitationWithAcceptButton,
};
