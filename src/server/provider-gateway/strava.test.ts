import assert from 'node:assert/strict';

import test from 'node:test';

import { AccountCredentialsUnavailableError } from '~/server/application/account-credentials';
import { StravaApiError } from '~/server/strava/client';
import {
  StravaBudgetBusyError,
  StravaBudgetExceededError,
} from '~/server/strava/request-budget';

import { gatewayFailureFor, readFromStrava } from './strava';

const owner = { userId: 'user-a', athleteId: 42 };
const account = (fields: object = {}) =>
  (async () => ({
    access_token: 'token',
    accountId: '42',
    revokedAt: null,
    scheduledErasureAt: null,
    ...fields,
  })) as never;

void test('each operation makes the matching provider read with the account token', async () => {
  const calls: unknown[] = [];
  const createClient = (token: string) => ({
    getActivity: async (id: number | string) => (
      calls.push(['activity', token, id]),
      1
    ),
    getActivityStreams: async (id: string) => (
      calls.push(['streams', token, id]),
      2
    ),
    getActivityPhotos: async (id: number | string) => (
      calls.push(['photos', token, id]),
      3
    ),
    getActivities: async (params: object) => (
      calls.push(['activities', token, params]),
      4
    ),
  });
  const read = (operation: Parameters<typeof readFromStrava>[1]) =>
    readFromStrava(owner, operation, {
      resolveAccount: account(),
      createClient: createClient as never,
    });
  // IDs stay strings: this one is not representable as a number.
  const large = '9007199254740993';
  assert.equal(await read({ kind: 'activity', id: large }), 1);
  assert.equal(await read({ kind: 'streams', id: large }), 2);
  assert.equal(await read({ kind: 'photos', id: large }), 3);
  assert.equal(
    await read({
      kind: 'activities',
      page: 2,
      perPage: 100,
      after: 1700000000,
    }),
    4,
  );
  assert.deepEqual(calls, [
    ['activity', 'token', '9007199254740993'],
    ['streams', 'token', '9007199254740993'],
    ['photos', 'token', '9007199254740993'],
    [
      'activities',
      'token',
      { page: 2, per_page: 100, before: undefined, after: 1700000000 },
    ],
  ]);
});

void test('an unusable account makes no provider request', async () => {
  for (const fields of [
    { access_token: null },
    { revokedAt: new Date() },
    { scheduledErasureAt: new Date() },
    // The account belongs to another athlete than the one asked for.
    { accountId: '43' },
  ])
    await assert.rejects(
      readFromStrava(
        owner,
        { kind: 'activity', id: '7' },
        {
          resolveAccount: account(fields),
          createClient: () => assert.fail('must not create a client'),
        },
      ),
      AccountCredentialsUnavailableError,
    );
});

void test('a credential conflict is read again, not reported as a lost connection', async () => {
  const conflict = () => new AccountCredentialsUnavailableError('changed');
  const resolveAfter = (conflicts: number) => {
    let calls = 0;
    const resolve = (async () => {
      if (calls++ < conflicts) throw conflict();
      return {
        access_token: 'fresh',
        accountId: '42',
        revokedAt: null,
        scheduledErasureAt: null,
      };
    }) as never;
    return { resolve, calls: () => calls };
  };
  const read = (resolveAccount: never) =>
    readFromStrava(
      owner,
      { kind: 'activity', id: '7' },
      {
        resolveAccount,
        createClient: ((token: string) => ({
          getActivity: async () => token,
        })) as never,
      },
    );

  // Another request saved newer credentials: the re-read finds them.
  const once = resolveAfter(1);
  assert.equal(await read(once.resolve), 'fresh');
  assert.equal(once.calls(), 2);

  // Bounded: a conflict that persists is given up, and stays retryable.
  const always = resolveAfter(Infinity);
  const error = await read(always.resolve).then(
    () => assert.fail('must reject'),
    (reason: unknown) => reason,
  );
  assert.equal(always.calls(), 3);
  assert.deepEqual(gatewayFailureFor(error), {
    kind: 'upstream_error',
    status: null,
    retryable: true,
  });

  // A revoked connection is not retried.
  let revokedCalls = 0;
  await assert.rejects(
    read((async () => {
      revokedCalls++;
      throw new AccountCredentialsUnavailableError('revoked');
    }) as never),
    AccountCredentialsUnavailableError,
  );
  assert.equal(revokedCalls, 1);
});

void test('errors map to failures the caller can act on', () => {
  assert.deepEqual(gatewayFailureFor(new StravaBudgetExceededError(90.2)), {
    kind: 'rate_limited',
    retryAfterSeconds: 91,
  });
  assert.deepEqual(gatewayFailureFor(new StravaBudgetBusyError()), {
    kind: 'rate_limited',
    retryAfterSeconds: 30,
  });
  assert.deepEqual(
    gatewayFailureFor(new StravaApiError('Too many', 429, undefined, 600)),
    { kind: 'rate_limited', retryAfterSeconds: 600 },
  );
  assert.deepEqual(gatewayFailureFor(new StravaApiError('Too many', 429)), {
    kind: 'rate_limited',
    retryAfterSeconds: 900,
  });
  assert.deepEqual(
    gatewayFailureFor(new AccountCredentialsUnavailableError('revoked')),
    { kind: 'credentials_rejected' },
  );
  assert.deepEqual(gatewayFailureFor(new StravaApiError('Unauthorized', 401)), {
    kind: 'credentials_rejected',
  });
  // A missing activity permission is a 401 too, but not a rejected token.
  assert.deepEqual(
    gatewayFailureFor(
      new StravaApiError('Authorization Error', 401, [
        {
          resource: 'AccessToken',
          field: 'activity:read_permission',
          code: 'missing',
        },
      ]),
    ),
    { kind: 'forbidden' },
  );
  assert.deepEqual(
    gatewayFailureFor(new StravaApiError('Record Not Found', 404)),
    { kind: 'not_found' },
  );
  // A 404 that does not prove deletion is not reported as one.
  assert.deepEqual(gatewayFailureFor(new StravaApiError('Not Found', 404)), {
    kind: 'upstream_error',
    status: 404,
    retryable: false,
  });
  assert.deepEqual(gatewayFailureFor(new StravaApiError('Bad gateway', 502)), {
    kind: 'upstream_error',
    status: 502,
    retryable: true,
  });
  assert.deepEqual(gatewayFailureFor(new TypeError('fetch failed')), {
    kind: 'upstream_error',
    status: null,
    retryable: true,
  });
  assert.equal(gatewayFailureFor(new Error('a bug')), null);
});
