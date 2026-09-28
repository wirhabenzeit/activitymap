import { z } from 'zod';
import {
  streamSummarySchema,
  type StreamSummary,
} from '~/server/strava/stream-summary';

export const COMPACT_SUMMARY_CODEC = 'polyline-v1';
export const MAX_SUMMARY_POINTS = 300;
// Arithmetic rather than JS bitwise operations: valid deltas can exceed int32.
export const MAX_SCALED_VALUE = 2 ** 40 - 1;
const MAX_CHARACTERS_PER_VALUE = 9;
const encodedSeries = z
  .string()
  .max(MAX_SUMMARY_POINTS * MAX_CHARACTERS_PER_VALUE);

/** Scales are fixed by codec, independently of the sampling algorithm version. */
export const compactStreamSummarySchema = z
  .object({
    codec: z.literal(COMPACT_SUMMARY_CODEC),
    algorithm_version: z.number().int().positive(),
    basis: z.enum(['distance', 'time']).nullable(),
    count: z.number().int().min(0).max(MAX_SUMMARY_POINTS),
    time: encodedSeries.optional(),
    distance: encodedSeries.optional(),
    altitude: encodedSeries.optional(),
    watts: encodedSeries.optional(),
    heartrate: encodedSeries.optional(),
    // Interleaved lat/lng, each component delta-coded independently.
    latlng: z
      .string()
      .max(2 * MAX_SUMMARY_POINTS * MAX_CHARACTERS_PER_VALUE)
      .optional(),
  })
  .strict();
export type CompactStreamSummary = z.infer<typeof compactStreamSummarySchema>;
export type StoredStreamSummary = StreamSummary | CompactStreamSummary;
const scales = {
  time: 1,
  distance: 10,
  altitude: 10,
  watts: 1,
  heartrate: 1,
} as const;
const keys = Object.keys(scales) as (keyof typeof scales)[];

function invalid(): never {
  throw new Error('Invalid compact stream summary');
}

function encodeValues(values: number[], scale: number, stride = 1): string {
  const previous = Array<number>(stride).fill(0);
  let text = '';
  for (const [index, value] of values.entries()) {
    const scaled = Math.round(value * scale);
    // No further quantization: unsupported precision must not silently disappear.
    if (
      !Number.isSafeInteger(scaled) ||
      Math.abs(scaled) > MAX_SCALED_VALUE ||
      scaled / scale !== value
    )
      invalid();
    const component = index % stride;
    const delta = scaled - previous[component]!;
    previous[component] = scaled;
    let unsigned = delta < 0 ? -2 * delta - 1 : 2 * delta;
    while (unsigned >= 32) {
      text += String.fromCharCode(63 + 32 + (unsigned % 32));
      unsigned = Math.floor(unsigned / 32);
    }
    text += String.fromCharCode(63 + unsigned);
  }
  return text;
}

function visitDecodedValues(
  text: string,
  count: number,
  scale: number,
  stride: number,
  visit: (value: number) => void,
): void {
  if (text.length > count * MAX_CHARACTERS_PER_VALUE) invalid();
  const previous = Array<number>(stride).fill(0);
  let offset = 0;
  for (let index = 0; index < count; index++) {
    let unsigned = 0,
      multiplier = 1,
      chunks = 0;
    while (true) {
      if (offset >= text.length || ++chunks > MAX_CHARACTERS_PER_VALUE)
        invalid();
      const chunk = text.charCodeAt(offset++) - 63;
      if (chunk < 0 || chunk > 63) invalid();
      unsigned += (chunk % 32) * multiplier;
      if (unsigned > 4 * MAX_SCALED_VALUE) invalid();
      if (chunk < 32) {
        // Reject redundant encodings so each summary has a canonical encoding.
        if (chunks > 1 && chunk === 0) invalid();
        break;
      }
      multiplier *= 32;
    }
    const delta = unsigned % 2 ? -(unsigned + 1) / 2 : unsigned / 2;
    const component = index % stride;
    const scaled = previous[component]! + delta;
    if (Math.abs(scaled) > MAX_SCALED_VALUE) invalid();
    previous[component] = scaled;
    visit(scaled / scale);
  }
  if (offset !== text.length) invalid();
}

function decodeValues(
  text: string,
  count: number,
  scale: number,
  stride = 1,
): number[] {
  const values: number[] = [];
  visitDecodedValues(text, count, scale, stride, (value) => values.push(value));
  return values;
}

export function encodeStreamSummary(
  input: StreamSummary,
): CompactStreamSummary {
  const summary = streamSummarySchema.parse(input);
  const count = summary.basis ? summary[summary.basis]?.length : 0;
  if (count === undefined || count > MAX_SUMMARY_POINTS) invalid();
  const result: CompactStreamSummary = {
    codec: COMPACT_SUMMARY_CODEC,
    algorithm_version: summary.version,
    basis: summary.basis,
    count,
  };
  for (const key of keys) {
    const values = summary[key];
    if (values !== undefined) {
      if (values.length !== count) invalid();
      result[key] = encodeValues(values, scales[key]);
    }
  }
  if (summary.latlng !== undefined) {
    if (summary.latlng.length !== count) invalid();
    if (
      summary.latlng.some(
        ([lat, lng]) => Math.abs(lat) > 90 || Math.abs(lng) > 180,
      )
    )
      invalid();
    result.latlng = encodeValues(summary.latlng.flat(), 1e5, 2);
  }
  return result;
}

function parseCompactSummary(input: unknown): CompactStreamSummary {
  const compact = compactStreamSummarySchema.parse(input);
  if (
    compact.basis === null
      ? compact.count !== 0
      : compact[compact.basis] === undefined
  )
    invalid();
  return compact;
}

/** Check chart eligibility without allocating or retaining decoded sample arrays. */
export function hasCompactElevationProfile(input: unknown): boolean {
  try {
    const compact = parseCompactSummary(input);
    if (
      compact.count < 2 ||
      compact.distance === undefined ||
      compact.altitude === undefined
    )
      return false;
    let firstDistance: number | undefined;
    let lastDistance: number | undefined;
    let nondecreasing = true;
    for (const key of keys) {
      const text = compact[key];
      if (text === undefined) continue;
      visitDecodedValues(text, compact.count, scales[key], 1, (value) => {
        if (key === 'distance') {
          firstDistance ??= value;
          if (lastDistance !== undefined && value < lastDistance)
            nondecreasing = false;
          lastDistance = value;
        }
      });
    }
    if (compact.latlng !== undefined) {
      let component = 0;
      visitDecodedValues(compact.latlng, compact.count * 2, 1e5, 2, (value) => {
        if (Math.abs(value) > (component++ % 2 === 0 ? 90 : 180)) invalid();
      });
    }
    return (
      nondecreasing &&
      firstDistance !== undefined &&
      lastDistance! > firstDistance
    );
  } catch {
    return false;
  }
}

export function summaryAlgorithmVersion(
  summary: StoredStreamSummary | null,
): number | undefined {
  return summary === null
    ? undefined
    : isCompactSummary(summary)
      ? summary.algorithm_version
      : summary.version;
}

export function decodeStreamSummary(input: unknown): StreamSummary {
  const compact = parseCompactSummary(input);
  const result: StreamSummary = {
    version: compact.algorithm_version,
    basis: compact.basis,
  };
  for (const key of keys) {
    if (compact[key] !== undefined)
      result[key] = decodeValues(compact[key], compact.count, scales[key]);
  }
  if (compact.latlng !== undefined) {
    const values = decodeValues(compact.latlng, compact.count * 2, 1e5, 2);
    result.latlng = [];
    for (let index = 0; index < values.length; index += 2) {
      const lat = values[index]!,
        lng = values[index + 1]!;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) invalid();
      result.latlng.push([lat, lng]);
    }
  }
  return result;
}

export function isCompactSummary(
  value: StoredStreamSummary,
): value is CompactStreamSummary {
  return 'codec' in value;
}
export const unpackStreamSummary = (
  value: StoredStreamSummary,
): StreamSummary =>
  isCompactSummary(value)
    ? decodeStreamSummary(value)
    : streamSummarySchema.parse(value);
export const packStreamSummary = (
  value: StoredStreamSummary,
): CompactStreamSummary =>
  isCompactSummary(value)
    ? compactStreamSummarySchema.parse(value)
    : encodeStreamSummary(value);
