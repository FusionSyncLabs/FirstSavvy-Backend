const { prisma } = require('../config/database');
const { ApiError } = require('../middleware/errorHandler');
const { ERROR_CODES } = require('../constants/errorCodes');

async function getCsvMappingConfigForProfile(profileId, institutionName) {
  const normalizedName = normalizeInstitutionName(institutionName);
  if (!normalizedName) return { config: null };

  const config = await prisma.csvColumnMappingConfig.findFirst({
    where: {
      profile_id: profileId,
      institution_name: {
        equals: normalizedName,
        mode: 'insensitive'
      }
    },
    orderBy: [
      { use_count: 'desc' },
      { last_used_at: 'desc' }
    ]
  });

  return { config: pickPublicConfig(config) };
}

async function saveCsvMappingConfigForProfile(profileId, input = {}) {
  const institutionName = normalizeInstitutionName(input.institutionName ?? input.institution_name);
  const now = new Date();

  const existing = await prisma.csvColumnMappingConfig.findFirst({
    where: {
      profile_id: profileId,
      institution_name: {
        equals: institutionName,
        mode: 'insensitive'
      }
    }
  });

  const data = {
    institution_name: institutionName,
    column_mappings: normalizeObject(input.columnMappings ?? input.column_mappings),
    date_format: normalizeString(input.dateFormat ?? input.date_format, 'auto'),
    amount_type: normalizeString(input.amountType ?? input.amount_type, 'auto'),
    debit_column: normalizeString(input.debitColumn ?? input.debit_column, ''),
    credit_column: normalizeString(input.creditColumn ?? input.credit_column, ''),
    balance_column: normalizeString(input.balanceColumn ?? input.balance_column, ''),
    last_used_at: now
  };

  const config = existing
    ? await prisma.csvColumnMappingConfig.update({
      where: { id: existing.id },
      data: {
        ...data,
        use_count: { increment: 1 }
      }
    })
    : await prisma.csvColumnMappingConfig.create({
      data: {
        profile_id: profileId,
        ...data,
        use_count: 1
      }
    });

  return { config: pickPublicConfig(config) };
}

function pickPublicConfig(config) {
  if (!config) return null;

  return {
    id: config.id,
    profile_id: config.profile_id,
    institution_name: config.institution_name,
    column_mappings: normalizeObject(config.column_mappings),
    date_format: config.date_format,
    amount_type: config.amount_type,
    debit_column: config.debit_column,
    credit_column: config.credit_column,
    balance_column: config.balance_column,
    use_count: config.use_count,
    last_used_at: config.last_used_at,
    created_at: config.created_at,
    updated_at: config.updated_at
  };
}

function normalizeInstitutionName(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw ApiError.badRequest('Institution name is required', {
      code: ERROR_CODES.VALIDATION_FAILED
    });
  }
  return normalized;
}

function normalizeString(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function normalizeObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

module.exports = {
  getCsvMappingConfigForProfile,
  saveCsvMappingConfigForProfile
};
