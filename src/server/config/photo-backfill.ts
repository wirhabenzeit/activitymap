import {
  externalEffectsEnabled,
  type ExternalEffectsEnvironment,
} from './external-effects';

/** Photo catch-up ships enabled in production; the optional switch pauses it. */
export function photoBackfillEnabled(
  environment: ExternalEffectsEnvironment = process.env,
): boolean {
  return (
    environment.VERCEL_ENV === 'production' &&
    externalEffectsEnabled(environment) &&
    environment.ACTIVITYMAP_PHOTO_BACKFILL !== 'disabled'
  );
}
