WITH default_inactive_profiles AS (
  SELECT profile_id
  FROM user_chart_of_accounts
  WHERE is_system = true
    AND deleted_at IS NULL
  GROUP BY profile_id
  HAVING COUNT(*) > 0
    AND BOOL_AND(is_active = false)
)
UPDATE user_chart_of_accounts account
SET is_active = true,
    updated_at = NOW()
FROM default_inactive_profiles profile
WHERE account.profile_id = profile.profile_id
  AND account.is_system = true
  AND account.deleted_at IS NULL;
