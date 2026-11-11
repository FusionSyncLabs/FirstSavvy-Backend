const { prisma } = require('../config/database');
const { env } = require('../config/env');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES, HTTP_STATUS } = require('../constants/errorCodes');
const { encryptField, decryptField } = require('../utils/fieldEncryption');
const { createNotificationForUser } = require('./notification.service');
const { MockCreditProvider } = require('../integrations/credit/MockCreditProvider');

const REFRESH_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

function invalid(field, message, location = 'body') {
  throw ApiError.badRequest(message, {
    code: ERROR_CODES.VALIDATION_FAILED,
    details: [{ location, field, message }]
  });
}

function deriveScoreBand(score) {
  if (score >= 800) return 'exceptional';
  if (score >= 740) return 'very_good';
  if (score >= 670) return 'good';
  if (score >= 580) return 'fair';
  return 'poor';
}

function formatScoreBandLabel(band) {
  return String(band || '')
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

function getNextRefreshAvailableAt(lastPulledAt) {
  if (!lastPulledAt) return null;
  return addDays(new Date(lastPulledAt), 30);
}

function canRefresh(lastPulledAt, now = new Date()) {
  if (!lastPulledAt) return true;
  return now.getTime() - new Date(lastPulledAt).getTime() >= REFRESH_INTERVAL_MS;
}

async function getActiveVerification(profileId) {
  return prisma.creditVerification.findFirst({
    where: {
      profile_id: profileId,
      deleted_at: null
    }
  });
}

async function getLatestScore(profileId) {
  return prisma.creditScore.findFirst({
    where: {
      profile_id: profileId,
      deleted_at: null
    },
    orderBy: { pulled_at: 'desc' }
  });
}

async function countScorePulls(profileId) {
  return prisma.creditScore.count({
    where: {
      profile_id: profileId,
      deleted_at: null
    }
  });
}

function pickScoreRecord(record) {
  if (!record) return null;

  return {
    score: record.score,
    score_band: record.score_band,
    bureau: record.bureau,
    factors: record.factors,
    pulled_at: record.pulled_at
  };
}

function validateVerificationInput(input = {}) {
  const fullLegalName = String(input.full_legal_name || input.fullLegalName || '').trim();
  const dateOfBirth = input.date_of_birth || input.dateOfBirth;
  const ssnLast4 = String(input.ssn_last4 || input.ssnLast4 || '').trim();
  const address = input.address;

  if (!fullLegalName) invalid('full_legal_name', 'full_legal_name is required');
  if (!dateOfBirth) invalid('date_of_birth', 'date_of_birth is required');
  if (!/^\d{4}$/.test(ssnLast4)) invalid('ssn_last4', 'ssn_last4 must be exactly 4 digits');

  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) invalid('date_of_birth', 'date_of_birth must be a valid date');

  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }

  if (age < 18) invalid('date_of_birth', 'You must be at least 18 years old');

  if (!address || typeof address !== 'object') invalid('address', 'address is required');

  const street = String(address.street || '').trim();
  const city = String(address.city || '').trim();
  const state = String(address.state || '').trim();
  const zip = String(address.zip || '').trim();

  if (!street) invalid('address.street', 'address.street is required');
  if (!city) invalid('address.city', 'address.city is required');
  if (!state) invalid('address.state', 'address.state is required');
  if (!zip) {
    invalid('address.zip', 'address.zip is required');
  } else if (!/^\d{5}(-\d{4})?$/.test(zip) && !/^[A-Za-z0-9]{2,5}[-\s]?[A-Za-z0-9]{2,5}$/.test(zip)) {
    invalid('address.zip', 'Invalid ZIP or postal code format (e.g. 10001 or 10001-1234)');
  }

  return {
    fullLegalName,
    dateOfBirth: dob,
    ssnLast4,
    address: { street, city, state, zip }
  };
}

async function initiateVerification(profileId, userId, input = {}) {
  const existing = await getActiveVerification(profileId);

  if (existing?.status === 'verified') {
    throw new ApiError(HTTP_STATUS.CONFLICT, 'Profile is already verified', {
      code: ERROR_CODES.ALREADY_VERIFIED
    });
  }

  const validated = validateVerificationInput(input);
  const provider = getCreditProvider();
  const providerResult = await provider.createVerificationSession({
    profileId,
    fullLegalName: validated.fullLegalName,
    dateOfBirth: validated.dateOfBirth,
    ssnLast4: validated.ssnLast4,
    address: validated.address
  });

  const data = {
    profile_id: profileId,
    user_id: userId,
    provider: env.creditProvider,
    provider_session_id: encryptField(providerResult.providerSessionId),
    status: providerResult.status,
    verified_at: providerResult.status === 'verified' ? new Date() : null,
    failure_reason: providerResult.failureReason || null
  };

  const verification = existing
    ? await prisma.creditVerification.update({
      where: { id: existing.id },
      data
    })
    : await prisma.creditVerification.create({ data });

  return {
    id: verification.id,
    status: verification.status
  };
}

async function getCreditStatus(profileId) {
  const [verification, latestScore] = await Promise.all([
    getActiveVerification(profileId),
    getLatestScore(profileId)
  ]);

  const verified = verification?.status === 'verified';
  const lastPulledAt = latestScore?.pulled_at || null;
  const nextRefreshAvailableAt = verified ? getNextRefreshAvailableAt(lastPulledAt) : null;

  return {
    verified,
    verification_status: verification?.status || null,
    last_pulled_at: lastPulledAt,
    next_refresh_available_at: nextRefreshAvailableAt,
    can_refresh: verified && canRefresh(lastPulledAt)
  };
}

async function requireVerified(profileId) {
  const verification = await getActiveVerification(profileId);

  if (!verification || verification.status !== 'verified') {
    throw new ApiError(HTTP_STATUS.FORBIDDEN, 'Identity verification is required', {
      code: ERROR_CODES.VERIFICATION_REQUIRED
    });
  }

  return verification;
}

async function getCreditScore(profileId) {
  await requireVerified(profileId);

  const latestScore = await getLatestScore(profileId);
  if (!latestScore) {
    throw new ApiError(HTTP_STATUS.NOT_FOUND, 'No credit score is available yet', {
      code: ERROR_CODES.NO_SCORE_AVAILABLE
    });
  }

  return pickScoreRecord(latestScore);
}

async function getCreditHistory(profileId, months = 12) {
  await requireVerified(profileId);

  const normalizedMonths = Math.min(24, Math.max(1, Number(months) || 12));
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - normalizedMonths);

  const scores = await prisma.creditScore.findMany({
    where: {
      profile_id: profileId,
      deleted_at: null,
      pulled_at: { gte: cutoff }
    },
    orderBy: { pulled_at: 'asc' },
    select: {
      score: true,
      pulled_at: true
    }
  });

  const latestByMonth = new Map();

  scores.forEach((entry) => {
    const date = new Date(entry.pulled_at);
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`;
    latestByMonth.set(key, entry);
  });

  return [...latestByMonth.values()].sort(
    (left, right) => new Date(left.pulled_at) - new Date(right.pulled_at)
  );
}

async function refreshCreditScore(profileId, source = 'manual_refresh') {
  const verification = await requireVerified(profileId);
  const latestScore = await getLatestScore(profileId);

  if (!canRefresh(latestScore?.pulled_at)) {
    const nextRefreshAvailableAt = getNextRefreshAvailableAt(latestScore.pulled_at);
    throw new ApiError(
      HTTP_STATUS.TOO_MANY_REQUESTS,
      `Credit score refresh is rate limited until ${nextRefreshAvailableAt.toISOString()}`,
      {
        code: ERROR_CODES.REFRESH_RATE_LIMITED,
        details: [{ field: 'profile_id', message: 'Refresh allowed once every 30 days' }],
        data: { next_refresh_available_at: nextRefreshAvailableAt }
      }
    );
  }

  const provider = getCreditProvider();
  const pullIndex = await countScorePulls(profileId);
  const providerSessionId = decryptField(verification.provider_session_id);
  const providerResult = provider.pullCreditScore({
    profileId,
    providerSessionId,
    pullIndex
  });

  const scoreBand = deriveScoreBand(providerResult.score);
  const created = await prisma.$transaction(async (tx) => {
    const createdScore = await tx.creditScore.create({
      data: {
        profile_id: profileId,
        score: providerResult.score,
        score_band: scoreBand,
        bureau: providerResult.bureau,
        factors: providerResult.factors,
        pulled_at: providerResult.pulledAt || new Date(),
        source
      }
    });

    await emitCreditScoreNotification(profileId, createdScore, latestScore, tx);

    return createdScore;
  });

  return pickScoreRecord(created);
}

async function emitCreditScoreNotification(profileId, currentScore, previousScore, tx = prisma) {
  const profile = await tx.profile.findUnique({
    where: { id: profileId },
    select: { owner_user_id: true }
  });

  if (!profile?.owner_user_id) return;

  let deltaText = '';
  if (previousScore) {
    const delta = currentScore.score - previousScore.score;
    if (delta !== 0) {
      deltaText = ` (${delta > 0 ? '+' : ''}${delta} points)`;
    }
  }

  await createNotificationForUser(profile.owner_user_id, {
    source: 'credit',
    source_id: currentScore.id,
    event_type: 'credit.score_update',
    delivery_key: `credit:profile_shared:${currentScore.id}`,
    title: 'Credit Score Updated',
    body: `Your credit score has been updated — ${currentScore.score}${deltaText}`,
    action_url: '/CreditScore',
    priority: 'normal',
    metadata: {
      score: currentScore.score,
      score_band: currentScore.score_band,
      previous_score: previousScore?.score ?? null
    }
  }, {
    fallbackProfileId: profileId,
    db: tx
  });
}

async function runScheduledCreditPulls() {
  const now = new Date();
  const cutoff = new Date(now.getTime() - REFRESH_INTERVAL_MS);

  const verifiedProfiles = await prisma.creditVerification.findMany({
    where: {
      status: 'verified',
      deleted_at: null
    },
    select: { profile_id: true }
  });

  let pulled = 0;
  let skipped = 0;

  for (const entry of verifiedProfiles) {
    const latestScore = await getLatestScore(entry.profile_id);
    const lastPulledAt = latestScore?.pulled_at;

    if (lastPulledAt && lastPulledAt > cutoff) {
      skipped += 1;
      continue;
    }

    await refreshCreditScore(entry.profile_id, 'scheduled');
    pulled += 1;
  }

  return { pulled, skipped, processed: verifiedProfiles.length };
}

function getCreditProvider() {
  switch (env.creditProvider) {
    case 'mock':
    default:
      return new MockCreditProvider();
  }
}

module.exports = {
  initiateVerification,
  getCreditStatus,
  getCreditScore,
  getCreditHistory,
  refreshCreditScore,
  runScheduledCreditPulls,
  deriveScoreBand,
  formatScoreBandLabel,
  canRefresh,
  getNextRefreshAvailableAt
};
