const { prisma } = require('../../config/database');
const { ApiError } = require('../../middleware/errorHandler');
const { ERROR_CODES } = require('../../constants/errorCodes');
const { parsePaginationQuery, buildPaginationMeta } = require('../../utils/pagination');

function mapUserProfile(row) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    user_name: row.user_name,
    unique_id: row.unique_id,
    avatar_url: row.avatar_url,
    phone_number: row.phone_number,
    phone_verified_at: row.phone_verified_at,
    verified_at: row.verified_at,
    referral_code: row.referral_code,
    created_at: row.created_at,
    updated_at: row.updated_at,
    has_password: row.has_password,
    auth_provider: row.auth_provider
  };
}

async function listAdminUsers(query = {}) {
  const pagination = parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 });
  const rows = await prisma.$queryRaw`
    WITH page_users AS (
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.user_name,
        u.unique_id,
        u.avatar_url,
        u.phone_number,
        u.phone_verified_at,
        u.verified_at,
        u.referral_code,
        u.created_at,
        u.updated_at,
        (u.password_hash IS NOT NULL AND u.google_id IS NULL) AS has_password,
        CASE WHEN u.google_id IS NOT NULL THEN 'google' ELSE 'password' END AS auth_provider,
        EXISTS (
          SELECT 1
          FROM referrals r
          WHERE r.referred_by_id = u.id
            AND r.deleted_at IS NULL
        ) AS has_referral
      FROM users u
      WHERE u.deleted_at IS NULL
      ORDER BY has_referral DESC, u.created_at DESC, u.id ASC
      LIMIT ${pagination.limit}
      OFFSET ${pagination.skip}
    ),
    total_users AS (
      SELECT COUNT(*)::INTEGER AS total
      FROM users
      WHERE deleted_at IS NULL
    )
    SELECT
      total_users.total,
      page_users.id,
      page_users.email,
      page_users.full_name,
      page_users.user_name,
      page_users.unique_id,
      page_users.avatar_url,
      page_users.phone_number,
      page_users.phone_verified_at,
      page_users.verified_at,
      page_users.referral_code,
      page_users.created_at,
      page_users.updated_at,
      page_users.has_password,
      page_users.auth_provider,
      COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', r.id,
            'code', r.code,
            'short_id', r.short_id,
            'status', r.status,
            'current_uses', r.current_uses,
            'used_by_count', COALESCE(cardinality(r.used_by), 0),
            'max_uses', r.max_uses,
            'expires_at', r.expires_at,
            'description', r.description,
            'created_at', r.created_at,
            'updated_at', r.updated_at
          )
          ORDER BY r.created_at DESC, r.id ASC
        )
        FROM referrals r
        WHERE r.referred_by_id = page_users.id
          AND r.deleted_at IS NULL
      ), '[]'::jsonb) AS referrals,
      page_users.has_referral
    FROM total_users
    LEFT JOIN page_users ON TRUE
    ORDER BY page_users.has_referral DESC, page_users.created_at DESC, page_users.id ASC
  `;

  const total = rows[0]?.total || 0;
  const users = rows
    .filter((row) => row.id !== null)
    .map((row) => ({
      ...mapUserProfile(row),
      referrals: row.referrals,
      has_referral: row.has_referral
    }));

  return {
    users,
    pagination: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total
    })
  };
}

async function listAdminReferralUsers(userId, referralId, query = {}) {
  const pagination = parsePaginationQuery(query, { defaultLimit: 20, maxLimit: 100 });
  const rows = await prisma.$queryRaw`
    WITH target_referral AS (
      SELECT r.used_by
      FROM referrals r
      INNER JOIN users owner
        ON owner.id = r.referred_by_id
       AND owner.deleted_at IS NULL
      WHERE r.id = ${referralId}::uuid
        AND r.referred_by_id = ${userId}::uuid
        AND r.deleted_at IS NULL
    ),
    linked_user_ids AS (
      SELECT DISTINCT linked.user_id
      FROM target_referral referral
      CROSS JOIN LATERAL unnest(COALESCE(referral.used_by, ARRAY[]::TEXT[])) AS linked(user_id)
    ),
    eligible_user_ids AS (
      SELECT
        u.id,
        u.created_at
      FROM linked_user_ids linked
      INNER JOIN users u ON LOWER(u.id::text) = LOWER(linked.user_id)
      WHERE u.deleted_at IS NULL
    ),
    page_users AS (
      SELECT
        u.id,
        u.email,
        u.full_name,
        u.user_name,
        u.unique_id,
        u.avatar_url,
        u.phone_number,
        u.phone_verified_at,
        u.verified_at,
        u.referral_code,
        u.created_at,
        u.updated_at,
        (u.password_hash IS NOT NULL AND u.google_id IS NULL) AS has_password,
        CASE WHEN u.google_id IS NOT NULL THEN 'google' ELSE 'password' END AS auth_provider
      FROM eligible_user_ids eligible
      INNER JOIN users u ON u.id = eligible.id
      ORDER BY eligible.created_at DESC, eligible.id ASC
      LIMIT ${pagination.limit}
      OFFSET ${pagination.skip}
    ),
    total_users AS (
      SELECT COUNT(*)::INTEGER AS total
      FROM eligible_user_ids
    )
    SELECT
      EXISTS (SELECT 1 FROM target_referral) AS referral_exists,
      total_users.total,
      page_users.id,
      page_users.email,
      page_users.full_name,
      page_users.user_name,
      page_users.unique_id,
      page_users.avatar_url,
      page_users.phone_number,
      page_users.phone_verified_at,
      page_users.verified_at,
      page_users.referral_code,
      page_users.created_at,
      page_users.updated_at,
      page_users.has_password,
      page_users.auth_provider
    FROM total_users
    LEFT JOIN page_users ON TRUE
  `;

  if (!rows[0]?.referral_exists) {
    throw ApiError.notFound('Referral was not found for this user.', {
      code: ERROR_CODES.NOT_FOUND
    });
  }

  const users = rows
    .filter((row) => row.id !== null)
    .map(mapUserProfile);
  const total = rows[0].total;

  return {
    users,
    pagination: buildPaginationMeta({
      page: pagination.page,
      limit: pagination.limit,
      total
    })
  };
}

module.exports = {
  listAdminUsers,
  listAdminReferralUsers
};
