import assert from 'node:assert/strict';
import { test } from 'node:test';

import { toCurrentUserDTO } from './dto';
import type { Account, User } from './schema';
import type { InitialAuth } from '~/store/auth';

const SENSITIVE = 'super-secret-strava-credential';

// Fields that must never appear on a value serialized to the client.
const CREDENTIAL_FIELDS = [
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'accountId',
  'providerAccountId',
  'password',
  'id_token',
  'idToken',
  'token_type',
  'scope',
];

function buildAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    userId: 'user-1',
    type: null,
    provider: null,
    providerId: 'strava',
    providerAccountId: '12345',
    accountId: '12345',
    refresh_token: SENSITIVE,
    refreshToken: SENSITIVE,
    access_token: SENSITIVE,
    accessToken: SENSITIVE,
    expires_at: null,
    expiresAt: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    password: SENSITIVE,
    token_type: 'Bearer',
    scope: 'read,activity:read_all',
    id_token: SENSITIVE,
    idToken: SENSITIVE,
    session_state: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Jane Athlete',
    email: 'jane@example.com',
    emailVerified: true,
    image: null,
    athlete_id: 12345,
    oldest_activity_reached: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

void test('CurrentUserDTO never serializes Strava credentials to the client', () => {
  const dto = toCurrentUserDTO(buildUser(), buildAccount());
  const serialized = JSON.stringify(dto);

  assert.equal(
    serialized.includes(SENSITIVE),
    false,
    'serialized CurrentUserDTO must not contain the account access/refresh token',
  );

  for (const field of CREDENTIAL_FIELDS) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(dto, field),
      false,
      `CurrentUserDTO must not expose the "${field}" field`,
    );
  }
});

void test('the full InitialAuth client payload never serializes a session token or account credentials', () => {
  const currentUser = toCurrentUserDTO(buildUser(), buildAccount());
  // This mirrors exactly what src/app/layout.tsx hands to <AuthProvider>.
  const initialAuth: InitialAuth = { currentUser };
  const serialized = JSON.stringify(initialAuth);

  assert.equal(
    serialized.includes(SENSITIVE),
    false,
    'serialized InitialAuth payload must not contain any Strava credential',
  );

  assert.equal(
    Object.prototype.hasOwnProperty.call(initialAuth, 'session'),
    false,
    'InitialAuth must not carry a Better Auth session - its reusable session token would leak to the client',
  );

  for (const field of [...CREDENTIAL_FIELDS, 'session', 'token']) {
    assert.equal(
      serialized.includes(`"${field}"`),
      false,
      `serialized InitialAuth payload must not expose the "${field}" field`,
    );
  }
});

void test('CurrentUserDTO reports Strava connection status without leaking the account row', () => {
  const connected = toCurrentUserDTO(buildUser(), buildAccount());
  assert.equal(connected.stravaConnected, true);
  assert.equal(connected.athleteId, 12345);

  const disconnected = toCurrentUserDTO(buildUser(), null);
  assert.equal(disconnected.stravaConnected, false);
});
