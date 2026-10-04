import { measurementScale, measurementUnit, type UnitSystem } from './units';
import type { ElevationProfile } from './activity-stream-summary';

/** Select supplied samples, including pauses, without resampling or sorting. */
export function nearestElevationSample(
  profile: ElevationProfile,
  distance: number,
) {
  let nearest = 0;
  for (let index = 1; index < profile.distance.length; index++) {
    if (
      Math.abs(profile.distance[index]! - distance) <
      Math.abs(profile.distance[nearest]! - distance)
    ) {
      nearest = index;
    }
  }
  return nearest;
}

export function elevationDistanceAxis(
  span: number,
  units: UnitSystem = 'metric',
) {
  const scale = measurementScale('distance', units);
  return span >= scale
    ? { divisor: scale, unit: measurementUnit('distance', units), decimals: 1 }
    : {
        divisor: measurementScale('elevation', units),
        unit: measurementUnit('elevation', units),
        decimals: 0,
      };
}

export function elevationDistanceLabel(
  metres: number,
  span: number,
  units: UnitSystem = 'metric',
) {
  const axis = elevationDistanceAxis(span, units);
  return `${(metres / axis.divisor).toLocaleString(undefined, { maximumFractionDigits: axis.decimals })} ${axis.unit}`;
}

/** Round 1/2/5 intervals: never use an arbitrary half-span or endpoint as a tick. */
export function elevationAxisTicks(
  minimum: number,
  maximum: number,
  count = 4,
) {
  const roughStep = (maximum - minimum) / count;
  if (!(roughStep > 0) || !Number.isFinite(roughStep)) return [];
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const fraction = roughStep / magnitude;
  const step =
    magnitude *
    (fraction >= Math.sqrt(50)
      ? 10
      : fraction >= Math.sqrt(10)
        ? 5
        : fraction >= Math.sqrt(2)
          ? 2
          : 1);
  const first = Math.ceil(minimum / step);
  const last = Math.floor(maximum / step);
  return Array.from({ length: last - first + 1 }, (_, index) =>
    Number(((first + index) * step).toPrecision(12)),
  );
}

export function elevationSelectionLabel(
  distance: number,
  altitude: number,
  span: number,
  units: UnitSystem = 'metric',
) {
  return `${elevationDistanceLabel(distance, span, units)} · ${(altitude / measurementScale('elevation', units)).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${measurementUnit('elevation', units)}`;
}
