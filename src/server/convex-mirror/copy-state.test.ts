import assert from 'node:assert/strict';

import test from 'node:test';

import { copyState } from './copy-state';

void test('an account is ready once its full copy and photo catch-up are done', () => {
  const position = { sequence: 10, revision: 1 };
  assert.equal(copyState(null), 'none');
  assert.equal(copyState({ revoked: true, mirror: position }), 'none');
  // Provisioned, and the mirror has not run yet.
  assert.equal(copyState({ revoked: false, mirror: null }), 'copying');
  assert.equal(
    copyState({
      revoked: false,
      mirror: { ...position, full: { after: '7', through: 10 } },
    }),
    'copying',
  );
  assert.equal(
    copyState({ revoked: false, mirror: { ...position, photos: '7' } }),
    'copying',
  );
  assert.equal(copyState({ revoked: false, mirror: position }), 'ready');
  assert.equal(
    copyState({ revoked: false, mirror: { ...position, photos: null } }),
    'ready',
  );
});
