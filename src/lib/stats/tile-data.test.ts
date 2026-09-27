import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import { aliasMap } from '~/settings/category';
import { type Activity } from '~/server/db/schema';

import {
  activityCalendar,
  best30Days,
  climbing,
  consistency,
  dayFromISODate,
  distanceVsElevation,
  fourWeekVolume,
  isoDate,
  monthVsLastMonth,
  records,
  restDays,
  sportMix,
  thisWeek,
  totals,
  typicalWeek,
  weeklyVolume,
  yearPace,
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
    weeklyVolume?: {
      weekStarts: string[];
      distance: number[];
      lastFourWeeks?: Partial<Record<Metric, Comparison>>;
    };
    activityCalendar?: {
      activeDays: number;
      dominantSport: Record<string, string>;
    };
    monthVsLastMonth?: Partial<
      Record<'count' | 'distance' | 'elevation' | 'time', Comparison>
    >;
    sportMix?: { currentYear: { sport: string; share: number }[] };
    consistency?: {
      activeDaysPerWeek: number;
      currentStreak: number;
      solidWeeks?: number;
    };
    distanceVsElevation?: {
      activities: number;
      metersPerKm: number;
      climbing?: {
        current: number;
        previous: number;
        months: { monthStart: string; rate: number }[];
      };
    };
    thisWeek?: Partial<
      Record<
        Metric,
        { days?: (number | null)[]; current: number; typical: number }
      >
    >;
    typicalWeek?: Record<Metric | 'activeDays', number>;
    yearPace?: Partial<
      Record<
        Metric,
        { current: number; perDay: number; projected: number; lastYear: number }
      >
    >;
    records?: Partial<
      Record<
        'currentYear' | 'allTime',
        {
          distance: ExpectedRecord;
          time: ExpectedRecord;
          elevation: ExpectedRecord;
          biggestWeek: { value: number; weekStart: string };
        }
      >
    >;
    best30Days?: Partial<
      Record<
        Metric,
        { total: number; start: string; end: string; current: number }
      >
    >;
    restDays?: { last30: number; last90: number };
  };
};
type Metric = 'count' | 'distance' | 'elevation' | 'time';
type ExpectedRecord = { value: number; day: string };
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
        for (const [metric, comparison] of Object.entries(
          expected.weeklyVolume!.lastFourWeeks ?? {},
        )) {
          const lastFour = fourWeekVolume(activities, today, metric as Metric);
          assertClose(
            lastFour.current,
            comparison.current,
            `${metric} 4 weeks`,
          );
          assertClose(
            lastFour.previous,
            comparison.previous,
            `${metric} 4 weeks before`,
          );
        }
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
        if (expected.consistency!.solidWeeks !== undefined)
          assert.equal(actual.solidWeeks, expected.consistency!.solidWeeks);
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
        const expectedClimbing = expected.distanceVsElevation!.climbing;
        if (expectedClimbing) {
          const actualClimbing = climbing(activities, today);
          assertClose(
            actualClimbing.current,
            expectedClimbing.current,
            'climb',
          );
          assertClose(
            actualClimbing.previous,
            expectedClimbing.previous,
            'climb before',
          );
          assert.deepEqual(
            actualClimbing.months.map(({ monthStart }) => isoDate(monthStart)),
            expectedClimbing.months.map(({ monthStart }) => monthStart),
          );
          expectedClimbing.months.forEach(({ monthStart, rate }, index) =>
            assertClose(actualClimbing.months[index]!.rate, rate, monthStart),
          );
        }
      });
    }

    if (expected.thisWeek) {
      await t.test('thisWeek', () => {
        for (const [metric, week] of Object.entries(expected.thisWeek!)) {
          const actual = thisWeek(activities, today, metric as Metric);
          if (week.days) {
            assert.deepEqual(
              actual.days.map((day) => day === null),
              week.days.map((day) => day === null),
            );
            week.days.forEach((day, index) =>
              assertClose(actual.days[index] ?? 0, day ?? 0, `day ${index}`),
            );
          }
          assertClose(actual.current, week.current, `${metric} current`);
          assertClose(actual.typical, week.typical, `${metric} typical`);
        }
      });
    }

    if (expected.typicalWeek) {
      await t.test('typicalWeek', () => {
        const actual = typicalWeek(activities, today);
        for (const [key, value] of Object.entries(expected.typicalWeek!)) {
          assertClose(actual[key as keyof typeof actual], value, key);
        }
      });
    }

    if (expected.yearPace) {
      await t.test('yearPace', () => {
        for (const [metric, pace] of Object.entries(expected.yearPace!)) {
          const actual = yearPace(activities, today, metric as Metric);
          for (const key of [
            'current',
            'perDay',
            'projected',
            'lastYear',
          ] as const) {
            assertClose(actual[key], pace[key], `${metric} ${key}`);
          }
        }
      });
    }

    if (expected.records) {
      await t.test('records', () => {
        for (const [range, best] of Object.entries(expected.records!)) {
          const actual = records(
            activities,
            today,
            range as 'currentYear' | 'allTime',
          );
          for (const key of ['distance', 'time', 'elevation'] as const) {
            const record = actual[key]!;
            assertClose(record.value, best[key].value, `${range} ${key}`);
            assert.equal(isoDate(record.day), best[key].day);
          }
          assertClose(
            actual.biggestWeek!.value,
            best.biggestWeek.value,
            `${range} week`,
          );
          assert.equal(
            isoDate(actual.biggestWeek!.weekStart),
            best.biggestWeek.weekStart,
          );
        }
      });
    }

    if (expected.best30Days) {
      await t.test('best30Days', () => {
        for (const [metric, best] of Object.entries(expected.best30Days!)) {
          const actual = best30Days(activities, today, metric as Metric);
          assertClose(actual.total, best.total, `${metric} total`);
          assert.equal(isoDate(actual.start), best.start);
          assert.equal(isoDate(actual.end), best.end);
          assertClose(actual.current, best.current, `${metric} current`);
        }
      });
    }

    if (expected.restDays) {
      await t.test('restDays', () => {
        assert.deepEqual(restDays(activities, today), expected.restDays);
      });
    }
  });
}
