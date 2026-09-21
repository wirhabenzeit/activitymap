import assert from 'node:assert/strict';
import test from 'node:test';

import { requestIdFor, withRequestIdHeader } from './request-id.ts';

void test('requestIdFor returns the caller-supplied x-request-id header, trimmed', () => {
  const request = new Request('https://example.com', {
    headers: { 'x-request-id': '  caller-id-1  ' },
  });
  assert.equal(
    requestIdFor(request, () => 'generated'),
    'caller-id-1',
  );
});

void test('requestIdFor generates one when the header is absent or blank', () => {
  assert.equal(
    requestIdFor(new Request('https://example.com'), () => 'generated'),
    'generated',
  );
  assert.equal(
    requestIdFor(
      new Request('https://example.com', { headers: { 'x-request-id': '   ' } }),
      () => 'generated',
    ),
    'generated',
  );
});

void test('withRequestIdHeader sets x-request-id on a GET request with no body', async () => {
  const request = new Request('https://example.com/api/v1/me', {
    headers: { authorization: 'Bearer token' },
  });
  const tagged = await withRequestIdHeader(request, 'req-123');

  assert.equal(tagged.headers.get('x-request-id'), 'req-123');
  assert.equal(tagged.headers.get('authorization'), 'Bearer token');
  assert.equal(tagged.method, 'GET');
});

void test('withRequestIdHeader preserves a JSON body on a POST request', async () => {
  const request = new Request('https://example.com/api/v1/auth/mobile/exchange', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: 'abc' }),
  });
  const tagged = await withRequestIdHeader(request, 'req-456');

  assert.equal(tagged.headers.get('x-request-id'), 'req-456');
  assert.equal(tagged.method, 'POST');
  const body = (await tagged.json()) as { code: string };
  assert.equal(body.code, 'abc');
});

void test('withRequestIdHeader overwrites an existing x-request-id header', async () => {
  const request = new Request('https://example.com', {
    headers: { 'x-request-id': 'old' },
  });
  const tagged = await withRequestIdHeader(request, 'new');
  assert.equal(tagged.headers.get('x-request-id'), 'new');
});
