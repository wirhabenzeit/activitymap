import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountDeletionHandler } from './handler';
import { responseEnvelope } from '~/contracts/v1/envelope';
import { deleteAccountResultSchema } from '~/contracts/v1/account-deletion';
import { errorEnvelopeSchema } from '~/contracts/v1/error';

function setup(
  options: { authenticated?: boolean; active?: boolean; fail?: boolean } = {},
) {
  const calls: unknown[][] = [];
  const handler = createAccountDeletionHandler({
    now: () => new Date('2026-10-11T12:00:00Z'),
    resolveSession: async () =>
      options.authenticated === false
        ? null
        : { userId: 'current-user', token: 'current-token' },
    deleteForSession: async (...args) => {
      calls.push(args);
      if (options.fail) throw new Error('database unavailable');
      return options.active !== false;
    },
  });
  return { handler, calls };
}
function request(
  body: unknown = { confirmation: 'DELETE' },
  headers: Record<string, string> = {},
) {
  return new Request('https://activitymap.cc/api/v1/account/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://activitymap.cc',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

void test('confirmed deletion targets only the authenticated session and returns the v1 envelope', async () => {
  const { handler, calls } = setup();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(calls, [
    ['current-user', 'current-token', new Date('2026-10-11T12:00:00Z')],
  ]);
  assert.equal(
    responseEnvelope(deleteAccountResultSchema).parse(await response.json())
      .data.status,
    'deleted',
  );
});
void test('unauthenticated or revoked sessions cannot delete', async () => {
  for (const options of [{ authenticated: false }, { active: false }]) {
    const { handler, calls } = setup(options);
    assert.equal((await handler(request())).status, 401);
    assert.equal(calls.length, options.authenticated === false ? 0 : 1);
  }
});
void test('cookie deletion rejects missing and cross-origin requests, even with an authorization header', async () => {
  const cases: Record<string, string>[] = [
    { Origin: '' },
    { Origin: 'https://evil.example' },
    { Origin: 'https://evil.example', Authorization: 'Bearer signed-token' },
  ];
  for (const headers of cases) {
    const { handler, calls } = setup();
    assert.equal((await handler(request(undefined, headers))).status, 403);
    assert.equal(calls.length, 0);
  }
});
void test('native signed-bearer requests do not require a browser Origin', async () => {
  const { handler } = setup();
  assert.equal(
    (
      await handler(
        request(undefined, {
          Origin: '',
          Authorization: 'Bearer signed-token',
        }),
      )
    ).status,
    200,
  );
});
void test('confirmation is required and a caller cannot supply a target user', async () => {
  for (const body of [
    null,
    {},
    { confirmation: false },
    { confirmation: 'delete' },
    { confirmation: 'DELETE', userId: 'someone-else' },
  ]) {
    const { handler, calls } = setup();
    assert.equal((await handler(request(body))).status, 400);
    assert.equal(calls.length, 0);
  }
});
void test('malformed JSON and non-JSON requests never reach deletion', async () => {
  const { handler, calls } = setup();
  const malformed = new Request(request().url, {
    method: 'POST',
    headers: request().headers,
    body: '{',
  });
  assert.equal((await handler(malformed)).status, 400);
  assert.equal(
    (await handler(request(undefined, { 'Content-Type': 'text/plain' })))
      .status,
    400,
  );
  assert.equal(calls.length, 0);
});
void test('database errors do not report deletion success or disclose internal details', async () => {
  const { handler } = setup({ fail: true });
  const response = await handler(request());
  assert.equal(response.status, 500);
  const body = errorEnvelopeSchema.parse(await response.json());
  assert.equal(body.error.retryable, true);
  assert.ok(!JSON.stringify(body).includes('database unavailable'));
});
