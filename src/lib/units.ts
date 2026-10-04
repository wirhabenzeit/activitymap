/** API/storage values stay SI. Conversions happen only at display/input boundaries. */
export type UnitSystem = 'metric' | 'imperial';
export type Measurement = 'distance' | 'elevation' | 'speed';
export const METRES_PER_MILE = 1609.344;
export const METRES_PER_FOOT = 0.3048;
export function measurementScale(kind: Measurement, units: UnitSystem): number {
  switch (kind) {
    case 'distance':
      return units === 'imperial' ? METRES_PER_MILE : 1000;
    case 'elevation':
      return units === 'imperial' ? METRES_PER_FOOT : 1;
    case 'speed':
      return units === 'imperial' ? METRES_PER_MILE / 3600 : 1 / 3.6;
  }
}
export function measurementUnit(kind: Measurement, units: UnitSystem): string {
  return {
    distance: units === 'imperial' ? 'mi' : 'km',
    elevation: units === 'imperial' ? 'ft' : 'm',
    speed: units === 'imperial' ? 'mph' : 'km/h',
  }[kind];
}
export function displayMeasurement(
  value: number,
  kind: Measurement,
  units: UnitSystem,
): number {
  return value / measurementScale(kind, units);
}
export function formatMeasurement(
  value: number | null | undefined,
  kind: Measurement,
  units: UnitSystem,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const text = displayMeasurement(value, kind, units).toFixed(
    kind === 'elevation' ? 0 : 1,
  );
  // toFixed keeps the sign of values that round to zero ("-0").
  return `${/^-0(\.0+)?$/.test(text) ? text.slice(1) : text} ${measurementUnit(kind, units)}`;
}
