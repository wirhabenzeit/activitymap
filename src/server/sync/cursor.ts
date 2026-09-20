/**
 * Opaque, versioned change-feed cursor encoding (issue #122).
 *
 * A cursor is a token a client stores and later sends back to ask "what
 * changed after this point". The server-side truth it wraps is a single
 * `sync_change.sequence` value (see `~/server/db/schema.ts`) - never a
 * timestamp, since two mutations can share a `changed_at` value and a
 * timestamp-based cursor can silently skip or duplicate rows at a page
 * boundary. That is exactly the bug this issue exists to fix; see the
 * legacy timestamp-cursor implementation this replaces at
 * `~/server/application/sync.ts`.
 *
 * The token is intentionally opaque (clients must not parse or construct
 * it) and carries an explicit version tag, so a future change to the cursor
 * format (e.g. adding a schema/shard identifier) does not require bespoke
 * migration logic for cursors already issued to clients: an old-version
 * token is rejected outright (`InvalidSyncCursorError`) rather than silently
 * misinterpreted, and the caller (a future #123 endpoint) can map that
 * rejection onto the `409 sync_rebootstrap_required` response described in
 * docs/swiftui-backend-preparation-plan.md.
 *
 * This module has no database dependency - #123's bootstrap/delta endpoints
 * import it directly to encode/decode cursors, and combine it with
 * `~/server/repositories/changes.ts`'s `isCursorRetained` to decide whether
 * a decoded cursor is still inside the retained change history.
 */

export const SYNC_CURSOR_VERSION = 1;

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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Encode a `sync_change.sequence` into an opaque, versioned cursor token. */
export function encodeSyncCursor(sequence: number): string {
  if (!isNonNegativeInteger(sequence)) {
    throw new RangeError(
      `Cursor sequence must be a non-negative integer, got ${String(sequence)}`,
    );
  }
  const payload = JSON.stringify({ v: SYNC_CURSOR_VERSION, seq: sequence });
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
  const { v, seq } = parsed as Record<string, unknown>;
  if (v !== SYNC_CURSOR_VERSION) {
    throw new InvalidSyncCursorError(`unsupported cursor payload version ${String(v)}`);
  }
  if (!isNonNegativeInteger(seq)) {
    throw new InvalidSyncCursorError('sequence must be a non-negative integer');
  }

  return { version: SYNC_CURSOR_VERSION, sequence: seq };
}

/** `decodeSyncCursor`, returning `null` instead of throwing on an invalid token. */
export function tryDecodeSyncCursor(token: string): SyncCursor | null {
  try {
    return decodeSyncCursor(token);
  } catch {
    return null;
  }
}

/** The cursor for "no changes applied yet" - the correct starting point before a fresh bootstrap. */
export const ZERO_SYNC_CURSOR = encodeSyncCursor(0);
