import assert from 'node:assert/strict';

import test from 'node:test';

import { responseEnvelope } from '~/contracts/v1/envelope.ts';
import { errorEnvelopeSchema } from '~/contracts/v1/error.ts';
import { stravaAppAttemptResponseDTOSchema } from '~/contracts/v1/mobile-auth.ts';

import { createStravaAppAttemptHandler } from './handler.ts';

const now = new Date('2026-11-21T10:00:00.000Z');
const STATE = 'client-generated-state-0123456789';
const CHALLENGE = 'pkce-challenge-0123456789-abcdefghij';
const config = {
  clientId: '1234',
  redirectUri: 'https://activitymap.cc/auth/strava',
};

function post(body: unknown) {
  return new Request('https://example.test/api/v1/auth/mobile/strava/attempt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function handler(
  overrides: Partial<Parameters<typeof createStravaAppAttemptHandler>[0]> = {},
) {
  const started: Array<{ state: string; pkceChallenge: string }> = [];
  const POST = createStravaAppAttemptHandler({
    now: () => now,
    loadConfig: () => config,
    startAttempt: async (input) => {
      started.push(input);
      return { expiresAt: new Date(now.getTime() + 600_000) };
    },
    buildAuthorizationUrl: (_config, params) =>
      `strava://oauth/mobile/authorize?state=${params.state}&force=${params.forceConsent}`,
    ...overrides,
  });
  return { POST, started };
}

void test('registers the attempt and returns the Strava app URL', async () => {
  const { POST, started } = handler();
  const response = await POST(post({ state: STATE, codeChallenge: CHALLENGE }));
  const body: unknown = await response.json();

  assert.equal(response.status, 200);
  assert.equal(
    responseEnvelope(stravaAppAttemptResponseDTOSchema).safeParse(body).success,
    true,
  );
  assert.deepEqual(started, [{ state: STATE, pkceChallenge: CHALLENGE }]);
  assert.deepEqual((body as { data: unknown }).data, {
    authorizationUrl: `strava://oauth/mobile/authorize?state=${STATE}&force=false`,
    expiresAt: '2026-11-21T10:10:00.000Z',
  });
});

void test('forceConsent is passed through for a reconnect', async () => {
  const { POST } = handler();
  const response = await POST(
    post({ state: STATE, codeChallenge: CHALLENGE, forceConsent: true }),
  );
  const body = (await response.json()) as {
    data: { authorizationUrl: string };
  };
  assert.match(body.data.authorizationUrl, /force=true/);
});

void test('an unconfigured deployment answers 503 and stores nothing', async () => {
  const { POST, started } = handler({ loadConfig: () => null });
  const response = await POST(post({ state: STATE, codeChallenge: CHALLENGE }));
  const body: unknown = await response.json();

  assert.equal(response.status, 503);
  assert.equal(
    errorEnvelopeSchema.parse(body).error.code,
    'strava_app_sign_in_unavailable',
  );
  assert.equal(started.length, 0);
});

void test('a short or missing state or challenge is rejected', async () => {
  const { POST, started } = handler();
  for (const body of [
    {},
    { state: 'short', codeChallenge: CHALLENGE },
    { state: STATE, codeChallenge: 'short' },
    { state: STATE },
  ]) {
    const response = await POST(post(body));
    assert.equal(response.status, 400);
    assert.equal(
      errorEnvelopeSchema.parse(await response.json()).error.code,
      'validation_failed',
    );
  }
  assert.equal(started.length, 0);
});

void test('a non-JSON body is rejected', async () => {
  const { POST } = handler();
  const response = await POST(
    new Request('https://example.test/x', { method: 'POST', body: 'nope' }),
  );
  assert.equal(response.status, 400);
});

void test('a storage failure is a retryable 500 that is reported', async () => {
  const reported: unknown[] = [];
  const { POST } = handler({
    startAttempt: async () => {
      throw new Error('store down');
    },
    onError: (error) => reported.push(error),
  });
  const response = await POST(post({ state: STATE, codeChallenge: CHALLENGE }));
  const body = errorEnvelopeSchema.parse(await response.json());
  assert.equal(response.status, 500);
  assert.equal(body.error.retryable, true);
  assert.equal(reported.length, 1);
});
