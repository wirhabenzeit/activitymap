import 'server-only';

import { convexWriteBridge } from '~/server/sync/convex-writer';

/**
 * Erase an account's library in Convex (backend/convex/erasure.ts). Called
 * inside the transaction that deletes the account in Postgres, so a failure
 * here rolls that back and the erasure is tried again; it never leaves a
 * library in Convex that nothing in Postgres points to.
 *
 * Asked for every erased account, whether or not it was ever copied: Convex
 * answers false for a user it does not know. Without a configured Convex
 * site (local development) there is nothing to erase.
 */
export async function eraseLibraryInConvex(user: {
  id: string;
  athleteId: number | null;
}): Promise<void> {
  if (user.athleteId === null) return;
  const bridge = convexWriteBridge({
    userId: user.id,
    athleteId: user.athleteId,
  });
  if (!bridge) return;
  await bridge.write({ kind: 'eraseOwner' });
}
