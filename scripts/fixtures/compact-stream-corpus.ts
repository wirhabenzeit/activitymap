import { summarizeStreams } from '../../src/server/strava/stream-summary';
import type { RawActivityStreams } from '../../src/server/strava/streams';

/** Deterministic synthetic data only. Keep codec gains separate from sampling. */
export function compactStreamCorpus() {
  return [
    { name: 'short-ride', count: 20 },
    { name: 'smooth-ride', count: 4500 },
    { name: 'long-ride', count: 18000 },
    { name: 'noisy-power', count: 4500, noisy: true },
    { name: 'flat-negative-altitude', count: 4500, flat: true },
    { name: 'pauses-irregular-axis', count: 4500, pauses: true },
    { name: 'indoor-time-no-gps', count: 4500, indoor: true },
    { name: 'sparse-sensors', count: 4500, sparse: true },
    { name: 'gps-discontinuity', count: 4500, crossing: true },
    { name: 'no-axis', count: 1, indoor: true },
  ].map((spec) => {
    let seed = 230;
    const random = () => {
      seed = (1664525 * seed + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const indices = Array.from({ length: spec.count }, (_, i) => i);
    const meta = {
      original_size: spec.count,
      resolution: 'high' as const,
      series_type: spec.indoor ? ('time' as const) : ('distance' as const),
    };
    const streams: RawActivityStreams = {
      time: { ...meta, data: indices.map((i) => i * 2) },
      altitude: {
        ...meta,
        data: indices.map((i) =>
          spec.flat ? -12.3 : 100 * Math.sin(i / 300) - 20,
        ),
      },
      heartrate: {
        ...meta,
        data: indices.map((i) => Math.round(110 + 35 * Math.sin(i / 100))),
      },
      watts: {
        ...meta,
        data: indices.map((i) =>
          Math.round(
            spec.noisy ? random() * 1200 : 180 + 100 * Math.sin(i / 80),
          ),
        ),
      },
    };
    if (!spec.indoor) {
      streams.distance = {
        ...meta,
        data: indices.map((i) =>
          spec.pauses ? Math.floor(i / 30) * 137 : i * 5.7,
        ),
      };
      streams.latlng = {
        ...meta,
        data: indices.map((i) => [
          47 + i / 1e5,
          spec.crossing ? (i < spec.count / 2 ? 179.9 : -179.9) : 8 + i / 1e5,
        ]),
      };
    }
    if (spec.sparse) {
      delete streams.watts;
      delete streams.heartrate;
    }
    return {
      name: spec.name,
      rawSamples: spec.count,
      summary: summarizeStreams(streams),
    };
  });
}
