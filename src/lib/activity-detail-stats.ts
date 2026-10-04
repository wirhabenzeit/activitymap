import { measurementScale, measurementUnit, type UnitSystem } from './units';
import type { Activity } from '~/server/db/schema';

export type DetailStat = { id: string; label: string; value: string };
export type DetailStatGroup = {
  id: string;
  title: string;
  stats: DetailStat[];
};

/** Semantic parity with ActivityMetricGroup; see docs/activity-detail-presentation.md. */
export function activityDetailStats(
  activity: Partial<Activity>,
  locale?: string,
  units: UnitSystem = 'metric',
) {
  const number = (value: number | null | undefined, unit = '', decimals = 0) =>
    value != null && Number.isFinite(value)
      ? `${value.toLocaleString(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}${unit ? ` ${unit}` : ''}`
      : undefined;
  const duration = (seconds: number | null | undefined) => {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0)
      return undefined;
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return days
      ? `${days}d ${hours}h`
      : hours
        ? `${hours}h ${minutes}m`
        : `${minutes}m`;
  };
  const speed = (value: number | null | undefined) =>
    number(
      value == null ? value : value / measurementScale('speed', units),
      measurementUnit('speed', units),
      1,
    );
  const elevation = (value: number | null | undefined) =>
    number(
      value == null ? value : value / measurementScale('elevation', units),
      measurementUnit('elevation', units),
    );
  const flag = (value: boolean | null | undefined) =>
    value == null ? undefined : value ? 'Yes' : 'No';
  const stat = (
    id: string,
    label: string,
    value: string | undefined,
  ): DetailStat => ({ id, label, value: value ?? '—' });
  const headline = [
    stat(
      'distance',
      'Distance',
      number(
        activity.distance == null
          ? activity.distance
          : activity.distance / measurementScale('distance', units),
        measurementUnit('distance', units),
        1,
      ),
    ),
    stat('movingTime', 'Moving time', duration(activity.moving_time)),
    stat(
      'elevationGain',
      'Elevation gain',
      elevation(activity.total_elevation_gain),
    ),
  ];
  const groups: DetailStatGroup[] = [];
  const group = (
    id: string,
    title: string,
    fields: [string, string, string | undefined][],
  ) => {
    const stats = fields.flatMap(([id, label, value]) =>
      value == null ? [] : [stat(id, label, value)],
    );
    if (stats.length) groups.push({ id, title, stats });
  };
  group('time-speed', 'Time & speed', [
    ['elapsedTime', 'Elapsed time', duration(activity.elapsed_time)],
    ['averageSpeed', 'Average speed', speed(activity.average_speed)],
    ['maxSpeed', 'Maximum speed', speed(activity.max_speed)],
  ]);
  group('elevation', 'Elevation', [
    ['elevLow', 'Minimum', elevation(activity.elev_low)],
    ['elevHigh', 'Maximum', elevation(activity.elev_high)],
  ]);
  group('power', 'Power', [
    ['averageWatts', 'Average', number(activity.average_watts, 'W')],
    ['maxWatts', 'Maximum', number(activity.max_watts, 'W')],
    [
      'weightedAverageWatts',
      'Weighted average',
      number(activity.weighted_average_watts, 'W'),
    ],
    ['kilojoules', 'Work', number(activity.kilojoules, 'kJ')],
  ]);
  group('heart-rate', 'Heart rate', [
    ['averageHeartrate', 'Average', number(activity.average_heartrate, 'bpm')],
    ['maxHeartrate', 'Maximum', number(activity.max_heartrate, 'bpm')],
  ]);
  group('energy', 'Energy', [
    ['calories', 'Calories', number(activity.calories, 'kcal')],
  ]);
  group('social', 'Social', [
    ['kudos', 'Kudos', number(activity.kudos_count)],
    ['achievements', 'Achievements', number(activity.achievement_count)],
    ['comments', 'Comments', number(activity.comment_count)],
    [
      'photos',
      'Photos',
      number(activity.total_photo_count ?? activity.photo_count),
    ],
  ]);
  const geometry = {
    summary: 'Summary',
    detailed: 'Detailed',
    refresh_required: 'Refresh required',
  };
  group('activity', 'Activity', [
    ['commute', 'Commute', flag(activity.commute)],
    ['privacy', 'Private', flag(activity.private)],
    ['trainer', 'Indoor', flag(activity.trainer)],
    ['manual', 'Manual', flag(activity.manual)],
    ['flagged', 'Flagged', flag(activity.flagged)],
    [
      'geometry',
      'Geometry status',
      activity.geometryState ? geometry[activity.geometryState] : undefined,
    ],
  ]);
  return { headline, groups };
}
