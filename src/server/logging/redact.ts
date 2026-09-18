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

// Matches `<sensitive key><:|=><value>` inside free-form strings, e.g. a
// message that interpolated `sessionToken=abc123` or `"cookie": "..."`.
// The value alternative treats a `Bearer <token>` scheme as one unit so it
// doesn't get split (leaving the real token exposed after "Bearer ").
const KEY_VALUE_PATTERN =
  /\b(session(?:[_-]?token)?|access[_-]?token|refresh[_-]?token|authorization|cookie|password|secret|client[_-]?secret|verify[_-]?token|api[_-]?key)(\s*[:=]\s*)("?)(Bearer\s+[^\s"'&,;)}\]]+|[^\s"'&,;)}\]]+)\3/gi;

// Matches a raw `Bearer <token>` credential embedded in a string that isn't
// already tied to one of the keys above (e.g. no leading "Authorization:").
const BEARER_TOKEN_PATTERN = /\bBearer\s+([A-Za-z0-9._~+/-]+=*)/gi;

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
 * Redacts credential-shaped substrings (key=value pairs, Bearer tokens)
 * inside free-form text, so an interpolated message or a JSON.stringify'd
 * value can't smuggle a secret past the object-shaped redaction below.
 */
export function redactString(value: string): string {
  return value
    .replace(
      KEY_VALUE_PATTERN,
      (_match, key: string, sep: string, quote: string) =>
        `${key}${sep}${quote}${REDACTED}${quote}`,
    )
    .replace(BEARER_TOKEN_PATTERN, `Bearer ${REDACTED}`);
}

/**
 * Deeply redacts authorization headers, session/token values, and personal
 * Strava activity data (by key name) so callers can log diagnostic context
 * without leaking credentials or private data. Strings (including
 * interpolated messages and Error message/stack) are scanned for embedded
 * credential-shaped substrings as well.
 */
export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;

  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: value.stack ? redactString(value.stack) : value.stack,
    };
  }

  if (value instanceof Headers) {
    return redactHeaders(value);
  }

  // Checked before descending into arrays/objects so a self-referential
  // array (or object) can't recurse forever.
  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redact(item, seen));
  }

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
