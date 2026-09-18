const REDACTED = '[redacted]';

// Key names that always hold credential material and must never be logged.
const SENSITIVE_KEYS = [
  'session',
  'sessiontoken',
  'token',
  'accesstoken',
  'refreshtoken',
  'authorization',
  'cookie',
  'password',
  'secret',
  'clientsecret',
  'verifytoken',
  'apikey',
  'bearer',
];

// Key names that hold personal Strava activity data rather than credentials.
const PERSONAL_DATA_KEYS = new Set([
  'start_latlng',
  'end_latlng',
  'map_polyline',
  'map_summary_polyline',
  'polyline',
  'summary_polyline',
  'map_bbox',
  'description',
  'email',
]);

function normalize(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function isSensitiveKey(key: string): boolean {
  const normalized = normalize(key);
  return SENSITIVE_KEYS.some((candidate) => normalized.includes(candidate));
}

function isPersonalDataKey(key: string): boolean {
  return PERSONAL_DATA_KEYS.has(key.toLowerCase());
}

/**
 * Deeply redacts authorization headers, session/token values, and personal
 * Strava activity data (by key name) so callers can log diagnostic context
 * without leaking credentials or private data.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }

  if (value instanceof Headers) {
    return redactHeaders(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (val !== null && val !== undefined && (isSensitiveKey(key) || isPersonalDataKey(key))) {
      result[key] = REDACTED;
    } else {
      result[key] = redact(val, seen);
    }
  }
  return result;
}

/** Redacts sensitive header values (Authorization, Cookie, ...) by name. */
export function redactHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = isSensitiveKey(key) ? REDACTED : value;
  });
  return result;
}
