import assert from 'node:assert/strict';
import test from 'node:test';

import { adminAthleteIds, isAdminAthlete } from './admin.ts';

void test('admin athlete ids are read from a comma- or space-separated list', () => {
  assert.deepEqual(
    [
      ...adminAthleteIds({
        ACTIVITYMAP_ADMIN_ATHLETE_IDS: ' 123, 456 789,,not-a-number ',
      }),
    ],
    [123, 456, 789],
  );
});

void test('nobody is an admin when the variable is unset or empty', () => {
  assert.equal(isAdminAthlete(123, {}), false);
  assert.equal(
    isAdminAthlete(123, { ACTIVITYMAP_ADMIN_ATHLETE_IDS: '' }),
    false,
  );
});

void test('only listed athletes are admins, and a missing athlete id never is', () => {
  const environment = { ACTIVITYMAP_ADMIN_ATHLETE_IDS: '123' };
  assert.equal(isAdminAthlete(123, environment), true);
  assert.equal(isAdminAthlete(124, environment), false);
  assert.equal(isAdminAthlete(null, environment), false);
  assert.equal(isAdminAthlete(undefined, environment), false);
});
