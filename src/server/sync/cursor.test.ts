import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InvalidSyncCursorError,
  SYNC_CURSOR_VERSION,
  ZERO_SYNC_CURSOR,
  decodeSyncCursor,
  encodeSyncCursor,
  tryDecodeSyncCursor,
} from './cursor.ts';

void test('encodeSyncCursor/decodeSyncCursor round-trip a sequence number', () => {
  for (const sequence of [0, 1, 42, 1_000_000]) {
    const token = encodeSyncCursor(sequence);
    const decoded = decodeSyncCursor(token);
    assert.deepEqual(decoded, { version: SYNC_CURSOR_VERSION, sequence });
  }
});

void test('the same sequence always encodes to the same opaque token (replaying a cursor is safe)', () => {
  // The plan doc's "replaying a change page is harmless" property, applied
  // to the cursor itself: decoding (and, if a caller re-derives it,
  // re-encoding) the same cursor repeatedly must be idempotent - never
  // produce a different token or a different decoded value - so a client
  // that retries a request with the same cursor after an interruption is
  // safe.
  const token = encodeSyncCursor(7);
  assert.equal(encodeSyncCursor(7), token);
  assert.deepEqual(decodeSyncCursor(token), decodeSyncCursor(token));
});

void test('encodeSyncCursor rejects a negative or non-integer sequence', () => {
  assert.throws(() => encodeSyncCursor(-1), RangeError);
  assert.throws(() => encodeSyncCursor(1.5), RangeError);
  assert.throws(() => encodeSyncCursor(Number.NaN), RangeError);
});

void test('decodeSyncCursor rejects an empty or non-string token', () => {
  assert.throws(() => decodeSyncCursor(''), InvalidSyncCursorError);
  assert.throws(
    () => decodeSyncCursor(undefined as unknown as string),
    InvalidSyncCursorError,
  );
});

void test('decodeSyncCursor rejects a token with no recognizable version prefix', () => {
  assert.throws(() => decodeSyncCursor('not-a-cursor'), InvalidSyncCursorError);
  assert.throws(() => decodeSyncCursor('42'), InvalidSyncCursorError);
});

void test('decodeSyncCursor rejects a wrong-version token explicitly rather than misinterpreting it', () => {
  // A future v2 cursor format must not be silently parsed as v1 (or vice
  // versa) - it must fail loudly so the caller can map it to
  // `409 sync_rebootstrap_required` per the plan doc, not quietly resync
  // from the wrong point.
  const v1Token = encodeSyncCursor(5);
  const fakeV2Token = 'sc2.' + v1Token.slice('sc1.'.length);
  assert.throws(() => decodeSyncCursor(fakeV2Token), InvalidSyncCursorError);

  // Same payload, but with an internal version tag from a hypothetical
  // future format - also rejected, even though the outer prefix matches.
  const payload = Buffer.from(JSON.stringify({ v: 2, seq: 5 }), 'utf8').toString(
    'base64url',
  );
  assert.throws(() => decodeSyncCursor('sc1.' + payload), InvalidSyncCursorError);
});

void test('decodeSyncCursor rejects malformed base64/JSON payloads instead of throwing an unrelated error', () => {
  assert.throws(() => decodeSyncCursor('sc1.not-valid-base64!!!'), InvalidSyncCursorError);
  const notJson = Buffer.from('not json', 'utf8').toString('base64url');
  assert.throws(() => decodeSyncCursor('sc1.' + notJson), InvalidSyncCursorError);
});

void test('decodeSyncCursor rejects a payload missing or mistyping its sequence', () => {
  const cases = [{ v: 1 }, { v: 1, seq: 'seven' }, { v: 1, seq: -1 }, { v: 1, seq: 1.5 }, null, 42];
  for (const payload of cases) {
    const token = 'sc1.' + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    assert.throws(() => decodeSyncCursor(token), InvalidSyncCursorError, JSON.stringify(payload));
  }
});

void test('tryDecodeSyncCursor returns null instead of throwing for an invalid token', () => {
  assert.equal(tryDecodeSyncCursor('garbage'), null);
  assert.deepEqual(tryDecodeSyncCursor(encodeSyncCursor(3)), {
    version: SYNC_CURSOR_VERSION,
    sequence: 3,
  });
});

void test('ZERO_SYNC_CURSOR decodes to sequence 0 - the correct starting point before a fresh bootstrap', () => {
  assert.deepEqual(decodeSyncCursor(ZERO_SYNC_CURSOR), {
    version: SYNC_CURSOR_VERSION,
    sequence: 0,
  });
});
