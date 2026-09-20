import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LEGACY_SHARING_ENABLED,
  LegacySharingDisabledError,
  assertLegacySharingEnabled,
} from './legacy-sharing';

void test('legacy sharing is disabled by default (Part of #132)', () => {
  assert.equal(
    LEGACY_SHARING_ENABLED,
    false,
    'the legacy sharing kill switch must stay off until the #132 replacement ships',
  );
});

void test('assertLegacySharingEnabled throws LegacySharingDisabledError while disabled', () => {
  assert.throws(() => assertLegacySharingEnabled(), LegacySharingDisabledError);
});

void test('assertLegacySharingEnabled points readers at issue #132', () => {
  try {
    assertLegacySharingEnabled();
    assert.fail('expected assertLegacySharingEnabled to throw');
  } catch (error) {
    assert.ok(error instanceof LegacySharingDisabledError);
    assert.match(error.message, /issues\/132/);
  }
});
