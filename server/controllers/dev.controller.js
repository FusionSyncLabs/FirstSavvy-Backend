const { ok, created } = require('../utils/apiResponse');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  provisionNewUser,
  provisionExistingUser,
  verifyUserProvisioning
} = require('../services/provisioning.service');
const { prisma } = require('../config/database');
const { execSync } = require('node:child_process');
const path = require('node:path');

const seedStatus = asyncHandler(async (_req, res) => {
  const [templateCount, institutionCount, userCount] = await Promise.all([
    prisma.chartOfAccountsTemplate.count(),
    prisma.financialInstitution.count(),
    prisma.user.count({ where: { deleted_at: null } })
  ]);

  return ok(res, {
    chartOfAccountsTemplateCount: templateCount,
    financialInstitutionCount: institutionCount,
    userCount,
    seedReady: templateCount > 0
  });
});

const provisionUser = asyncHandler(async (req, res) => {
  const { email, fullName, password, profileType } = req.body;

  const result = await provisionNewUser({
    email,
    fullName,
    password,
    profileType
  });

  const verification = await verifyUserProvisioning(result.user.id);

  return created(res, {
    ...result,
    verification
  });
});

const reprovisionUser = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { displayName, profileType } = req.body || {};

  const result = await provisionExistingUser(userId, { displayName, profileType });
  const verification = await verifyUserProvisioning(userId);

  return ok(res, {
    ...result,
    verification
  });
});

const getProvisioningStatus = asyncHandler(async (req, res) => {
  const verification = await verifyUserProvisioning(req.params.userId);
  return ok(res, verification);
});

const runSeed = asyncHandler(async (_req, res) => {
  execSync('node prisma/seed.js', {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe'
  });

  const [templateCount, institutionCount] = await Promise.all([
    prisma.chartOfAccountsTemplate.count(),
    prisma.financialInstitution.count()
  ]);

  return ok(res, {
    seeded: true,
    chartOfAccountsTemplateCount: templateCount,
    financialInstitutionCount: institutionCount
  });
});

module.exports = {
  seedStatus,
  provisionUser,
  reprovisionUser,
  getProvisioningStatus,
  runSeed
};
