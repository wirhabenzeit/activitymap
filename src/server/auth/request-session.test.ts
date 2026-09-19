import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveRequestSession } from './request-session';

void test('a session query parameter cannot authenticate a request', async () => {
  const request = new Request(
    'https://activitymap.example/api/db?session=url-session-secret',
  );

  const session = await resolveRequestSession(request, async ({ headers }) => {
    const hasHeaderCredential =
      headers.has('authorization') || headers.has('cookie');

    return hasHeaderCredential ? { user: { id: 'authenticated' } } : null;
  });

  assert.equal(session, null);
});

void test('header-based authentication remains available', async () => {
  const request = new Request('https://activitymap.example/api/db', {
    headers: { Authorization: 'Bearer application-session' },
  });

  const session = await resolveRequestSession(request, async ({ headers }) =>
    headers.has('authorization') ? { user: { id: 'authenticated' } } : null,
  );

  assert.deepEqual(session, { user: { id: 'authenticated' } });
});
