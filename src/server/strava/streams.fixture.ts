import type { RawActivityStreams } from './streams';

/** Includes pauses, decimals, a shorter sensor stream and extra metadata. */
export const RAW_STREAMS_FIXTURE = {
  time: {
    data: [0, 1, 7, 25],
    original_size: 4,
    resolution: 'high',
    series_type: 'time',
  },
  distance: {
    data: [0, 2.25, 2.25, 8.125],
    original_size: 4,
    resolution: 'high',
    series_type: 'time',
  },
  latlng: {
    data: [
      [47.001, 8.01],
      [47.002, 8.012],
      [47.002, 8.012],
      [47.003, 8.015],
    ],
    original_size: 4,
    resolution: 'high',
    series_type: 'time',
  },
  altitude: {
    data: [-1.5, 0, 0.25, 6.875],
    original_size: 4,
    resolution: 'high',
    series_type: 'time',
    upstream_metadata: { source: 'device' },
  },
  watts: {
    data: [0, 210, 187, 92],
    original_size: 4,
    resolution: 'high',
    series_type: 'time',
  },
  heartrate: {
    data: [89, 121, 130],
    original_size: 3,
    resolution: 'medium',
    series_type: 'distance',
  },
} satisfies RawActivityStreams;
