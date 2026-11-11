require("dotenv").config();

function required(name) {
  const value = process.env[name];

  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return String(value).trim();
}

function optionalInt(name, fallback) {
  const raw = process.env[name];

  if (raw === undefined || raw === "") {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Environment variable ${name} must be a positive number`);
  }

  return parsed;
}

function secret(name, fallback) {
  const value = process.env[name];

  if (value && String(value).trim()) {
    return String(value).trim();
  }

  if (isProduction) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return fallback;
}


const nodeEnv = process.env.NODE_ENV || "development";
const isProduction = nodeEnv === "production";
const isCookieSecure = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === "true"
  : isProduction;

const rawS3UploadMaxBytes = optionalInt("AWS_S3_UPLOAD_MAX_BYTES", 10 * 1024 * 1024);
// Normalize small integer values (e.g. 5 or 10 configured in MB instead of bytes) and enforce a 5 MB minimum
const normalizedS3UploadMaxBytes = Math.max(
  rawS3UploadMaxBytes <= 1024 ? rawS3UploadMaxBytes * 1024 * 1024 : rawS3UploadMaxBytes,
  5 * 1024 * 1024
);

const env = {
  nodeEnv,
  isProduction,
  port: optionalInt("PORT", 5000),
  corsOrigin: process.env.CORS_ORIGIN || "http://localhost:5173",

  // Database
  databaseUrl: required("DATABASE_URL"),
  databasePoolMax: optionalInt("DATABASE_POOL_MAX", isProduction ? 20 : 10),
  databasePoolIdleMs: optionalInt("DATABASE_POOL_IDLE_MS", 30000),
  databaseConnectTimeoutMs: optionalInt("DATABASE_CONNECT_TIMEOUT_MS", 10000),
  databaseStatementTimeoutMs: optionalInt(
    "DATABASE_STATEMENT_TIMEOUT_MS",
    30000,
  ),

  // Authentication & security
  jwtAccessSecret: secret(
    "JWT_ACCESS_SECRET",
    "dev-firstsavvy-access-secret-change-me",
  ),
  jwtRefreshSecret: secret(
    "JWT_REFRESH_SECRET",
    "dev-firstsavvy-refresh-secret-change-me",
  ),
  jwtPasswordResetSecret: secret(
    "JWT_PASSWORD_RESET_SECRET",
    "dev-firstsavvy-password-reset-secret-change-me",
  ),
  accessTokenTtlSeconds: optionalInt("ACCESS_TOKEN_TTL_SECONDS", 15 * 60),
  refreshTokenTtlSeconds: optionalInt(
    "REFRESH_TOKEN_TTL_SECONDS",
    7 * 24 * 60 * 60,
  ),
  refreshCookieName: process.env.REFRESH_COOKIE_NAME || "firstsavvy_refresh",
  cookieSecure: isCookieSecure,
  passwordResetTtlMinutes: optionalInt("PASSWORD_RESET_TTL_MINUTES", 30),
  passwordResetUrl:
    process.env.PASSWORD_RESET_URL || "http://localhost:5173/reset-password",

  // Google OAuth
  oauthStateCookieName:
    process.env.OAUTH_STATE_COOKIE_NAME || "firstsavvy_oauth_state",
  googleOAuthClientId: process.env.GOOGLE_OAUTH_CLIENT_ID || "",
  googleOAuthClientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || "",
  googleOAuthRedirectUrl:
    process.env.GOOGLE_OAUTH_REDIRECT_URL ||
    "http://localhost:5000/api/v1/auth/google/callback",
  googleOAuthSuccessRedirectUrl:
    process.env.GOOGLE_OAUTH_SUCCESS_REDIRECT_URL ||
    "http://localhost:5173/auth/callback",
  googleOAuthFailureRedirectUrl:
    process.env.GOOGLE_OAUTH_FAILURE_REDIRECT_URL ||
    "http://localhost:5173/login",

  // Plaid
  plaidClientId: process.env.PLAID_CLIENT_ID || "",
  plaidSecret: process.env.PLAID_SECRET || "",
  plaidEnv: process.env.PLAID_ENV || "sandbox",
  plaidProducts: process.env.PLAID_PRODUCTS || "transactions",
  plaidCountryCodes: process.env.PLAID_COUNTRY_CODES || "US",
  plaidRedirectUri: process.env.PLAID_REDIRECT_URI || "",

  // SMTP for emailing
  smtpHost: process.env.SMTP_HOST || "",
  smtpPort: optionalInt("SMTP_PORT", 587),
  smtpSecure: process.env.SMTP_SECURE === "true",
  smtpUser: process.env.SMTP_USER || "",
  smtpPass: process.env.SMTP_PASS || "",
  mailFrom: process.env.MAIL_FROM || "FirstSavvy <no-reply@firstsavvy.com>",
  mailApiKey: process.env.MAIL_API_KEY || "",

  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || "",
  twilioPhoneNumber: process.env.TWILIO_PHONE_NUMBER || "",
  twilioVerifyServiceSid: process.env.TWILIO_VERIFY_SERVICE_SID || "",

  // S3-compatible file storage
  s3Bucket: process.env.AWS_S3_BUCKET || "",
  s3Region: process.env.AWS_REGION || "us-east-1",
  s3AccessKeyId: process.env.AWS_ACCESS_KEY_ID || "",
  s3SecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || "",
  s3Endpoint: process.env.AWS_S3_ENDPOINT || "",
  s3ForcePathStyle: process.env.AWS_S3_FORCE_PATH_STYLE === "true",
  s3PublicBaseUrl: process.env.AWS_S3_PUBLIC_BASE_URL || "",
  s3UploadMaxBytes: normalizedS3UploadMaxBytes,

  // Development-only logging helpers (never log raw secrets; see utils/sanitize.js)
  logDevRequests: !isProduction && process.env.LOG_DEV_REQUESTS !== "false",
  logDevRequestBody:
    !isProduction && process.env.LOG_DEV_REQUEST_BODY === "true",
  logDevResponseBody:
    !isProduction && process.env.LOG_DEV_RESPONSE_BODY === "true",

  // Global API rate limiting
  trustProxy: process.env.TRUST_PROXY === "true",
  rateLimitEnabled: process.env.RATE_LIMIT_ENABLED !== "false",
  rateLimitWindowMs: optionalInt("RATE_LIMIT_WINDOW_MS", 60 * 1000),
  rateLimitMax: optionalInt("RATE_LIMIT_MAX", isProduction ? 100 : 1000),

  // Credit score provider
  creditProvider: process.env.CREDIT_PROVIDER || "mock",
  mockKycResult: process.env.MOCK_KYC_RESULT || "verified",
  creditAutoPullEnabled: process.env.CREDIT_AUTO_PULL_ENABLED === "true",
  fieldEncryptionKey: secret(
    "FIELD_ENCRYPTION_KEY",
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  ),
  clientSiteUrl: process.env.CLIENT_SITE_URL || "http://localhost:5173",
};

module.exports = { env };
