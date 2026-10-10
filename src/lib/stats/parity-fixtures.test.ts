import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { type z } from 'zod';
import { statsParitySchema } from '../../../scripts/lib/stats-parity-schema';
import { aliasMap } from '~/settings/category';
import { type Activity } from '~/server/db/schema';
import {
  initializeSportType,
  initializeSportGroup,
  initializeValues,
  initializeBinary,
  type FilterState,
} from '~/store/filter';
import * as data from './tile-data';
import * as series from './tile-series';
import { calendarDays, volumeHistory, periodComparisons } from './history';
import { monthActivityRhythm, yearMonthlyRhythm } from './period-rhythm';
import { filterStatsActivities } from './filter-scope';

const corpus = statsParitySchema.parse(
  JSON.parse(readFileSync('shared/stats-parity-fixtures.v1.json', 'utf8')),
);
type FixtureCase = z.infer<
  typeof statsParitySchema
>['fixtures'][number]['cases'][number];

// Compare every supplied key and array position, including null/absent records.
// Expected values are independently pinned in JSON, never produced by this runner.
function equal(actual: unknown, expected: unknown, label: string) {
  if (typeof expected === 'number') {
    assert.equal(typeof actual, 'number', label);
    if (
      label.endsWith('.activityId') ||
      /\.days\.\d{4}-\d{2}-\d{2}\[\d+\]$/.test(label)
    ) {
      assert.equal(actual, expected, label);
      return;
    }
    assert.ok(
      Math.abs((actual as number) - expected) <= corpus.tolerance,
      `${label}: expected ${expected}, got ${String(actual)}`,
    );
  } else if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), label);
    assert.equal(actual.length, expected.length, label);
    expected.forEach((value, index) =>
      equal(actual[index], value, `${label}[${index}]`),
    );
  } else if (expected !== null && typeof expected === 'object') {
    assert.ok(actual !== null && typeof actual === 'object', label);
    assert.deepEqual(
      Object.keys(actual).sort(),
      Object.keys(expected).sort(),
      label,
    );
    for (const [key, value] of Object.entries(expected))
      equal((actual as Record<string, unknown>)[key], value, `${label}.${key}`);
  } else assert.equal(actual, expected, label);
}

function filterState(
  filter: NonNullable<FixtureCase['args']['filter']>,
): FilterState {
  const sportType = initializeSportType();
  if (filter.sportTypes)
    for (const key of Object.keys(sportType) as (keyof typeof sportType)[])
      sportType[key] = filter.sportTypes.includes(key);
  return {
    sportType,
    sportGroup: initializeSportGroup(),
    search: filter.search ?? '',
    dateRange: filter.dateRange,
    values: { ...initializeValues(), ...filter.numeric },
    binary: { ...initializeBinary(), ...filter.binary },
  };
}

function run(
  operation: FixtureCase['operation'],
  activities: data.StatsActivity[],
  today: number,
  args: FixtureCase['args'],
) {
  const metric = args.metric ?? 'distance';
  const first = data.dayFromISODate(args.first ?? data.isoDate(today));
  const last = data.dayFromISODate(args.last ?? data.isoDate(today));
  switch (operation) {
    case 'totals':
      return data.totals(activities, today);
    case 'yearToDate':
      return data.yearToDate(activities, today, metric);
    case 'monthVsLastMonth':
      return data.monthVsLastMonth(activities, today, metric);
    case 'thisWeek':
      return data.thisWeek(activities, today, metric);
    case 'typicalWeek':
      return data.typicalWeek(activities, today);
    case 'yearPace':
      return data.yearPace(activities, today, metric);
    case 'sportMix':
      return data.sportMix(
        activities,
        today,
        args.range === 'allTime' ? 'allTime' : 'currentYear',
      );
    case 'consistency':
      return data.consistency(activities, today, args.weeks ?? 12);
    case 'restDays':
      return data.restDays(activities, today);
    case 'best30Days': {
      const best = data.best30Days(activities, today, metric);
      return {
        ...best,
        start: data.isoDate(best.start),
        end: data.isoDate(best.end),
      };
    }
    case 'records': {
      const records = data.records(
        activities,
        today,
        args.range === 'allTime' ? 'allTime' : 'currentYear',
      );
      return Object.fromEntries(
        Object.entries(records).map(([key, record]) => [
          key,
          'day' in record
            ? {
                value: record.value,
                day: data.isoDate(record.day),
                activityId: record.activityId,
              }
            : {
                value: record.value,
                weekStart: data.isoDate(record.weekStart),
              },
        ]),
      );
    }
    case 'recordRankings': {
      const ranked = data.recordRankings(
        activities,
        today,
        args.range === 'allTime' ? 'allTime' : 'currentYear',
      );
      return Object.fromEntries(
        Object.entries(ranked).map(([metric, rows]) => [
          metric,
          rows.map((row) =>
            'day' in row
              ? {
                  value: row.value,
                  day: data.isoDate(row.day),
                  activityId: row.activityId,
                }
              : { value: row.value, weekStart: data.isoDate(row.weekStart) },
          ),
        ]),
      );
    }
    case 'monthActivityRhythm': {
      const rhythm = monthActivityRhythm(activities, today, metric);
      return {
        activityCount: rhythm.activityCount,
        activeDays: rhythm.activeDays,
        measuredCount: rhythm.measuredCount,
        average: rhythm.average,
        dayCount: rhythm.days.length,
        lastDay: data.isoDate(rhythm.days.at(-1)!.day),
        days: rhythm.days
          .filter((day) => day.activities.length)
          .map((day) => ({
            day: data.isoDate(day.day),
            activities: day.activities.map((a) => a.id),
            bySport: Object.fromEntries(
              Object.entries(day.bySport).filter(([, value]) => value !== 0),
            ),
          })),
      };
    }
    case 'yearMonthlyRhythm':
      return yearMonthlyRhythm(activities, today, metric).map((row) => ({
        start: data.isoDate(row.start),
        inProgress: row.inProgress,
        current: Object.fromEntries(
          Object.entries(row.current).filter(([, value]) => value !== 0),
        ),
        previous: Object.fromEntries(
          Object.entries(row.previous).filter(([, value]) => value !== 0),
        ),
      }));
    case 'periodComparisons':
      return periodComparisons(
        activities,
        today,
        metric,
        args.range === 'years' ? 'years' : 'months',
      ).map((row) => ({
        start: data.isoDate(row.start),
        end: data.isoDate(row.end),
        cutoff: data.isoDate(row.cutoff),
        elapsed: row.elapsed,
        total: row.total,
        fullTotal: row.end === today ? null : row.total,
        incomplete: row.incomplete,
      }));
    case 'activityCalendar': {
      const calendar = data.activityCalendar(activities, today);
      return {
        activeDays: calendar.activeDays,
        dominantSport: Object.fromEntries(
          [...calendar.dominantSport].map(([day, sport]) => [
            data.isoDate(day),
            sport,
          ]),
        ),
      };
    }
    case 'weeklyActiveDays':
      return series
        .weeklyActiveDays(activities, today, args.weeks ?? 12)
        .map((row) => ({ ...row, start: data.isoDate(row.start) }));
    case 'dailyTotals':
      return Object.fromEntries(
        [...series.dailyTotals(activities, first, last)].map(
          ([day, totals]) => [data.isoDate(day), totals],
        ),
      );
    case 'calendarDays': {
      const calendar = calendarDays(activities, first, last);
      return {
        days: Object.fromEntries(
          [...calendar.days].map(([day, rows]) => [
            data.isoDate(day),
            rows.map((row) => row.id),
          ]),
        ),
        dominantSport: Object.fromEntries(
          [...calendar.dominantSport].map(([day, sport]) => [
            data.isoDate(day),
            sport,
          ]),
        ),
        mixedDays: [...calendar.mixedDays]
          .sort((a, b) => a - b)
          .map(data.isoDate),
      };
    }
    case 'calendarMonths':
      return series.calendarMonths(today, first).map((row) => ({
        ...row,
        start: data.isoDate(row.start),
        first: data.isoDate(row.first),
        last: data.isoDate(row.last),
      }));
    case 'cumulativeByDay':
      return series.cumulativeByDay(activities, metric, first, last);
    case 'cumulativeYearPoints':
      return series.cumulativeYearPoints(activities, metric, args.year!, last);
    case 'volumeHistory':
      return volumeHistory(
        activities,
        today,
        metric,
        args.range === 'months'
          ? 'months'
          : args.range === 'years'
            ? 'years'
            : 'weeks',
        args.page,
      ).map((row) => ({
        ...row,
        start: data.isoDate(row.start),
        end: data.isoDate(row.end),
      }));
    case 'filterActivities':
      return activities.map((a) => a.id);
    case 'localToday': {
      const previous = process.env.TZ;
      try {
        process.env.TZ = args.timeZone;
        return data.isoDate(series.localToday(new Date(args.now!)));
      } finally {
        if (previous === undefined) delete process.env.TZ;
        else process.env.TZ = previous;
      }
    }
  }
}

for (const fixture of corpus.fixtures) {
  for (const vector of fixture.cases) {
    void test(`${fixture.id}: ${vector.id}`, () => {
      const source = fixture.activities.map((a) => ({
        id: a.id,
        name: a.name ?? '',
        sport_type: a.sportType as Activity['sport_type'],
        start_date_local: new Date(`${a.startDateLocal}Z`),
        distance: a.distance,
        moving_time: a.movingTime,
        total_elevation_gain: a.elevationGain,
        elapsed_time: a.elapsedTime ?? null,
        commute: a.commute === undefined ? false : a.commute,
        private: a.private === undefined ? false : a.private,
        flagged: a.flagged === undefined ? false : a.flagged,
      }));
      const state = vector.args.filter ? filterState(vector.args.filter) : null;
      const original = state ? structuredClone(state) : null;
      const scoped = state ? filterStatsActivities(source, state) : source;
      const activities = scoped.map((a) => ({
        ...a,
        sport: aliasMap[a.sport_type] ?? 'misc',
      }));
      const actual = run(
        vector.operation,
        activities,
        data.dayFromISODate(vector.args.today ?? fixture.today),
        vector.args,
      );
      if (vector.operation === 'filterActivities')
        assert.deepEqual(actual, vector.expected);
      else equal(actual, vector.expected, `${fixture.id}/${vector.id}`);
      if (state)
        assert.deepEqual(
          state,
          original,
          'stats evaluation must retain the saved filter/date state',
        );
    });
  }
}
