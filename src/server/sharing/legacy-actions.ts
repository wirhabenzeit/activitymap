'use server';

import { assertLegacySharingEnabled } from '~/lib/legacy-sharing';
import type { Activity } from '~/server/db/schema';

/**
 * The retired guest reads (`/map?activities=`, `/map?user=`). Legacy sharing
 * is disabled (`~/lib/legacy-sharing.ts`), so both refuse; a share link
 * (`~/server/application/share-links.ts`) is how activities are shared.
 */
export async function getPublicActivities(
  _publicIds: number[],
): Promise<Activity[]> {
  assertLegacySharingEnabled();
  throw new Error('Legacy sharing is no longer available');
}

export async function getPublicUserActivities(_input: {
  userId: string;
  limit?: number;
  offset?: number;
}): Promise<Activity[]> {
  assertLegacySharingEnabled();
  throw new Error('Legacy sharing is no longer available');
}
