import assert from 'node:assert/strict';
import test from 'node:test';

import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { responseEnvelope } from '~/contracts/v1/envelope.ts';
import { mobileSessionListDTOSchema } from '~/contracts/v1/mobile-auth.ts';
import { createListSessionsHandler } from './handler.ts';

const now = new Date('2026-09-20T12:00:00.000Z');

void test('GET /api/v1/auth/sessions marks the caller-authenticated session as current', async () => {
  const GET = createListSessionsHandler({
    now: () => now,
    resolveSessions: async () => ({
      currentToken: 'token-a',
      sessions: [
        {
          token: 'token-a',
          createdAt: new Date('2026-09-01T00:00:00.000Z'),
          expiresAt: new Date('2026-10-01T00:00:00.000Z'),
          ipAddress: '203.0.113.1',
          userAgent: 'ActivityMap-iOS/1.0',
        },
        {
          token: 'token-b',
          createdAt: new Date('2026-08-01T00:00:00.000Z'),
          expiresAt: new Date('2026-09-01T00:00:00.000Z'),
          ipAddress: null,
          userAgent: 'Mozilla/5.0',
        },
      ],
    }),
  });

  const response = await GET(
    new Request('https://example.test/api/v1/auth/sessions'),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    responseEnvelope(mobileSessionListDTOSchema).safeParse(body).success,
    true,
  );
  const data = (body as { data: { sessions: { token: string; isCurrent: boolean }[] } })
    .data;
  assert.equal(
    data.sessions.find((s) => s.token === 'token-a')?.isCurrent,
    true,
  );
  assert.equal(
    data.sessions.find((s) => s.token === 'token-b')?.isCurrent,
    false,
  );
});

void test('GET /api/v1/auth/sessions returns not_authenticated without a session', async () => {
  const GET = createListSessionsHandler({
    now: () => now,
    resolveSessions: async () => null,
  });

  const response = await GET(
    new Request('https://example.test/api/v1/auth/sessions'),
  );
  const body: unknown = await response.json();

  assert.equal(response.status, 401);
  assert.equal(errorEnvelopeSchema.safeParse(body).success, true);
});
