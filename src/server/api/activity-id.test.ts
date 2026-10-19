import assert from 'node:assert/strict';

import test from 'node:test';

import { streamActivityIdSchema } from '~/server/strava/streams';

import { parseMutationActivityId } from './activity-id';

void test('adapter ID validation preserves mutation safe integers and stream bigint decimal strings', () => {
  for (const id of [
    '',
    '0',
    '-1',
    '01',
    '1.5',
    '1e3',
    'x',
    ' 7',
    '7/streams',
  ]) {
    assert.equal(parseMutationActivityId(id), null, id);
    assert.equal(streamActivityIdSchema.safeParse(id).success, false, id);
  }
  assert.equal(
    parseMutationActivityId('9007199254740991'),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(parseMutationActivityId('9007199254740992'), null);
  assert.equal(
    streamActivityIdSchema.parse('9007199254740993'),
    '9007199254740993',
  );
  assert.equal(
    streamActivityIdSchema.parse('9223372036854775807'),
    '9223372036854775807',
  );
  assert.equal(
    streamActivityIdSchema.safeParse('9223372036854775808').success,
    false,
  );
});
