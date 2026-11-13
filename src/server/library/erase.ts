import 'server-only';

import { convexWriteBridge } from '~/server/sync/convex-writer';

/** Erase the library before deleting the sign-in records that identify it.
 * A failed library erasure leaves those records available for a later retry.
 * Unknown owners are harmless; local development may have no configured site.
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
