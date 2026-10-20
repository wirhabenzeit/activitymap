import assert from 'node:assert/strict';

import test from 'node:test';

import {
  ACTIVITY_DESCRIPTION_MAX_LENGTH,
  ACTIVITY_NAME_MAX_LENGTH,
} from '~/contracts/v1/activity-mutations';

import { activityEditCommand } from './activity-edit';

const original = {
  name: 'Ride',
  description: 'Old description',
  sportType: 'Ride' as const,
};
void test('clearing a description reaches the command as an empty string', () => {
  assert.deepEqual(
    activityEditCommand(original, { ...original, description: '' }),
    { description: '' },
  );
});
void test('one-character names are accepted and unchanged fields are omitted', () => {
  assert.deepEqual(activityEditCommand(original, { ...original, name: 'A' }), {
    name: 'A',
  });
  assert.throws(() => activityEditCommand(original, original));
});
void test('form boundary validates whitespace, limits and sport protocol values', () => {
  for (const name of ['', ' \n ', 'x'.repeat(ACTIVITY_NAME_MAX_LENGTH + 1)]) {
    assert.throws(() => activityEditCommand(original, { ...original, name }));
  }
  assert.doesNotThrow(() =>
    activityEditCommand(original, {
      ...original,
      name: 'x'.repeat(ACTIVITY_NAME_MAX_LENGTH),
    }),
  );
  assert.doesNotThrow(() =>
    activityEditCommand(original, {
      ...original,
      description: 'x'.repeat(ACTIVITY_DESCRIPTION_MAX_LENGTH),
    }),
  );
  assert.throws(() =>
    activityEditCommand(original, {
      ...original,
      description: 'x'.repeat(ACTIVITY_DESCRIPTION_MAX_LENGTH + 1),
    }),
  );
  assert.throws(() =>
    activityEditCommand(original, { ...original, sportType: 'not-a-sport' }),
  );
});
