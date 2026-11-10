import 'server-only';

import type { Actor } from '~/server/auth/actor';

import { convexWriteBridge } from './convex-writer';

/** What Convex records for one provider event
 * (backend/convex/providerEvents.ts). */
export type ConvexProviderEvent = {
  /** The sender's ID for the delivery; Convex records it once. */
  event: string;
  activityId: string;
  aspect: 'create' | 'update' | 'delete';
  eventTime: number;
};

/**
 * Hand one provider event to Convex through the signed write bridge, with
 * the owner's current epoch. Resolves once Convex has committed its record;
 * rejects when Convex does not write for the owner.
 */
export async function sendEventToConvex(
  owner: Pick<Actor, 'userId' | 'athleteId'>,
  event: ConvexProviderEvent,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const writer = convexWriteBridge(owner, fetcher);
  if (!writer) throw new Error('ACTIVITYMAP_CONVEX_SITE is not configured');
  const state = await writer.write<{ epoch: string } | null>({ kind: 'state' });
  if (!state) throw new Error('The owner is not provisioned in Convex');
  await writer.write({ kind: 'recordEvents', events: [event] }, state.epoch);
}
