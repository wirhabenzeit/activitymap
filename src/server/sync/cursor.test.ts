import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InvalidSyncCursorError,
  SYNC_CURSOR_VERSION,
  decodeSyncCursor,
  encodeSyncCursor,
  tryDecodeSyncCursor,
} from './cursor.ts';

const ISSUED_AT = new Date('2026-09-20T12:00:00.000Z');

function encode(sequence: number, athleteId = 42, issuedAt = ISSUED_AT) {
  return encodeSyncCursor({ sequence, athleteId, issuedAt });
}

void test('encodeSyncCursor/decodeSyncCursor round-trip sequence, athlete scope, and issuance time', () => {
  for (const sequence of [0, 1, 42, 1_000_000]) {
    assert.deepEqual(decodeSyncCursor(encode(sequence)), {
      version: SYNC_CURSOR_VERSION,
      sequence,
      athleteId: 42,
      issuedAt: ISSUED_AT.toISOString(),
    });
  }
});

void test('identical cursor inputs encode deterministically (replaying a cursor is safe)', () => {
  const token = encode(7);
  assert.equal(encode(7), token);
  assert.deepEqual(decodeSyncCursor(token), decodeSyncCursor(token));
});

void test('encodeSyncCursor rejects invalid sequence, athlete, or issuance inputs', () => {
  assert.throws(() => encode(-1), RangeError);
  assert.throws(() => encode(1.5), RangeError);
  assert.throws(() => encode(Number.NaN), RangeError);
  assert.throws(() => encode(1, 0), RangeError);
  assert.throws(() => encode(1, 1.5), RangeError);
  assert.throws(() => encode(1, 42, new Date(Number.NaN)), RangeError);
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

void test('decodeSyncCursor rejects a wrong-version token explicitly', () => {
  const v2Token = encode(5);
  const fakeV3Token = 'sc3.' + v2Token.slice('sc2.'.length);
  assert.throws(() => decodeSyncCursor(fakeV3Token), InvalidSyncCursorError);

  const payload = Buffer.from(
    JSON.stringify({ v: 3, seq: 5, aid: 42, iat: ISSUED_AT.toISOString() }),
    'utf8',
  ).toString('base64url');
  assert.throws(() => decodeSyncCursor('sc2.' + payload), InvalidSyncCursorError);
});

void test('decodeSyncCursor rejects malformed base64/JSON payloads', () => {
  assert.throws(
    () => decodeSyncCursor('sc2.not-valid-base64!!!'),
    InvalidSyncCursorError,
  );
  const notJson = Buffer.from('not json', 'utf8').toString('base64url');
  assert.throws(() => decodeSyncCursor('sc2.' + notJson), InvalidSyncCursorError);
});

void test('decodeSyncCursor rejects a payload with invalid fields', () => {
  const valid = {
    v: SYNC_CURSOR_VERSION,
    seq: 7,
    aid: 42,
    iat: ISSUED_AT.toISOString(),
  };
  const cases = [
    { ...valid, seq: 'seven' },
    { ...valid, seq: -1 },
    { ...valid, aid: 0 },
    { ...valid, aid: '42' },
    { ...valid, iat: 'not-a-date' },
    { ...valid, iat: '2026-09-20' },
    { v: SYNC_CURSOR_VERSION, seq: 7 },
    null,
    42,
  ];

  for (const payload of cases) {
    const token =
      'sc2.' + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    assert.throws(
      () => decodeSyncCursor(token),
      InvalidSyncCursorError,
      JSON.stringify(payload),
    );
  }
});

void test('tryDecodeSyncCursor returns null instead of throwing for an invalid token', () => {
  assert.equal(tryDecodeSyncCursor('garbage'), null);
  assert.deepEqual(tryDecodeSyncCursor(encode(3)), {
    version: SYNC_CURSOR_VERSION,
    sequence: 3,
    athleteId: 42,
    issuedAt: ISSUED_AT.toISOString(),
  });
});
