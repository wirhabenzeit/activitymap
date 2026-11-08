import { encodeStreamSummary } from '../../src/lib/streams/compact-summary';
import {
  streamSummarySchema,
  summarizeStreams,
} from '../../src/server/strava/stream-summary';
import type { RawActivityStreams } from '../../src/server/strava/streams';

export function recordingSummary(streams: RawActivityStreams) {
  const summary = summarizeStreams(streams);
  try {
    return encodeStreamSummary(summary);
  } catch {
    // Existing compact v1 intentionally refuses unsupported precision.
    // Preserve a valid downsampled summary. Extreme inputs can overflow the
    // sampler's arithmetic, in which case raw storage still succeeds.
    const checked = streamSummarySchema.safeParse(summary);
    return checked.success ? checked.data : null;
  }
}
