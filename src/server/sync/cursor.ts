/**
 * Opaque, versioned change-feed cursor encoding (issue #122).
 *
 * A cursor is a token a client stores and later sends back to ask "what
 * changed after this point". The server-side truth it wraps is a single
 * `sync_change.sequence` value (see `~/server/db/schema.ts`) - never a
 * timestamp, since two mutations can share a `changed_at` value and a
 * timestamp-based cursor can silently skip or duplicate rows at a page
 * boundary. That is exactly the bug this issue exists to fix; the legacy
 * timestamp-cursor implementation this replaced (formerly
 * `~/server/application/sync.ts`) was removed once issue #126 finished
 * migrating the web client off it.
 *
 * The token is intentionally opaque (clients must not parse or construct
 * it) and carries an explicit version tag, athlete scope, and issuance time.
 * Scope prevents a locally retained cursor from one signed-in athlete from
 * silently skipping another athlete's earlier changes. Issuance time gives
 * the API a stable retention deadline that an empty poll cannot renew.
 *
 * This module has no database dependency - #123's bootstrap/delta endpoints
 * import it directly and validate the decoded scope, issuance time, and
 * sequence against the authenticated actor and current feed high-water mark.
 */

export const SYNC_CURSOR_VERSION = 2;

export type SyncCursor = {
  /** The cursor encoding's own version - see the module doc comment. */
  version: typeof SYNC_CURSOR_VERSION;
  /**
   * The `sync_change.sequence` this cursor represents: "the client has
   * already applied every change up to and including this sequence; give it
   * changes strictly after it." `0` means "nothing applied yet" (a fresh
   * bootstrap's starting cursor) - `sync_change.sequence` starts at 1.
   */
  sequence: number;
  /** The Strava athlete this cursor was issued for. */
  athleteId: number;
  /** Canonical ISO instant from which the cursor retention window starts. */
  issuedAt: string;
};

/** Thrown by `decodeSyncCursor` for anything that is not a well-formed, current-version cursor. */
export class InvalidSyncCursorError extends Error {
  constructor(reason: string) {
    super(`Invalid sync cursor: ${reason}`);
    this.name = 'InvalidSyncCursorError';
  }
}

// A short literal prefix, not just the base64 payload, so a decoder can
// reject a foreign or garbage string immediately, and so a future v2 format
// can use a different prefix ("sc2.") without any ambiguity against tokens
// already issued under v1.
const CURSOR_PREFIX = `sc${SYNC_CURSOR_VERSION}.`;

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isCanonicalIsoInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

/** Encode a scoped `sync_change.sequence` into an opaque, versioned cursor token. */
export function encodeSyncCursor({
  sequence,
  athleteId,
  issuedAt,
}: {
  sequence: number;
  athleteId: number;
  issuedAt: Date;
}): string {
  if (!isNonNegativeSafeInteger(sequence)) {
    throw new RangeError(
      `Cursor sequence must be a non-negative safe integer, got ${String(sequence)}`,
    );
  }
  if (!isPositiveSafeInteger(athleteId)) {
    throw new RangeError(
      `Cursor athleteId must be a positive safe integer, got ${String(athleteId)}`,
    );
  }
  if (!Number.isFinite(issuedAt.getTime())) {
    throw new RangeError('Cursor issuedAt must be a valid Date');
  }
  const payload = JSON.stringify({
    v: SYNC_CURSOR_VERSION,
    seq: sequence,
    aid: athleteId,
    iat: issuedAt.toISOString(),
  });
  return CURSOR_PREFIX + Buffer.from(payload, 'utf8').toString('base64url');
}

/**
 * Decode and validate an opaque cursor token, throwing
 * `InvalidSyncCursorError` for anything malformed or from an unsupported
 * version - never silently falling back to a default cursor, which would
 * quietly re-deliver or skip changes.
 */
export function decodeSyncCursor(token: string): SyncCursor {
  if (typeof token !== 'string' || token.length === 0) {
    throw new InvalidSyncCursorError('cursor must be a non-empty string');
  }
  if (!token.startsWith(CURSOR_PREFIX)) {
    throw new InvalidSyncCursorError(
      'unrecognized or unsupported cursor version',
    );
  }

  const body = token.slice(CURSOR_PREFIX.length);
  let decoded: string;
  try {
    decoded = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    throw new InvalidSyncCursorError('malformed base64 payload');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    throw new InvalidSyncCursorError('malformed JSON payload');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new InvalidSyncCursorError('payload is not an object');
  }
  const { v, seq, aid, iat } = parsed as Record<string, unknown>;
  if (v !== SYNC_CURSOR_VERSION) {
    throw new InvalidSyncCursorError(`unsupported cursor payload version ${String(v)}`);
  }
  if (!isNonNegativeSafeInteger(seq)) {
    throw new InvalidSyncCursorError('sequence must be a non-negative safe integer');
  }
  if (!isPositiveSafeInteger(aid)) {
    throw new InvalidSyncCursorError('athleteId must be a positive safe integer');
  }
  if (!isCanonicalIsoInstant(iat)) {
    throw new InvalidSyncCursorError('issuedAt must be a canonical ISO instant');
  }

  return {
    version: SYNC_CURSOR_VERSION,
    sequence: seq,
    athleteId: aid,
    issuedAt: iat,
  };
}

/** `decodeSyncCursor`, returning `null` instead of throwing on an invalid token. */
export function tryDecodeSyncCursor(token: string): SyncCursor | null {
  try {
    return decodeSyncCursor(token);
  } catch {
    return null;
  }
}
