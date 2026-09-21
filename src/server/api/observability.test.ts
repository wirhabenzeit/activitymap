import assert from 'node:assert/strict';
import test from 'node:test';

import { withApiV1Observability } from './observability.ts';

void test('withApiV1Observability propagates the caller-supplied requestId into the handler and the response header', async () => {
  let seenRequestId: string | null = null;
  const handler = async (request: Request) => {
    seenRequestId = request.headers.get('x-request-id');
    return Response.json({ ok: true });
  };
  const wrapped = withApiV1Observability(handler, { route: 'GET /api/v1/test' });

  const response = await wrapped(
    new Request('https://example.com', { headers: { 'x-request-id': 'client-req-1' } }),
  );

  assert.equal(seenRequestId, 'client-req-1');
  assert.equal(response.headers.get('x-request-id'), 'client-req-1');
});

void test('withApiV1Observability generates a requestId when the caller supplies none', async () => {
  let seenRequestId: string | null = null;
  const handler = async (request: Request) => {
    seenRequestId = request.headers.get('x-request-id');
    return Response.json({ ok: true });
  };
  const wrapped = withApiV1Observability(handler, {
    route: 'GET /api/v1/test',
    createRequestId: () => 'generated-id',
  });

  const response = await wrapped(new Request('https://example.com'));

  assert.equal(seenRequestId, 'generated-id');
  assert.equal(response.headers.get('x-request-id'), 'generated-id');
});

void test('withApiV1Observability preserves the handler response body and status', async () => {
  const handler = async () => Response.json({ hello: 'world' }, { status: 201 });
  const wrapped = withApiV1Observability(handler, { route: 'POST /api/v1/test' });

  const response = await wrapped(new Request('https://example.com', { method: 'POST' }));

  assert.equal(response.status, 201);
  const body = (await response.json()) as { hello: string };
  assert.deepEqual(body, { hello: 'world' });
});

void test('withApiV1Observability preserves a redirect response, tagging it with the requestId', async () => {
  const handler = async () => Response.redirect('https://example.com/next', 302);
  const wrapped = withApiV1Observability(handler, {
    route: 'GET /api/v1/auth/mobile/start',
    createRequestId: () => 'redirect-req',
  });

  const response = await wrapped(new Request('https://example.com'));

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://example.com/next');
  assert.equal(response.headers.get('x-request-id'), 'redirect-req');
});

void test('withApiV1Observability tags a POST request with a JSON body through to the handler unchanged', async () => {
  let seenBody: unknown = null;
  const handler = async (request: Request) => {
    seenBody = await request.json();
    return Response.json({ ok: true });
  };
  const wrapped = withApiV1Observability(handler, { route: 'POST /api/v1/test' });

  await wrapped(
    new Request('https://example.com', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ a: 1 }),
    }),
  );

  assert.deepEqual(seenBody, { a: 1 });
});

void test('withApiV1Observability records elapsed time via the injectable clock', async () => {
  const ticks = [0, 42];
  const handler = async () => Response.json({ ok: true });
  const wrapped = withApiV1Observability(handler, {
    route: 'GET /api/v1/test',
    now: () => ticks.shift() ?? 0,
  });

  // No direct assertion on the log line's exact numbers (logging is a side
  // effect, not this module's return value) - this proves the clock is
  // actually invoked twice (start and end) and the call completes normally.
  const response = await wrapped(new Request('https://example.com'));
  assert.equal(response.status, 200);
  assert.equal(ticks.length, 0);
});

void test('withApiV1Observability still tags a response and does not throw when the inner handler throws', async () => {
  const handler = async (): Promise<Response> => {
    throw new Error('boom');
  };
  const wrapped = withApiV1Observability(handler, {
    route: 'GET /api/v1/test',
    createRequestId: () => 'thrown-req',
  });

  const response = await wrapped(new Request('https://example.com'));
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('x-request-id'), 'thrown-req');
  const body = (await response.json()) as { error: { code: string } };
  assert.equal(body.error.code, 'internal_error');
});
