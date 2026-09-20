/**
 * Opaque row-keyset cursor for `/api/v1/sync/bootstrap`'s per-resource
 * pagination (issue #123).
 *
 * This wraps the last-seen primary key of an `activities`/`photos` page -
 * `activities.id` (numeric) or `photos.unique_id` (string), both carried as
 * plain strings here. That is a fundamentally different position than the
 * `sync_change.sequence` cursor `~/server/sync/cursor.ts` wraps: this one
 * points at a row in a table being paginated once per bootstrap, that one
 * points at a position in the append-only change feed that is polled
 * indefinitely. Per issue #123, the change-feed cursor format is reused
 * as-is for both the bootstrap `snapshotCursor` and `/sync/changes`'
 * pagination cursor - only this row-position cursor is new, since keyset
 * row pagination has no equivalent in the change feed.
 *
 * Like the change-feed cursor, this is intentionally opaque and versioned
 * (a distinct `bc1.` prefix, so a `sc1.` token can never be mistaken for
 * one of these or vice versa) and never silently falls back to a default on
 * a decode failure.
 */

export const BOOTSTRAP_CURSOR_VERSION = 1;

const CURSOR_PREFIX = `bc${BOOTSTRAP_CURSOR_VERSION}.`;

export class InvalidBootstrapCursorError extends Error {
  constructor(reason: string) {
    super(`Invalid bootstrap cursor: ${reason}`);
    this.name = 'InvalidBootstrapCursorError';
  }
}

/** Encode a row's keyset position (its primary key, as a string) into an opaque cursor token. */
export function encodeBootstrapCursor(key: string): string {
  const payload = JSON.stringify({ v: BOOTSTRAP_CURSOR_VERSION, key });
  return CURSOR_PREFIX + Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decode and validate an opaque bootstrap cursor token, throwing
 * `InvalidBootstrapCursorError` for anything malformed or from an
 * unsupported version.
 */
export function decodeBootstrapCursor(token: string): string {
  if (typeof token !== 'string' || token.length === 0) {
    throw new InvalidBootstrapCursorError('cursor must be a non-empty string');
  }
  if (!token.startsWith(CURSOR_PREFIX)) {
    throw new InvalidBootstrapCursorError(
      'unrecognized or unsupported cursor version',
    );
  }

  const body = token.slice(CURSOR_PREFIX.length);
  let decoded: string;
  try {
    decoded = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    throw new InvalidBootstrapCursorError('malformed base64 payload');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new InvalidBootstrapCursorError('malformed JSON payload');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidBootstrapCursorError('payload is not an object');
  }
  const { v, key } = parsed as Record<string, unknown>;
  if (v !== BOOTSTRAP_CURSOR_VERSION) {
    throw new InvalidBootstrapCursorError(
      `unsupported cursor payload version ${String(v)}`,
    );
  }
  if (typeof key !== 'string' || key.length === 0) {
    throw new InvalidBootstrapCursorError('key must be a non-empty string');
  }

  return key;
}

/** `decodeBootstrapCursor`, returning `null` instead of throwing on an invalid token. */
export function tryDecodeBootstrapCursor(token: string): string | null {
  try {
    return decodeBootstrapCursor(token);
  } catch {
    return null;
  }
}
