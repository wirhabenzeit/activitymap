export type ExternalEffectsEnvironment = Record<string, string | undefined>;

export const EXTERNAL_EFFECTS_DISABLED_MESSAGE =
  'External effects are disabled in this environment';

export function externalEffectsEnabled(
  environment: ExternalEffectsEnvironment = process.env,
): boolean {
  return environment.ACTIVITYMAP_EXTERNAL_EFFECTS === 'enabled';
}

export function requireExternalEffectsEnabled(
  environment: ExternalEffectsEnvironment = process.env,
): void {
  if (!externalEffectsEnabled(environment)) {
    throw new Error(EXTERNAL_EFFECTS_DISABLED_MESSAGE);
  }
}
