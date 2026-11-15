import assert from 'node:assert/strict';

import { test } from 'node:test';

import { sportTitle } from './sport-title';

void test('sportTitle humanizes protocol sport values in sentence case', () => {
  assert.equal(sportTitle('Run'), 'Run');
  assert.equal(sportTitle('MountainBikeRide'), 'Mountain bike ride');
  assert.equal(sportTitle('EBikeRide'), 'E-bike ride');
  assert.equal(sportTitle('EMountainBikeRide'), 'E-mountain bike ride');
  assert.equal(
    sportTitle('HighIntensityIntervalTraining'),
    'High intensity interval training',
  );
});
