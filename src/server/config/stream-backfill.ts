import {
  externalEffectsEnabled,
  type ExternalEffectsEnvironment,
} from './external-effects';

/** Stream backfill ships enabled in production; the optional switch pauses it. */
export function streamBackfillEnabled(
  environment: ExternalEffectsEnvironment = process.env,
): boolean {
  return (
    environment.VERCEL_ENV === 'production' &&
    externalEffectsEnabled(environment) &&
    environment.ACTIVITYMAP_STREAM_BACKFILL !== 'disabled'
  );
}
