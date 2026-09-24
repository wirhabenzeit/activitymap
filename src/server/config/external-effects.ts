export type ExternalEffectsEnvironment = Record<string, string | undefined>;

export const EXTERNAL_EFFECTS_DISABLED_MESSAGE =
  'External effects are disabled in this environment';

export function externalEffectsEnabled(
  environment: ExternalEffectsEnvironment = process.env,
): boolean {
  return environment.ACTIVITYMAP_EXTERNAL_EFFECTS === 'enabled';
}

/**
 * Preview deployments support interactive Strava use by default. Automated
 * work (webhooks, cron, subscription management) keeps its separate guard.
 */
export function stravaAccessEnabled(
  environment: ExternalEffectsEnvironment = process.env,
): boolean {
  return (
    externalEffectsEnabled(environment) ||
    environment.VERCEL_ENV === 'preview'
  );
}

export function requireStravaAccessEnabled(
  environment: ExternalEffectsEnvironment = process.env,
): void {
  if (!stravaAccessEnabled(environment)) {
    throw new Error(EXTERNAL_EFFECTS_DISABLED_MESSAGE);
  }
}

export function requireExternalEffectsEnabled(
  environment: ExternalEffectsEnvironment = process.env,
): void {
  if (!externalEffectsEnabled(environment)) {
    throw new Error(EXTERNAL_EFFECTS_DISABLED_MESSAGE);
  }
}
