import { type DemGrid, type DemSource, metresPerDegree } from './terrain';

/** A grid sampled from a height function, in metres east/north of a point. */
export function gridAround(
  lon: number,
  lat: number,
  height: (eastM: number, northM: number) => number,
  options: { radiusM?: number; spacingM?: number } = {},
): DemGrid {
  const radius = options.radiusM ?? 3_100,
    spacing = options.spacingM ?? 30;
  const scale = metresPerDegree(lat);
  const half = Math.ceil(radius / spacing);
  const width = 2 * half + 1;
  const values = new Float32Array(width * width);
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++)
      values[y * width + x] = height(
        (x - half) * spacing,
        (half - y) * spacing,
      );
  return {
    west: lon - (half * spacing) / scale.x,
    north: lat + (half * spacing) / scale.y,
    dx: spacing / scale.x,
    dy: spacing / scale.y,
    width,
    height: width,
    values,
  };
}

/** Synthetic DEM: the same height function around every requested point. */
export function syntheticDem(
  height: (eastM: number, northM: number) => number = () => 500,
): DemSource {
  return {
    window: async (lon, lat, radiusM) =>
      gridAround(lon, lat, height, { radiusM: radiusM + 100, spacingM: 60 }),
  };
}
