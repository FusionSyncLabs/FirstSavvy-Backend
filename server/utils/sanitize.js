const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /authorization/i,
  /api[_-]?key/i,
  /^pin$/i,
  /pin_hash/i,
  /pin_plaintext/i,
  /refresh/i,
  /credential/i,
  /encrypted_key/i,
  /password_hash/i,
  /cookie/i,
  /ssn/i,
  /date_of_birth/i,
  /dateofbirth/i,
  /full_legal_name/i,
  /fulllegalname/i,
  /^address$/i
];

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(String(key)));
}

function sanitizeValue(value, seen = new WeakSet()) {
  if (value === undefined || value === null) {
    return value;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return sanitizeErrorForLog(value);
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  return Object.entries(value).reduce((accumulator, [key, nestedValue]) => {
    accumulator[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(nestedValue, seen);
    return accumulator;
  }, {});
}

function sanitizeErrorForLog(error) {
  const payload = {
    name: error.name,
    message: error.message,
    code: error.code ?? undefined,
    statusCode: error.statusCode ?? undefined
  };

  if (error.details !== undefined) {
    payload.details = sanitizeValue(error.details);
  }

  if (process.env.NODE_ENV !== 'production' && error.stack) {
    payload.stack = error.stack;
  }

  return payload;
}

function normalizePublicAvatarUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  const marker = '/api/v1/files/public/';
  const markerIdx = trimmed.indexOf(marker);
  if (markerIdx !== -1) {
    try {
      const parsed = new URL(trimmed);
      const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
      if (!isLocal && parsed.protocol === 'http:') {
        parsed.protocol = 'https:';
        return parsed.toString();
      }
      if (isLocal && process.env.NODE_ENV === 'production') {
        return trimmed.slice(markerIdx);
      }
    } catch {
      return trimmed.slice(markerIdx);
    }
  }
  return trimmed;
}

function pickPublicUser(user) {
  if (!user) {
    return null;
  }

  const isGoogleUser = Boolean(user.google_id);

  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    user_name: user.user_name,
    unique_id: user.unique_id,
    avatar_url: normalizePublicAvatarUrl(user.avatar_url),
    phone_number: user.phone_number || null,
    phone_verified_at: user.phone_verified_at || null,
    has_password: Boolean(user.password_hash) && !isGoogleUser,
    auth_provider: isGoogleUser ? 'google' : 'password',
    created_at: user.created_at
  };
}

module.exports = {
  REDACTED,
  sanitizeValue,
  sanitizeErrorForLog,
  pickPublicUser
};
