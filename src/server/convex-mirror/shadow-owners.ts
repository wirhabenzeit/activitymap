import { z } from 'zod';

const ownersSchema = z.array(z.string().min(1).max(128)).max(50);

/** `ACTIVITYMAP_CONVEX_SHADOW_OWNERS`: a JSON array of application user IDs.
 * Unset means shadow writes are off. */
export function shadowOwners(value: string | undefined): string[] | null {
  if (!value) return null;
  return ownersSchema.parse(JSON.parse(value));
}
