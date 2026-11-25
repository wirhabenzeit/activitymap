import type { RawActivityStreams } from '../../../../../src/server/strava/streams';

export const FIXTURE_SAMPLES = {
  small: 96,
  typical: 4800,
  oversized: 20000,
  largest: 172071,
} as const;

export function generateFixture(length: number): RawActivityStreams {
  const metadata = {
    resolution: 'high',
    series_type: 'time',
    original_size: length,
  } as const;
  let randomState = 76839;
  const noise = () => {
    randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  return {
    time: {
      ...metadata,
      type: 'time',
      data: Array.from({ length }, (_, i) => 2 * i + (i % 5 === 0 ? 1 : 0)),
    },
    distance: {
      ...metadata,
      data: Array.from({ length }, (_, i) => (i * 34 + (i % 7)) / 10),
    },
    latlng: {
      ...metadata,
      type: 'latlng',
      data: Array.from({ length }, (_, i) => [
        (4_600_000 + Math.floor(i / 4) + Math.floor(noise() * 3)) / 1e5,
        (800_000 + Math.floor(i / 2) + Math.floor(noise() * 3)) / 1e5,
      ]),
      extra: {
        labels: ['fixture', '測試'],
        nullable: null,
        flags: [false, true],
      },
    },
    altitude: {
      ...metadata,
      data: Array.from(
        { length },
        (_, i) => Math.round((100 * Math.sin(i / 300) + noise()) * 10) / 10,
      ),
    },
    watts: {
      ...metadata,
      data: Array.from({ length }, () => Math.floor(noise() * 300)),
    },
    heartrate: {
      ...metadata,
      data: Array.from({ length }, (_, i) =>
        i % 79 === 0 ? -1 : 100 + Math.floor(noise() * 70),
      ),
    },
  };
}
