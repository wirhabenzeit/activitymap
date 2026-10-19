import type { Activity } from '~/lib/activity';

import { numberFormatter } from './presentation/formatters';
import { message } from './presentation/messages';
import {
  formatSpeed,
  paceSeconds,
  speedDisplayForSport,
  speedLabel,
} from './speed-display';
import { type UnitSystem, measurementScale, measurementUnit } from './units';

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
    const part = (value: number, unit: string) =>
      numberFormatter(locale, {
        style: 'unit',
        unit,
        unitDisplay: 'narrow',
      }).format(value);
    return days
      ? `${part(days, 'day')} ${part(hours, 'hour')}`
      : hours
        ? `${part(hours, 'hour')} ${part(minutes, 'minute')}`
        : part(minutes, 'minute');
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
    value == null
      ? undefined
      : value
        ? message('value.yes')
        : message('value.no');
  const stat = (
    id: string,
    label: string,
    value: string | undefined,
  ): DetailStat => ({ id, label, value: value ?? '—' });
  const display = speedDisplayForSport(activity.sport_type);
  const hasPace = display !== 'speed';
  const headline = [
    stat(
      'distance',
      message('metric.distance'),
      number(
        activity.distance == null
          ? activity.distance
          : activity.distance / measurementScale('distance', units),
        measurementUnit('distance', units),
        1,
      ),
    ),
    stat(
      'movingTime',
      message('metric.moving_time'),
      duration(activity.moving_time),
    ),
    stat(
      hasPace ? 'averagePace' : 'elevationGain',
      hasPace
        ? message('metric.average_pace')
        : message('metric.total_elevation_gain'),
      hasPace
        ? formatSpeed(activity.average_speed, display, units, locale)
        : elevation(activity.total_elevation_gain),
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
  group(
    'time-speed',
    hasPace
      ? message('activity.group.timePace')
      : message('activity.group.timeSpeed'),
    [
      ...(hasPace
        ? [
            [
              'bestPace',
              speedLabel(display, true),
              paceSeconds(activity.max_speed, display, units) == null
                ? undefined
                : formatSpeed(activity.max_speed, display, units, locale),
            ] as [string, string, string | undefined],
          ]
        : []),
      [
        'elapsedTime',
        message('metric.elapsed_time'),
        duration(activity.elapsed_time),
      ],
      [
        'averageSpeed',
        message('metric.average_speed'),
        speed(activity.average_speed),
      ],
      ['maxSpeed', message('metric.max_speed'), speed(activity.max_speed)],
    ],
  );
  group('elevation', message('activity.group.elevation'), [
    ...(hasPace
      ? [
          [
            'elevationGain',
            message('metric.total_elevation_gain'),
            elevation(activity.total_elevation_gain),
          ] as [string, string, string | undefined],
        ]
      : []),
    ['elevLow', message('metric.short.minimum'), elevation(activity.elev_low)],
    [
      'elevHigh',
      message('metric.short.maximum'),
      elevation(activity.elev_high),
    ],
  ]);
  group('power', message('activity.group.power'), [
    [
      'averageWatts',
      message('metric.short.average'),
      number(activity.average_watts, 'W'),
    ],
    [
      'maxWatts',
      message('metric.short.maximum'),
      number(activity.max_watts, 'W'),
    ],
    [
      'weightedAverageWatts',
      message('metric.short.weightedAverage'),
      number(activity.weighted_average_watts, 'W'),
    ],
    [
      'kilojoules',
      message('metric.kilojoules'),
      number(activity.kilojoules, 'kJ'),
    ],
  ]);
  group('heart-rate', message('activity.group.heartRate'), [
    [
      'averageHeartrate',
      message('metric.short.average'),
      number(activity.average_heartrate, 'bpm'),
    ],
    [
      'maxHeartrate',
      message('metric.short.maximum'),
      number(activity.max_heartrate, 'bpm'),
    ],
  ]);
  group('energy', message('activity.group.energy'), [
    [
      'calories',
      message('metric.short.calories'),
      number(activity.calories, 'kcal'),
    ],
  ]);
  group('social', message('activity.group.social'), [
    ['kudos', message('metric.kudos'), number(activity.kudos_count)],
    [
      'achievements',
      message('metric.achievements'),
      number(activity.achievement_count),
    ],
    ['comments', message('metric.comments'), number(activity.comment_count)],
    [
      'photos',
      message('metric.photos'),
      number(activity.total_photo_count ?? activity.photo_count),
    ],
  ]);
  const geometry = {
    summary: message('geometry.summary'),
    detailed: message('geometry.detailed'),
    refresh_required: message('geometry.refreshRequired'),
  };
  group('activity', message('activity.group.activity'), [
    ['commute', message('metric.commute'), flag(activity.commute)],
    ['privacy', message('metric.private'), flag(activity.private)],
    ['trainer', message('metric.indoor'), flag(activity.trainer)],
    ['manual', message('metric.manual'), flag(activity.manual)],
    ['flagged', message('metric.flagged'), flag(activity.flagged)],
    [
      'geometry',
      message('metric.geometryStatus'),
      activity.geometryState ? geometry[activity.geometryState] : undefined,
    ],
  ]);
  return { headline, groups };
}
