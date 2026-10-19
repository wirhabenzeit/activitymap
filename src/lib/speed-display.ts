import { numberFormatter } from './presentation/formatters';
import { message } from './presentation/messages';
import { METRES_PER_MILE, type UnitSystem, formatMeasurement } from './units';

export type SpeedDisplay = 'speed' | 'run' | 'swim';

export function speedDisplayForSport(sport?: string | null): SpeedDisplay {
  if (sport === 'Run' || sport === 'TrailRun' || sport === 'VirtualRun')
    return 'run';
  return sport === 'Swim' ? 'swim' : 'speed';
}

/** Use one comparable unit across the complete result set, before pagination. */
export function speedDisplayForSports(
  sports: Iterable<string | null | undefined>,
): SpeedDisplay {
  let result: SpeedDisplay | undefined;
  for (const sport of sports) {
    const current = speedDisplayForSport(sport);
    if (current === 'speed' || (result && current !== result)) return 'speed';
    result = current;
  }
  return result ?? 'speed';
}

export function paceSeconds(
  speed: number | null | undefined,
  display: SpeedDisplay,
  units: UnitSystem,
): number | null {
  if (speed == null || !Number.isFinite(speed) || speed <= 0) return null;
  const distance =
    display === 'swim'
      ? units === 'metric'
        ? 100
        : 91.44
      : units === 'metric'
        ? 1000
        : METRES_PER_MILE;
  const seconds = distance / speed;
  return Number.isFinite(seconds) && seconds <= Number.MAX_SAFE_INTEGER
    ? seconds
    : null;
}

export function paceUnit(display: SpeedDisplay, units: UnitSystem): string {
  return display === 'swim'
    ? units === 'metric'
      ? 'min/100 m'
      : 'min/100 yd'
    : units === 'metric'
      ? 'min/km'
      : 'min/mi';
}

export function formatPaceSeconds(
  seconds: number | null,
  display: SpeedDisplay,
  units: UnitSystem,
  locale = 'en',
): string {
  if (
    seconds == null ||
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    seconds > Number.MAX_SAFE_INTEGER
  )
    return '—';
  const rounded = Math.round(seconds);
  return `${numberFormatter(locale, { useGrouping: false }).format(Math.floor(rounded / 60))}:${numberFormatter(locale, { minimumIntegerDigits: 2, useGrouping: false }).format(rounded % 60)} ${paceUnit(display, units)}`;
}

export function formatSpeed(
  speed: number | null | undefined,
  display: SpeedDisplay,
  units: UnitSystem,
  locale = 'en',
): string {
  return display === 'speed'
    ? formatMeasurement(speed, 'speed', units, locale)
    : formatPaceSeconds(
        paceSeconds(speed, display, units),
        display,
        units,
        locale,
      );
}

export function speedLabel(display: SpeedDisplay, maximum = false): string {
  return display === 'speed'
    ? maximum
      ? message('metric.max_speed')
      : message('metric.average_speed')
    : maximum
      ? message('metric.best_pace')
      : message('metric.average_pace');
}
