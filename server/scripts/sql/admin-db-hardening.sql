-- Provision the runtime role in staging/production; do not run against a live
-- database without an approved provisioning change.
-- Connect to the target database as its owner/migration role before running.
-- Replace the password placeholder below with a strong secret before execution.
-- Run this script as each role that creates application objects so default
-- privileges cover objects created by that migration owner.

DO $$
DECLARE
  runtime_password CONSTANT text := 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
BEGIN
  IF runtime_password = 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD' THEN
    RAISE EXCEPTION 'Replace the firstsavvy_app password placeholder before running this script';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'firstsavvy_app') THEN
    EXECUTE format(
      'ALTER ROLE firstsavvy_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      runtime_password
    );
  ELSE
    EXECUTE format(
      'CREATE ROLE firstsavvy_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L',
      runtime_password
    );
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO firstsavvy_app',
    current_database()
  );
END
$$;

GRANT USAGE ON SCHEMA public TO firstsavvy_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO firstsavvy_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO firstsavvy_app;

-- These defaults apply to future objects created by the role executing this script.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO firstsavvy_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO firstsavvy_app;

-- DROP, TRUNCATE, ALTER, and CREATE remain restricted to the migration/owner
-- role (DIRECT_URL); they are not granted to firstsavvy_app.

-- RLS is intentionally not enabled here. Prisma does not currently set
-- per-transaction session context with SET LOCAL. Enabling RLS without that
-- plumbing can block existing customer/admin queries. Revisit only alongside
-- complete transaction-scoped context and query coverage.
