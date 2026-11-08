import { ConvexError } from 'convex/values';

import type { QueryCtx } from './_generated/server';
import { ownerFor } from './owners';

/**
 * The owner behind an authenticated caller, for public functions. The token
 * subject is the application user ID. Reads follow the current assignment;
 * the owner epoch only fences writers.
 */
export async function viewer(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const owner = await ownerFor(ctx, identity.subject);
  if (!owner || owner.revoked || owner.backend !== 'convex') return null;
  return owner;
}

export async function requireViewer(ctx: QueryCtx) {
  const owner = await viewer(ctx);
  if (!owner) throw new ConvexError('not_authorized');
  return owner;
}
