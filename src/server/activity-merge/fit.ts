import { Encoder, Profile } from '@garmin/fitsdk';

import type { SportType } from '~/contracts/sport';

import { type MergedRecording, sampleStats } from './combine';

/**
 * Encode a merged recording as a FIT activity file: one session, one lap per
 * original activity, and a timer stop/start around each break so the gaps
 * read as pauses rather than as stationary recording.
 */

type FitSport = { sport: string; subSport: string };

const SPORTS: Partial<Record<SportType, FitSport>> = {
  Ride: { sport: 'cycling', subSport: 'road' },
  GravelRide: { sport: 'cycling', subSport: 'gravelCycling' },
  MountainBikeRide: { sport: 'cycling', subSport: 'mountain' },
  VirtualRide: { sport: 'cycling', subSport: 'virtualActivity' },
  Handcycle: { sport: 'cycling', subSport: 'handCycling' },
  Velomobile: { sport: 'cycling', subSport: 'recumbent' },
  EBikeRide: { sport: 'eBiking', subSport: 'generic' },
  EMountainBikeRide: { sport: 'eBiking', subSport: 'eBikeMountain' },
  Run: { sport: 'running', subSport: 'generic' },
  TrailRun: { sport: 'running', subSport: 'trail' },
  VirtualRun: { sport: 'running', subSport: 'virtualActivity' },
  Walk: { sport: 'walking', subSport: 'generic' },
  Hike: { sport: 'hiking', subSport: 'generic' },
  Swim: { sport: 'swimming', subSport: 'openWater' },
  AlpineSki: { sport: 'alpineSkiing', subSport: 'generic' },
  BackcountrySki: { sport: 'alpineSkiing', subSport: 'backcountry' },
  NordicSki: { sport: 'crossCountrySkiing', subSport: 'generic' },
  RollerSki: { sport: 'crossCountrySkiing', subSport: 'generic' },
  Snowboard: { sport: 'snowboarding', subSport: 'generic' },
  Snowshoe: { sport: 'snowshoeing', subSport: 'generic' },
  IceSkate: { sport: 'iceSkating', subSport: 'generic' },
  InlineSkate: { sport: 'inlineSkating', subSport: 'generic' },
  Kayaking: { sport: 'kayaking', subSport: 'generic' },
  Canoeing: { sport: 'canoeing', subSport: 'generic' },
  Rowing: { sport: 'rowing', subSport: 'generic' },
  VirtualRow: { sport: 'rowing', subSport: 'indoorRowing' },
  StandUpPaddling: { sport: 'standUpPaddleboarding', subSport: 'generic' },
  Surfing: { sport: 'surfing', subSport: 'generic' },
  Kitesurf: { sport: 'kitesurfing', subSport: 'generic' },
  Windsurf: { sport: 'windsurfing', subSport: 'generic' },
  Sail: { sport: 'sailing', subSport: 'generic' },
  RockClimbing: { sport: 'rockClimbing', subSport: 'generic' },
  Golf: { sport: 'golf', subSport: 'generic' },
  Wheelchair: { sport: 'wheelchairPushWalk', subSport: 'generic' },
};

/** The FIT sport for a Strava sport. The upload is followed by an explicit
 * sport update, so this only has to be close. */
export function fitSport(sport: SportType, trainer = false): FitSport {
  const mapped = SPORTS[sport] ?? { sport: 'generic', subSport: 'generic' };
  if (trainer && mapped.sport === 'cycling')
    return { sport: 'cycling', subSport: 'indoorCycling' };
  return mapped;
}

const mesgNum = (name: string): number => {
  const value = Profile.MesgNum[name];
  if (value === undefined) throw new Error(`Unknown FIT message ${name}`);
  return value;
};
const MESG_NUM = {
  FILE_ID: mesgNum('FILE_ID'),
  EVENT: mesgNum('EVENT'),
  RECORD: mesgNum('RECORD'),
  LAP: mesgNum('LAP'),
  SESSION: mesgNum('SESSION'),
  ACTIVITY: mesgNum('ACTIVITY'),
};

const SEMICIRCLES = 2 ** 31 / 180;
const semicircles = (degrees: number) => Math.round(degrees * SEMICIRCLES);
const date = (unixSeconds: number) => new Date(unixSeconds * 1000);
const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));
const altitude = (value: number) => Math.min(12_000, Math.max(-500, value));

export function encodeMergedFit(
  recording: MergedRecording,
  options: {
    sport: SportType;
    trainer?: boolean;
    /** Seconds east of UTC at the start, for the local timestamp. */
    utcOffsetSeconds?: number;
    now?: Date;
  },
): Uint8Array {
  const { samples, laps } = recording;
  const { sport, subSport } = fitSport(options.sport, options.trainer);
  const encoder = new Encoder();
  const M = MESG_NUM;
  const created = options.now ?? new Date();
  // Field names and enum strings follow Garmin's profile; the encoder
  // validates them against it at runtime.
  const write = (num: number, mesg: Record<string, unknown>) =>
    encoder.onMesg(num, mesg);

  write(M.FILE_ID, {
    type: 'activity',
    manufacturer: 'development',
    product: 0,
    serialNumber: 0x41_4d_01,
    timeCreated: new Date(Math.floor(created.getTime() / 1000) * 1000),
    productName: 'ActivityMap merge',
  });

  write(M.EVENT, {
    timestamp: date(recording.start),
    event: 'timer',
    eventType: 'start',
    eventGroup: 0,
  });

  laps.forEach((lap, lapIndex) => {
    if (lapIndex > 0)
      write(M.EVENT, {
        timestamp: date(lap.start),
        event: 'timer',
        eventType: 'start',
        eventGroup: 0,
      });
    for (let index = lap.first; index < lap.last; index++) {
      const sample = samples[index]!;
      write(M.RECORD, {
        timestamp: date(sample.timestamp),
        ...(sample.lat !== undefined &&
          sample.lng !== undefined && {
            positionLat: semicircles(sample.lat),
            positionLong: semicircles(sample.lng),
          }),
        ...(sample.altitude !== undefined && {
          altitude: altitude(sample.altitude),
        }),
        ...(sample.distance !== undefined && { distance: sample.distance }),
        ...(sample.heartrate !== undefined && {
          heartRate: clamp(sample.heartrate, 0, 254),
        }),
        ...(sample.cadence !== undefined && {
          cadence: clamp(sample.cadence, 0, 254),
        }),
        ...(sample.watts !== undefined && {
          power: clamp(sample.watts, 0, 65_534),
        }),
        ...(sample.temp !== undefined && {
          temperature: clamp(sample.temp, -127, 127),
        }),
      });
    }
    write(M.EVENT, {
      timestamp: date(lap.end),
      event: 'timer',
      eventType: 'stopAll',
      eventGroup: 0,
    });
    const first = samples[lap.first]!;
    const last = samples[lap.last - 1]!;
    const hr = sampleStats(samples, 'heartrate', lap.first, lap.last);
    const cad = sampleStats(samples, 'cadence', lap.first, lap.last);
    const pow = sampleStats(samples, 'watts', lap.first, lap.last);
    const elapsed = lap.end - lap.start;
    write(M.LAP, {
      messageIndex: lapIndex,
      timestamp: date(lap.end),
      startTime: date(lap.start),
      event: 'lap',
      eventType: 'stop',
      lapTrigger: lapIndex === laps.length - 1 ? 'sessionEnd' : 'manual',
      sport,
      subSport,
      totalElapsedTime: elapsed,
      totalTimerTime: elapsed,
      totalMovingTime: Math.min(lap.movingTime, elapsed),
      totalDistance: lap.distance,
      totalAscent: clamp(lap.elevationGain, 0, 65_534),
      ...(first.lat !== undefined &&
        first.lng !== undefined && {
          startPositionLat: semicircles(first.lat),
          startPositionLong: semicircles(first.lng),
        }),
      ...(last.lat !== undefined &&
        last.lng !== undefined && {
          endPositionLat: semicircles(last.lat),
          endPositionLong: semicircles(last.lng),
        }),
      ...(hr && {
        avgHeartRate: clamp(hr.avg, 0, 254),
        maxHeartRate: clamp(hr.max, 0, 254),
      }),
      ...(cad && {
        avgCadence: clamp(cad.avg, 0, 254),
        maxCadence: clamp(cad.max, 0, 254),
      }),
      ...(pow && {
        avgPower: clamp(pow.avg, 0, 65_534),
        maxPower: clamp(pow.max, 0, 65_534),
      }),
    });
  });

  const first = samples[0]!;
  const hr = sampleStats(samples, 'heartrate');
  const cad = sampleStats(samples, 'cadence');
  const pow = sampleStats(samples, 'watts');
  const elapsed = recording.end - recording.start;
  write(M.SESSION, {
    messageIndex: 0,
    timestamp: date(recording.end),
    startTime: date(recording.start),
    event: 'session',
    eventType: 'stop',
    trigger: 'activityEnd',
    sport,
    subSport,
    firstLapIndex: 0,
    numLaps: laps.length,
    totalElapsedTime: elapsed,
    totalTimerTime: recording.timerTime,
    totalMovingTime: Math.min(recording.movingTime, recording.timerTime),
    totalDistance: recording.distance,
    totalAscent: clamp(recording.elevationGain, 0, 65_534),
    ...(first.lat !== undefined &&
      first.lng !== undefined && {
        startPositionLat: semicircles(first.lat),
        startPositionLong: semicircles(first.lng),
      }),
    ...(hr && {
      avgHeartRate: clamp(hr.avg, 0, 254),
      maxHeartRate: clamp(hr.max, 0, 254),
    }),
    ...(cad && {
      avgCadence: clamp(cad.avg, 0, 254),
      maxCadence: clamp(cad.max, 0, 254),
    }),
    ...(pow && {
      avgPower: clamp(pow.avg, 0, 65_534),
      maxPower: clamp(pow.max, 0, 65_534),
    }),
  });

  write(M.ACTIVITY, {
    timestamp: date(recording.end),
    totalTimerTime: recording.timerTime,
    numSessions: 1,
    type: 'manual',
    event: 'activity',
    eventType: 'stop',
    localTimestamp:
      recording.end + (options.utcOffsetSeconds ?? 0) - FIT_EPOCH_SECONDS,
  });

  return encoder.close();
}

/** 1989-12-31T00:00:00Z, the FIT epoch, in Unix seconds. */
const FIT_EPOCH_SECONDS = 631_065_600;
