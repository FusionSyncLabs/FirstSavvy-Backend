const assert = require('node:assert/strict');
const {
  deriveScoreBand,
  canRefresh,
  getNextRefreshAvailableAt
} = require('../services/credit.service');
const { getBaseScore, clampScore } = require('../integrations/credit/MockCreditProvider');

function runCreditScoreChecks() {
  assert.equal(deriveScoreBand(850), 'exceptional');
  assert.equal(deriveScoreBand(800), 'exceptional');
  assert.equal(deriveScoreBand(799), 'very_good');
  assert.equal(deriveScoreBand(740), 'very_good');
  assert.equal(deriveScoreBand(739), 'good');
  assert.equal(deriveScoreBand(670), 'good');
  assert.equal(deriveScoreBand(669), 'fair');
  assert.equal(deriveScoreBand(580), 'fair');
  assert.equal(deriveScoreBand(579), 'poor');
  assert.equal(deriveScoreBand(300), 'poor');

  const profileId = '11111111-1111-4111-8111-111111111111';
  const baseScore = getBaseScore(profileId);
  assert.ok(baseScore >= 300 && baseScore <= 850);
  assert.equal(clampScore(900), 850);
  assert.equal(clampScore(100), 300);

  const lastPulledAt = new Date('2026-07-01T00:00:00.000Z');
  assert.equal(canRefresh(lastPulledAt, new Date('2026-07-15T00:00:00.000Z')), false);
  assert.equal(canRefresh(lastPulledAt, new Date('2026-08-01T00:00:00.000Z')), true);

  const nextRefresh = getNextRefreshAvailableAt(lastPulledAt);
  assert.equal(nextRefresh.toISOString(), '2026-07-31T00:00:00.000Z');

  console.log('Credit score verification checks passed.');
}

runCreditScoreChecks();
