import { query } from './_generated/server';
import { viewer } from './viewer';

/**
 * Public library queries for authenticated clients. Every function derives
 * the owner from the caller's token and takes no user argument.
 */

/** Who the caller is to this backend: signed in, and served from Convex. */
export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const owner = await viewer(ctx);
    return {
      signedIn: identity !== null,
      userId: identity?.subject ?? null,
      athleteId: owner?.athleteId ?? null,
      served: owner !== null,
    };
  },
});
