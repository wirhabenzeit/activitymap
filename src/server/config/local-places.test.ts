import assert from 'node:assert/strict';

import test from 'node:test';

import { localPlacesEnabled } from './local-places';

void test('places prototype only reads in local development', () => {
  assert.equal(localPlacesEnabled({ NODE_ENV: 'development' }), true);
  assert.equal(localPlacesEnabled({ NODE_ENV: 'production' }), false);
  assert.equal(
    localPlacesEnabled({ NODE_ENV: 'development', VERCEL: '1' }),
    false,
  );
  assert.equal(
    localPlacesEnabled({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://user:pass@remote.example/main',
    }),
    false,
  );
  assert.equal(
    localPlacesEnabled({
      NODE_ENV: 'development',
      NEON_DATABASE_URL: 'postgres://user:pass@remote.example/main',
      DATABASE_URL: 'postgres://postgres:postgres@localhost/main',
    }),
    false,
  );
});
