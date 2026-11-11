const crypto = require('crypto');
const { CreditProvider } = require('./CreditProvider');
const { env } = require('../../config/env');

const FACTOR_STATUSES = ['excellent', 'good', 'fair', 'poor'];

class MockCreditProvider extends CreditProvider {
  async createVerificationSession(input) {
    const mockResult = String(env.mockKycResult || 'verified').toLowerCase();
    const providerSessionId = `mock_session_${crypto.randomUUID()}`;

    if (mockResult === 'failed') {
      return {
        providerSessionId,
        status: 'failed',
        failureReason: 'Mock KYC verification failed'
      };
    }

    return {
      providerSessionId,
      status: 'verified'
    };
  }

  async getVerificationStatus(providerSessionId) {
    if (!providerSessionId) {
      return { status: 'failed', failureReason: 'Missing provider session' };
    }

    return { status: 'verified' };
  }

  pullCreditScore({ profileId, pullIndex = 0 }) {
    const baseScore = getBaseScore(profileId);
    const variation = getPullVariation(profileId, pullIndex);
    const score = clampScore(baseScore + variation);
    const pulledAt = new Date();

    return {
      score,
      bureau: 'mock',
      factors: buildFactors(score, profileId),
      pulledAt
    };
  }
}

function hashProfileId(profileId) {
  const digest = crypto.createHash('sha256').update(String(profileId)).digest();
  return digest.readUInt32BE(0);
}

function getBaseScore(profileId) {
  const hash = hashProfileId(profileId);
  return 300 + (hash % 551);
}

function getPullVariation(profileId, pullIndex) {
  const hash = hashProfileId(profileId);
  const mixed = (hash + (pullIndex * 17)) % 31;
  return mixed - 15;
}

function clampScore(score) {
  return Math.max(300, Math.min(850, score));
}

function buildFactors(score, profileId) {
  const hash = hashProfileId(profileId);

  const paymentHistoryPct = 85 + (hash % 16);
  const utilizationPct = 10 + ((hash >> 3) % 71);
  const historyYears = 2 + ((hash >> 5) % 14);
  const inquiryCount = (hash >> 7) % 6;

  return {
    payment_history: {
      value_pct: paymentHistoryPct,
      status: statusFromPercent(paymentHistoryPct, 'high')
    },
    credit_utilization: {
      value_pct: utilizationPct,
      status: statusFromUtilization(utilizationPct)
    },
    credit_history_length: {
      value_years: historyYears,
      status: statusFromYears(historyYears)
    },
    new_inquiries: {
      count: inquiryCount,
      status: statusFromInquiries(inquiryCount)
    },
    credit_mix: {
      status: pickFactorStatus(score, hash)
    }
  };
}

function statusFromPercent(value, direction = 'high') {
  if (direction === 'high') {
    if (value >= 95) return 'excellent';
    if (value >= 85) return 'good';
    if (value >= 70) return 'fair';
    return 'poor';
  }

  return 'fair';
}

function statusFromUtilization(value) {
  if (value <= 10) return 'excellent';
  if (value <= 30) return 'good';
  if (value <= 50) return 'fair';
  return 'poor';
}

function statusFromYears(value) {
  if (value >= 10) return 'excellent';
  if (value >= 5) return 'good';
  if (value >= 2) return 'fair';
  return 'poor';
}

function statusFromInquiries(value) {
  if (value <= 1) return 'excellent';
  if (value <= 3) return 'good';
  if (value <= 5) return 'fair';
  return 'poor';
}

function pickFactorStatus(score, hash) {
  const index = (score + hash) % FACTOR_STATUSES.length;
  return FACTOR_STATUSES[index];
}

module.exports = {
  MockCreditProvider,
  getBaseScore,
  getPullVariation,
  clampScore,
  buildFactors
};
