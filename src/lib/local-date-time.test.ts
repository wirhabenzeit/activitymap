import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  formatLocalDate,
  formatLocalDateTime,
  formatLocalTime,
} from './local-date-time';

const time = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
const date = { day: 'numeric', month: 'short', year: 'numeric' } as const;

// Summer: Strava stores 12:06 wall-clock time for a Zurich activity (UTC+2).
const summer = '2026-09-22T12:06:27.000Z';
// Winter: 23:30 wall-clock time for a Zurich activity (UTC+1).
const winter = '2026-01-15T23:30:00.000Z';

const withViewerTimeZone = (timeZone: string) => {
  let previous: string | undefined;
  before(() => {
    previous = process.env.TZ;
    process.env.TZ = timeZone;
  });
  after(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
};

void describe('local wall-clock formatting (#274)', () => {
  for (const viewer of [
    'UTC',
    'Europe/Zurich',
    'America/Los_Angeles',
    'Pacific/Auckland',
  ]) {
    void describe(`viewer in ${viewer}`, () => {
      withViewerTimeZone(viewer);

      void test('summer activity keeps its wall-clock time and date', () => {
        assert.equal(formatLocalTime(summer, time, 'en-US'), '12:06');
        assert.equal(formatLocalDate(summer, date, 'en-US'), 'Sep 22, 2026');
        assert.equal(
          formatLocalDateTime(new Date(summer), { ...date, ...time }, 'en-US'),
          'Sep 22, 2026, 12:06',
        );
      });

      void test('winter activity near midnight does not roll over a day', () => {
        assert.equal(formatLocalTime(winter, time, 'en-US'), '23:30');
        assert.equal(formatLocalDate(winter, date, 'en-US'), 'Jan 15, 2026');
      });
    });
  }

  void describe('viewer timezone differs from the activity timezone', () => {
    withViewerTimeZone('Europe/Zurich');

    void test('naive formatting would shift the time (guards the test setup)', () => {
      assert.equal(new Date(summer).toLocaleTimeString('en-US', time), '14:06');
      assert.equal(
        new Date(winter).toLocaleDateString('en-US', date),
        'Jan 16, 2026',
      );
    });

    void test('a caller-supplied timeZone cannot override UTC', () => {
      assert.equal(
        formatLocalTime(
          summer,
          { ...time, timeZone: 'Europe/Zurich' },
          'en-US',
        ),
        '12:06',
      );
    });
  });
});
