import { z } from 'zod';
import type { RawActivityStreams } from './streams';

/** Bump when the summary algorithm changes so stored summaries are rebuilt. */
export const STREAM_SUMMARY_VERSION = 1;
/** Enough points for a card-sized chart or route preview. */
export const STREAM_SUMMARY_POINTS = 300;

const series = z.array(z.number());
/**
 * Downsampled, index-aligned streams: every present array has one entry per
 * point. `basis` is the axis the points are evenly spaced along.
 */
export const streamSummarySchema = z.object({
  version: z.number().int().positive(),
  // Null when no stream can serve as an axis; stored so it isn't recomputed.
  basis: z.enum(['distance', 'time']).nullable(),
  time: series.optional(),
  distance: series.optional(),
  latlng: z.array(z.tuple([z.number(), z.number()])).optional(),
  altitude: series.optional(),
  watts: series.optional(),
  heartrate: series.optional(),
});
export type StreamSummary = z.infer<typeof streamSummarySchema>;

type Stream = NonNullable<RawActivityStreams[keyof RawActivityStreams]>;

const increasing = (data: number[]) =>
  data.length > 1 &&
  data[data.length - 1]! > data[0]! &&
  data.every((value, index) => index === 0 || value >= data[index - 1]!);

// Strava streams can use different sampling. Only combine streams that share
// the reference's shape and sampling metadata.
const alignedWith = (reference: Stream) => (candidate: Stream | undefined) =>
  candidate?.data.length === reference.data.length &&
  candidate.series_type === reference.series_type &&
  candidate.resolution === reference.resolution &&
  candidate.original_size === reference.original_size;

const round = (value: number, digits: number) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/**
 * Buckets the samples into equal steps of distance (or time, when there is no
 * usable distance stream) and averages each bucket.
 */
export function summarizeStreams(
  streams: RawActivityStreams,
  points = STREAM_SUMMARY_POINTS,
): StreamSummary {
  const basis =
    streams.distance && increasing(streams.distance.data)
      ? 'distance'
      : streams.time && increasing(streams.time.data)
        ? 'time'
        : null;
  if (!basis) return { version: STREAM_SUMMARY_VERSION, basis: null };
  const reference = streams[basis]!;
  const axis = reference.data;
  const aligned = alignedWith(reference);

  const start = axis[0]!;
  const span = axis[axis.length - 1]! - start;
  const bucketCount = Math.min(points, axis.length);
  const buckets: number[][] = Array.from({ length: bucketCount }, () => []);
  axis.forEach((value, index) => {
    const bucket = Math.min(
      bucketCount - 1,
      Math.floor(((value - start) / span) * bucketCount),
    );
    buckets[bucket]!.push(index);
  });
  // Pauses (time basis) or GPS jumps leave some buckets empty; skip them.
  const filled = buckets.filter((indices) => indices.length > 0);

  const mean = (data: number[], digits: number) =>
    filled.map((indices) =>
      round(
        indices.reduce((sum, index) => sum + data[index]!, 0) / indices.length,
        digits,
      ),
    );

  const summary: StreamSummary = { version: STREAM_SUMMARY_VERSION, basis };
  if (aligned(streams.time)) summary.time = mean(streams.time!.data, 0);
  if (aligned(streams.distance))
    summary.distance = mean(streams.distance!.data, 1);
  if (aligned(streams.altitude))
    summary.altitude = mean(streams.altitude!.data, 1);
  if (aligned(streams.watts)) summary.watts = mean(streams.watts!.data, 0);
  if (aligned(streams.heartrate))
    summary.heartrate = mean(streams.heartrate!.data, 0);
  if (aligned(streams.latlng)) {
    // Averaging coordinates can cut corners; take each bucket's middle sample.
    const latlng = streams.latlng!.data;
    summary.latlng = filled.map((indices) => {
      const [lat, lng] = latlng[indices[Math.floor(indices.length / 2)]!]!;
      return [round(lat, 5), round(lng, 5)];
    });
  }
  return summary;
}
