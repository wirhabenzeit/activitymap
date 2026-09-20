import assert from 'node:assert/strict';
import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { responseEnvelope } from '~/contracts/v1/envelope.ts';
import { currentUserDTOSchema } from '~/contracts/v1/user.ts';
import { createCurrentUserHandler } from './handler.ts';

const now = new Date('2026-09-20T12:00:00.000Z');

const currentUser = {
  id: 'user-1',
  name: 'Ada',
  email: 'ada@example.test',
  image: null,
  athleteId: '9007199254740991',
  stravaConnected: true,
  authentication: {
    method: 'bearer' as const,
    sessionExpiresAt: '2026-10-20T12:00:00.000Z',
  },
};

void test('GET /api/v1/me serializes a schema-valid success envelope', async () => {
  const GET = createCurrentUserHandler({
    now: () => now,
    resolveCurrentUser: async () => currentUser,
  });

  const response = await GET(new Request('https://example.test/api/v1/me'));
  const body: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    responseEnvelope(currentUserDTOSchema).safeParse(body).success,
    true,
  );
  assert.deepEqual(body, {
    schemaVersion: '1',
    serverTime: now.toISOString(),
    data: currentUser,
  });
});

void test('GET /api/v1/me strips unknown credential fields at the boundary', async () => {
  const GET = createCurrentUserHandler({
    now: () => now,
    resolveCurrentUser: async () =>
      ({
        ...currentUser,
        accessToken: 'must-not-cross-the-boundary',
        refreshToken: 'must-not-cross-the-boundary',
        sessionToken: 'must-not-cross-the-boundary',
      }) as typeof currentUser,
  });

  const response = await GET(new Request('https://example.test/api/v1/me'));
  const serialized = await response.text();

  assert.equal(response.status, 200);
  assert.equal(serialized.includes('must-not-cross-the-boundary'), false);
});

void test('GET /api/v1/me returns the stable authentication error envelope', async () => {
  const GET = createCurrentUserHandler({
    createRequestId: () => 'generated-request-id',
    resolveCurrentUser: async () => null,
  });

  const response = await GET(
    new Request('https://example.test/api/v1/me', {
      headers: { 'x-request-id': 'caller-request-id' },
    }),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 401);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
  assert.deepEqual(body, {
    error: {
      code: 'not_authenticated',
      message: 'Authentication is required.',
      retryable: false,
      requestId: 'caller-request-id',
    },
  });
});

void test('GET /api/v1/me fails closed when service output violates the DTO', async () => {
  let capturedError: unknown;
  const GET = createCurrentUserHandler({
    createRequestId: () => 'request-3',
    onError: (error) => {
      capturedError = error;
    },
    resolveCurrentUser: async () =>
      ({ ...currentUser, athleteId: 123 }) as unknown as typeof currentUser,
  });

  const response = await GET(new Request('https://example.test/api/v1/me'));
  const body: unknown = await response.json();

  assert.equal(response.status, 500);
  assert.ok(capturedError instanceof Error);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
  assert.deepEqual(body, {
    error: {
      code: 'internal_error',
      message: 'The request could not be completed.',
      retryable: true,
      requestId: 'request-3',
    },
  });
});
