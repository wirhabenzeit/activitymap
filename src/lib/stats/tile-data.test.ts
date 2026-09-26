import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { aliasMap } from '~/settings/category';
import { type Activity } from '~/server/db/schema';

import {
  activityCalendar,
  consistency,
  dayFromISODate,
  distanceVsElevation,
  isoDate,
  monthVsLastMonth,
  sportMix,
  totals,
  weeklyVolume,
  yearToDate,
  type StatsActivity,
} from './tile-data';

type Fixture = {
  description: string;
  today: string;
  activities: {
    sportType: Activity['sport_type'];
    startDateLocal: string;
    distance: number | null;
    movingTime: number | null;
    elevationGain: number | null;
  }[];
  expected: {
    yearToDate?: Record<
      'count' | 'distance' | 'elevation' | 'time',
      Comparison
    >;
    totals?: Record<'count' | 'distance' | 'elevation' | 'time', number>;
    weeklyVolume?: { weekStarts: string[]; distance: number[] };
    activityCalendar?: {
      activeDays: number;
      dominantSport: Record<string, string>;
    };
    monthVsLastMonth?: Partial<
      Record<'count' | 'distance' | 'elevation' | 'time', Comparison>
    >;
    sportMix?: { currentYear: { sport: string; share: number }[] };
    consistency?: { activeDaysPerWeek: number; currentStreak: number };
    distanceVsElevation?: { activities: number; metersPerKm: number };
  };
};
type Comparison = { current: number; previous: number };

const tolerance = 0.000001;

function assertClose(actual: number, expected: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual}`,
  );
}

const fixturesDirectory = resolve(process.cwd(), 'shared/stats-fixtures');

for (const name of readdirSync(fixturesDirectory).filter((file) =>
  file.endsWith('.json'),
)) {
  const fixture = JSON.parse(
    readFileSync(resolve(fixturesDirectory, name), 'utf8'),
  ) as Fixture;
  const today = dayFromISODate(fixture.today);
  const activities: StatsActivity[] = fixture.activities.map((activity) => ({
    sport: aliasMap[activity.sportType] ?? 'misc',
    start_date_local: new Date(`${activity.startDateLocal}Z`),
    distance: activity.distance,
    moving_time: activity.movingTime,
    total_elevation_gain: activity.elevationGain,
  }));
  const { expected } = fixture;

  void test(`${name}: tiles match the shared fixture`, async (t) => {
    if (expected.yearToDate) {
      await t.test('yearToDate', () => {
        for (const [metric, comparison] of Object.entries(
          expected.yearToDate!,
        )) {
          const actual = yearToDate(
            activities,
            today,
            metric as keyof typeof comparison & 'count',
          );
          assertClose(actual.current, comparison.current, `${metric} current`);
          assertClose(
            actual.previous,
            comparison.previous,
            `${metric} previous`,
          );
        }
      });
    }

    if (expected.totals) {
      await t.test('totals', () => {
        const actual = totals(activities, today);
        for (const [metric, value] of Object.entries(expected.totals!)) {
          assertClose(actual[metric as keyof typeof actual], value, metric);
        }
      });
    }

    if (expected.weeklyVolume) {
      await t.test('weeklyVolume', () => {
        const actual = weeklyVolume(activities, today, 'distance');
        assert.deepEqual(
          actual.weekStarts.map(isoDate),
          expected.weeklyVolume!.weekStarts,
        );
        expected.weeklyVolume!.distance.forEach((value, index) =>
          assertClose(actual.values[index]!, value, `week ${index}`),
        );
      });
    }

    if (expected.activityCalendar) {
      await t.test('activityCalendar', () => {
        const actual = activityCalendar(activities, today);
        assert.equal(actual.activeDays, expected.activityCalendar!.activeDays);
        assert.deepEqual(
          Object.fromEntries(
            [...actual.dominantSport]
              .sort(([a], [b]) => a - b)
              .map(([day, sport]) => [isoDate(day), sport]),
          ),
          expected.activityCalendar!.dominantSport,
        );
      });
    }

    if (expected.monthVsLastMonth) {
      await t.test('monthVsLastMonth', () => {
        for (const [metric, comparison] of Object.entries(
          expected.monthVsLastMonth!,
        )) {
          const actual = monthVsLastMonth(activities, today, metric as 'count');
          assertClose(actual.current, comparison.current, `${metric} current`);
          assertClose(
            actual.previous,
            comparison.previous,
            `${metric} previous`,
          );
        }
      });
    }

    if (expected.sportMix) {
      await t.test('sportMix', () => {
        const actual = sportMix(activities, today, 'currentYear');
        assert.deepEqual(
          actual.map(({ sport }) => sport),
          expected.sportMix!.currentYear.map(({ sport }) => sport),
        );
        expected.sportMix!.currentYear.forEach(({ sport, share }, index) =>
          assertClose(actual[index]!.share, share, sport),
        );
      });
    }

    if (expected.consistency) {
      await t.test('consistency', () => {
        const actual = consistency(activities, today);
        assertClose(
          actual.activeDaysPerWeek,
          expected.consistency!.activeDaysPerWeek,
          'activeDaysPerWeek',
        );
        assert.equal(actual.currentStreak, expected.consistency!.currentStreak);
      });
    }

    if (expected.distanceVsElevation) {
      await t.test('distanceVsElevation', () => {
        const actual = distanceVsElevation(activities, today);
        assert.equal(
          actual.points.length,
          expected.distanceVsElevation!.activities,
        );
        assertClose(
          actual.metersPerKm,
          expected.distanceVsElevation!.metersPerKm,
          'metersPerKm',
        );
      });
    }
  });
}
