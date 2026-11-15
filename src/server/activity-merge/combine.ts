import { haversineMeters } from '~/lib/activity-merge/eligibility';

import type { MergeStreams } from './streams';

/**
 * One part of a merge: the activity as Strava describes it and its streams.
 * `time` offsets are seconds from `startDate`.
 */
export type MergeSource = {
  id: string;
  startDate: Date;
  elapsedTime: number;
  movingTime: number;
  distance: number;
  totalElevationGain: number;
  streams: MergeStreams;
};

export type MergedSample = {
  /** Unix seconds. */
  timestamp: number;
  lat?: number;
  lng?: number;
  altitude?: number;
  heartrate?: number;
  cadence?: number;
  watts?: number;
  temp?: number;
  /** Metres from the start of the merged activity. */
  distance?: number;
};

export type MergedLap = {
  sourceId: string;
  /** Unix seconds. */
  start: number;
  end: number;
  /** Index range into `samples`, end exclusive. */
  first: number;
  last: number;
  distance: number;
  movingTime: number;
  elevationGain: number;
};

export type MergedRecording = {
  samples: MergedSample[];
  laps: MergedLap[];
  start: number;
  end: number;
  /** Time spent recording: the parts without the breaks between them. */
  timerTime: number;
  distance: number;
  movingTime: number;
  elevationGain: number;
  hasPosition: boolean;
};

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Concatenate parts into one recording. Samples keep their own timestamps,
 * so a break between parts stays a break (no samples), which Strava counts
 * as stopped time. Distance continues across the join rather than
 * restarting. Samples that would run backwards in time are dropped.
 */
export function combineRecordings(
  sources: readonly MergeSource[],
): MergedRecording {
  const ordered = [...sources].sort(
    (a, b) => a.startDate.getTime() - b.startDate.getTime(),
  );
  const samples: MergedSample[] = [];
  const laps: MergedLap[] = [];
  let distanceOffset = 0;
  let lastTimestamp = -Infinity;
  let hasPosition = false;

  for (const source of ordered) {
    const startSeconds = Math.floor(source.startDate.getTime() / 1000);
    const { streams } = source;
    const first = samples.length;
    let partDistance = 0;
    let lastPosition: [number, number] | null = null;
    let derivedDistance = 0;

    for (let index = 0; index < streams.time.data.length; index++) {
      const offset = streams.time.data[index]!;
      if (!finite(offset)) continue;
      const timestamp = startSeconds + Math.round(offset);
      if (timestamp <= lastTimestamp) continue;
      lastTimestamp = timestamp;

      const sample: MergedSample = { timestamp };
      const position = streams.latlng?.data[index];
      if (
        position &&
        finite(position[0]) &&
        finite(position[1]) &&
        Math.abs(position[0]) <= 90 &&
        Math.abs(position[1]) <= 180
      ) {
        sample.lat = position[0];
        sample.lng = position[1];
        hasPosition = true;
        if (lastPosition)
          derivedDistance += haversineMeters(lastPosition, position);
        lastPosition = [position[0], position[1]];
      }
      const altitude = streams.altitude?.data[index];
      if (finite(altitude)) sample.altitude = altitude;
      const heartrate = streams.heartrate?.data[index];
      // Strava sends -1 for samples without a reading.
      if (finite(heartrate) && heartrate > 0) sample.heartrate = heartrate;
      const cadence = streams.cadence?.data[index];
      if (finite(cadence) && cadence >= 0) sample.cadence = cadence;
      const watts = streams.watts?.data[index];
      if (finite(watts) && watts >= 0) sample.watts = watts;
      const temp = streams.temp?.data[index];
      if (finite(temp)) sample.temp = temp;

      const recorded = streams.distance?.data[index];
      const partValue = finite(recorded)
        ? recorded
        : lastPosition
          ? derivedDistance
          : undefined;
      if (partValue !== undefined) {
        partDistance = Math.max(partDistance, partValue);
        sample.distance = distanceOffset + partDistance;
      }
      samples.push(sample);
    }

    const last = samples.length;
    if (last === first) continue;
    // Strava's own distance is authoritative for the part's total when the
    // streams carry none.
    const lapDistance = partDistance > 0 ? partDistance : source.distance;
    laps.push({
      sourceId: source.id,
      start: samples[first]!.timestamp,
      end: samples[last - 1]!.timestamp,
      first,
      last,
      distance: lapDistance,
      movingTime: source.movingTime,
      elevationGain: source.totalElevationGain,
    });
    distanceOffset += lapDistance;
  }

  if (samples.length === 0) throw new Error('The activities have no samples.');
  return {
    samples,
    laps,
    start: samples[0]!.timestamp,
    end: samples[samples.length - 1]!.timestamp,
    timerTime: laps.reduce((sum, lap) => sum + (lap.end - lap.start), 0),
    distance: distanceOffset,
    movingTime: laps.reduce((sum, lap) => sum + lap.movingTime, 0),
    elevationGain: laps.reduce((sum, lap) => sum + lap.elevationGain, 0),
    hasPosition,
  };
}

/** Average and maximum of one field over a sample range. */
export function sampleStats(
  samples: readonly MergedSample[],
  field: 'heartrate' | 'cadence' | 'watts' | 'temp',
  first = 0,
  last = samples.length,
): { avg: number; max: number } | null {
  let sum = 0;
  let count = 0;
  let max = -Infinity;
  for (let index = first; index < last; index++) {
    const value = samples[index]![field];
    if (value === undefined) continue;
    sum += value;
    count++;
    if (value > max) max = value;
  }
  return count ? { avg: sum / count, max } : null;
}
