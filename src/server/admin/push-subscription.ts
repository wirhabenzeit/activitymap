import 'server-only';

import { externalEffectsEnabled } from '~/server/config/external-effects';
import { checkWebhookStatus } from '~/server/strava/actions';

import type { PushSubscription } from './contract';

/** A good answer rarely changes; a bad one is asked again soon, so that
 * registering clears the problem. */
const GOOD_MS = 10 * 60_000;
const OTHER_MS = 60_000;
const TIMEOUT_MS = 5_000;

let cached: { value: PushSubscription; until: number } | null = null;

/** The state of Strava's push subscription, remembered between the
 * dashboard's refreshes: each question is a Strava request. */
export async function pushSubscription(): Promise<PushSubscription> {
  if (!externalEffectsEnabled()) return 'not_managed';
  if (cached && cached.until > Date.now()) return cached.value;
  let timer: NodeJS.Timeout | undefined;
  const value = await Promise.race([
    checkWebhookStatus().then(
      (status): PushSubscription =>
        status.hasMatchingSubscription ? 'registered' : 'missing',
      (): PushSubscription => 'unknown',
    ),
    new Promise<PushSubscription>((resolve) => {
      timer = setTimeout(() => resolve('unknown'), TIMEOUT_MS);
    }),
  ]);
  clearTimeout(timer);
  cached = {
    value,
    until: Date.now() + (value === 'registered' ? GOOD_MS : OTHER_MS),
  };
  return value;
}
