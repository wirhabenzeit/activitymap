import 'server-only';

import { requireAdmin } from '~/server/auth/admin';

import type { AdminSnapshot } from './contract';
import { readAdminFigures } from './convex-admin';
import { pushSubscription } from './push-subscription';

/** Everything the dashboard shows, for a signed-in admin. Every page reads
 * it, so the check runs for each of them: a layout's check would not. */
export async function loadAdminSnapshot(): Promise<AdminSnapshot> {
  await requireAdmin();
  const [figures, subscription] = await Promise.all([
    readAdminFigures(),
    pushSubscription(),
  ]);
  return { ...figures, subscription };
}
