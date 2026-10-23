import type { GeometryCollection } from 'geojson';
import { z } from 'zod';

import {
  type MatcherPolicy,
  hasBlockingMatchReasons,
  validatePolicy,
} from './policy';
import type { PlacePoint } from './types';

export interface PreparedSample {
  index: number;
  point: PlacePoint;
  sectionDistanceM: number;
  elapsedS?: number;
  providerDistanceM?: number;
  altitudeM?: number;
}
export interface PreparedSection {
  id: number;
  samples: PreparedSample[];
  continuousTime: boolean;
  /** Why this section starts; never infer a pause from global track reasons. */
  breakBefore?:
    | 'invalid_gps_sample'
    | 'antimeridian_gap'
    | 'spatial_gap'
    | 'provider_distance_gap'
    | 'invalid_time_gap'
    | 'non_increasing_time_gap'
    | 'time_gap'
    | 'speed_gap';
}
export interface PreparedTrack {
  sections: PreparedSection[];
  geometry: GeometryCollection;
  /** Unfinished processing; excluded bad segments do not invalidate other visits. */
  partial: boolean;
  reasons: string[];
  qualityFlags: string[];
  originalSampleCount: number;
  aligned: { time: boolean; distance: boolean; altitude: boolean };
}

const EARTH_RADIUS_M = 6_371_008.8;
const radians = (degrees: number) => (degrees * Math.PI) / 180;
export function surfaceDistanceM(a: PlacePoint, b: PlacePoint): number {
  const latitude = radians(b.latitude - a.latitude);
  const longitude = radians(b.longitude - a.longitude);
  const haversine =
    Math.sin(latitude / 2) ** 2 +
    Math.cos(radians(a.latitude)) *
      Math.cos(radians(b.latitude)) *
      Math.sin(longitude / 2) ** 2;
  return (
    2 *
    EARTH_RADIUS_M *
    Math.asin(Math.sqrt(Math.min(1, Math.max(0, haversine))))
  );
}
/** Local tangent approximation, used only on bounded short sections. */
export function relativeVectorM(point: PlacePoint, origin: PlacePoint) {
  const longitude = ((point.longitude - origin.longitude + 540) % 360) - 180;
  return {
    x: EARTH_RADIUS_M * radians(longitude) * Math.cos(radians(origin.latitude)),
    y: EARTH_RADIUS_M * radians(point.latitude - origin.latitude),
  };
}

const metadataSchema = z.object({
  type: z.string().optional(),
  original_size: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  resolution: z.enum(['low', 'medium', 'high']),
  series_type: z.enum(['time', 'distance']),
});
type StreamView = z.infer<typeof metadataSchema> & { data: unknown[] };
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function stream(value: unknown, key: string): StreamView | undefined {
  const source = record(value);
  if (!source || !Array.isArray(source.data)) return undefined;
  const metadata = metadataSchema.safeParse(source);
  if (
    !metadata.success ||
    (metadata.data.type !== undefined && metadata.data.type !== key)
  )
    return undefined;
  return { ...metadata.data, data: source.data };
}
const finiteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const nonnegativeNumber = (value: unknown): value is number =>
  finiteNumber(value) && value >= 0;
function gpsPoint(value: unknown): PlacePoint | undefined {
  if (!Array.isArray(value) || value.length !== 2) return undefined;
  const latitude: unknown = value[0];
  const longitude: unknown = value[1];
  if (
    !finiteNumber(latitude) ||
    !finiteNumber(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  )
    return undefined;
  return { longitude, latitude };
}

/** Original indices survive every split; missing samples never become lines. */
export function prepareTrack(
  payload: unknown,
  inputPolicy: MatcherPolicy,
): PreparedTrack {
  const policy = validatePolicy(inputPolicy);
  const result: PreparedTrack = {
    sections: [],
    geometry: { type: 'GeometryCollection', geometries: [] },
    partial: false,
    reasons: [],
    qualityFlags: [],
    originalSampleCount: 0,
    aligned: { time: false, distance: false, altitude: false },
  };
  const reasons = new Set<string>();
  const quality = new Set<string>();
  const source = record(payload);
  const gps = stream(source?.latlng, 'latlng');
  if (
    !gps ||
    gps.data.length === 0 ||
    gps.resolution !== 'high' ||
    gps.original_size !== gps.data.length
  ) {
    result.partial =
      source?.latlng !== undefined && (!gps || gps.data.length > 0);
    result.reasons = [
      source?.latlng === undefined || gps?.data.length === 0
        ? 'missing_gps'
        : 'gps_sampling_unverified',
    ];
    return result;
  }
  result.originalSampleCount = gps.data.length;
  const limit = Math.min(gps.data.length, policy.maxSamples);
  if (limit < gps.data.length) reasons.add('sample_limit');
  const alignedStream = (key: 'time' | 'distance' | 'altitude') => {
    const candidate = stream(source?.[key], key);
    if (!candidate) {
      quality.add(`${key}_missing`);
      return undefined;
    }
    if (
      candidate.resolution !== 'high' ||
      candidate.data.length !== gps.data.length ||
      candidate.original_size !== gps.original_size ||
      candidate.original_size !== candidate.data.length ||
      candidate.series_type !== gps.series_type
    ) {
      quality.add(`${key}_unaligned`);
      return undefined;
    }
    return candidate;
  };
  const time = alignedStream('time');
  let distance = alignedStream('distance');
  const altitude = alignedStream('altitude');
  let timeOrdered = true;
  let previousTime: number | undefined;
  let previousDistance: number | undefined;
  // Validate only the bounded prefix we will process; truncation is already partial.
  for (let index = 0; index < limit; index++) {
    const elapsed = time?.data[index];
    if (time && !nonnegativeNumber(elapsed)) quality.add('time_invalid');
    if (nonnegativeNumber(elapsed)) {
      if (previousTime !== undefined && elapsed < previousTime)
        timeOrdered = false;
      previousTime = elapsed;
    }
    if (distance) {
      const metres = distance.data[index];
      if (
        !nonnegativeNumber(metres) ||
        (previousDistance !== undefined && metres < previousDistance)
      ) {
        quality.add('distance_invalid');
        distance = undefined;
      } else previousDistance = metres;
    }
    if (altitude && !finiteNumber(altitude.data[index]))
      quality.add('altitude_invalid');
  }
  if (!timeOrdered) quality.add('time_non_monotonic');
  result.aligned = {
    time: Boolean(time && timeOrdered),
    distance: Boolean(distance),
    altitude: Boolean(altitude),
  };
  let current: PreparedSection | undefined;
  let breakBefore: PreparedSection['breakBefore'];
  const finish = () => {
    if (current) {
      current.continuousTime =
        current.samples.length >= 2 &&
        current.samples.every((sample) => sample.elapsedS !== undefined);
      result.sections.push(current);
      current = undefined;
    }
  };
  for (let index = 0; index < limit; index++) {
    const point = gpsPoint(gps.data[index]);
    if (!point) {
      reasons.add('invalid_gps_sample');
      finish();
      breakBefore = 'invalid_gps_sample';
      continue;
    }
    const previous = current?.samples.at(-1);
    const elapsed = time?.data[index];
    let step = previous ? surfaceDistanceM(previous.point, point) : 0;
    if (previous) {
      const beforeTime = time?.data[previous.index];
      let gap: PreparedSection['breakBefore'];
      if (Math.abs(previous.point.longitude - point.longitude) > 180)
        gap = 'antimeridian_gap';
      else if (step > policy.maxSegmentDistanceM) gap = 'spatial_gap';
      else if (
        distance &&
        (distance.data[index] as number) -
          (distance.data[previous.index] as number) >
          policy.maxSegmentDistanceM
      )
        gap = 'provider_distance_gap';
      else if (
        time &&
        (!nonnegativeNumber(elapsed) || !nonnegativeNumber(beforeTime))
      )
        gap = 'invalid_time_gap';
      else if (nonnegativeNumber(elapsed) && nonnegativeNumber(beforeTime)) {
        const duration = elapsed - beforeTime;
        if (duration <= 0) gap = 'non_increasing_time_gap';
        else if (duration > policy.maxTimeGapS) gap = 'time_gap';
        else if (step / duration > policy.maxSpeedMps) gap = 'speed_gap';
      }
      if (gap) {
        reasons.add(gap);
        finish();
        breakBefore = gap;
        step = 0;
      }
    }
    if (!current) {
      if (result.sections.length >= policy.maxSections) {
        reasons.add('section_limit');
        break;
      }
      current = {
        id: result.sections.length,
        samples: [],
        continuousTime: false,
        ...(breakBefore ? { breakBefore } : {}),
      };
      breakBefore = undefined;
    }
    const providerDistance = distance?.data[index];
    const height = altitude?.data[index];
    current.samples.push({
      index,
      point,
      sectionDistanceM: (current.samples.at(-1)?.sectionDistanceM ?? 0) + step,
      ...(timeOrdered && nonnegativeNumber(elapsed)
        ? { elapsedS: elapsed }
        : {}),
      ...(nonnegativeNumber(providerDistance)
        ? { providerDistanceM: providerDistance }
        : {}),
      ...(finiteNumber(height) ? { altitudeM: height } : {}),
    });
  }
  finish();
  result.geometry.geometries = result.sections.map((section) =>
    section.samples.length === 1
      ? {
          type: 'Point',
          coordinates: [
            section.samples[0]!.point.longitude,
            section.samples[0]!.point.latitude,
          ],
        }
      : {
          type: 'LineString',
          coordinates: section.samples.map((sample) => [
            sample.point.longitude,
            sample.point.latitude,
          ]),
        },
  );
  result.reasons = [...reasons].sort();
  result.qualityFlags = [...quality].sort();
  result.partial = hasBlockingMatchReasons(reasons);
  return result;
}
