import assert from 'node:assert/strict';
import test from 'node:test';

import { toAuthenticationDTO } from './auth.ts';
import { currentUserDTOSchema, toCurrentUserDTOv1 } from './user.ts';

void test('current-user DTO safely maps identity and authentication metadata', () => {
  const dto = toCurrentUserDTOv1(
    {
      id: 'user-1',
      name: 'Ada',
      email: 'ada@example.test',
      image: null,
      athleteId: 9_007_199_254_740_991,
      stravaConnected: true,
    },
    toAuthenticationDTO('cookie', new Date('2026-10-20T12:00:00.000Z')),
  );

  assert.equal(dto.athleteId, '9007199254740991');
  assert.deepEqual(dto.authentication, {
    method: 'cookie',
    sessionExpiresAt: '2026-10-20T12:00:00.000Z',
  });
  assert.equal(currentUserDTOSchema.safeParse(dto).success, true);
});

void test('current-user DTO has no credential-bearing fields', () => {
  const dto = toCurrentUserDTOv1(
    {
      id: 'user-1',
      name: null,
      email: null,
      image: null,
      athleteId: null,
      stravaConnected: false,
    },
    toAuthenticationDTO('bearer', new Date('2026-10-20T12:00:00.000Z')),
  );
  const serialized = JSON.stringify(dto);

  for (const forbidden of [
    'accessToken',
    'refreshToken',
    'sessionToken',
    'clientSecret',
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
