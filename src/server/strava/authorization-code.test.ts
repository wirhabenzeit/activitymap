import assert from 'node:assert/strict';

import test from 'node:test';

import {
  StravaCodeRejectedError,
  StravaUnavailableError,
  exchangeStravaAuthorizationCode,
} from './authorization-code.ts';

const environment = {
  ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled',
  AUTH_STRAVA_ID: '1234',
  AUTH_STRAVA_SECRET: 'shh',
};

function reply(status: number, json?: unknown): typeof fetch {
  return async () =>
    new Response(json === undefined ? null : JSON.stringify(json), {
      status,
    });
}

void test('exchanges the code with the client secret and parses the tokens', async () => {
  let request: { url: string; body: Record<string, unknown> } | undefined;
  const tokens = await exchangeStravaAuthorizationCode('the-code', {
    environment,
    fetchImpl: (async (url: string, init?: RequestInit) => {
      request = {
        url,
        body: JSON.parse(init?.body as string) as Record<string, unknown>,
      };
      return Response.json({
        access_token: 'a',
        refresh_token: 'r',
        expires_at: 1_800_000_000,
        athlete: { id: 1 },
      });
    }) as typeof fetch,
  });

  assert.deepEqual(request, {
    url: 'https://www.strava.com/api/v3/oauth/token',
    body: {
      client_id: '1234',
      client_secret: 'shh',
      code: 'the-code',
      grant_type: 'authorization_code',
    },
  });
  assert.equal(tokens.accessToken, 'a');
  assert.equal(tokens.refreshToken, 'r');
  assert.equal(tokens.accessTokenExpiresAt.getTime(), 1_800_000_000_000);
});

void test('a 400 from Strava means the code was rejected', async () => {
  await assert.rejects(
    exchangeStravaAuthorizationCode('x', {
      environment,
      fetchImpl: reply(400, {}),
    }),
    StravaCodeRejectedError,
  );
});

void test('other failures and bad responses are Strava being unavailable', async () => {
  for (const fetchImpl of [
    reply(500),
    reply(429),
    reply(200, { nope: true }),
    async () => {
      throw new TypeError('network');
    },
  ]) {
    await assert.rejects(
      exchangeStravaAuthorizationCode('x', { environment, fetchImpl }),
      StravaUnavailableError,
    );
  }
});

void test('missing credentials never reach the network', async () => {
  let called = false;
  await assert.rejects(
    exchangeStravaAuthorizationCode('x', {
      environment: { ACTIVITYMAP_EXTERNAL_EFFECTS: 'enabled' },
      fetchImpl: async () => {
        called = true;
        return Response.json({});
      },
    }),
    StravaUnavailableError,
  );
  assert.equal(called, false);
});

void test('is refused where Strava access is disabled', async () => {
  await assert.rejects(
    exchangeStravaAuthorizationCode('x', {
      environment: {},
      fetchImpl: reply(200, {}),
    }),
    /External effects are disabled/,
  );
});
