import assert from 'node:assert/strict';
import test from 'node:test';

import { authenticationDTOSchema, toAuthenticationDTO } from './auth.ts';

void test('authentication DTO exposes session metadata without a credential', () => {
  const dto = toAuthenticationDTO(
    'bearer',
    new Date('2026-09-20T12:00:00.000Z'),
  );

  assert.deepEqual(dto, {
    method: 'bearer',
    sessionExpiresAt: '2026-09-20T12:00:00.000Z',
  });
  assert.equal(authenticationDTOSchema.safeParse(dto).success, true);
  assert.equal('token' in dto, false);
});

void test('authentication DTO rejects an unsupported authentication method', () => {
  assert.equal(
    authenticationDTOSchema.safeParse({
      method: 'strava_token',
      sessionExpiresAt: '2026-09-20T12:00:00.000Z',
    }).success,
    false,
  );
});
