import { after } from 'next/server';

import {
  mirroredOwners,
  runCatalogueMirror,
  runShadowMirror,
} from '~/server/convex-mirror/shadow-run';
import { logger } from '~/server/logging/logger';

import {
  CHAIN_HEADER,
  createConvexShadowCronHandler,
  shouldContinue,
} from './handler';

export const maxDuration = 60;
const run = createConvexShadowCronHandler({
  // Off unless owners are listed explicitly and automated external effects
  // are enabled for this deployment.
  owners: mirroredOwners,
  secret: () => process.env.CRON_SECRET,
  run: runShadowMirror,
  // Several accounts can be copying at once; each gets a share.
  fair: true,
  onError: (error, userId) =>
    logger.error('Convex shadow write failed', { error, userId }),
  // The place catalogue is copied in what remains of each run's budget.
  shared: {
    name: 'catalogue',
    run: runCatalogueMirror,
    onError: (error) => logger.error('Convex catalogue copy failed', { error }),
  },
});

/**
 * A run has forty seconds, and the schedule starts one every ten minutes.
 * While an account's library is still being copied, the run starts the next
 * one itself when it is done, so the copy proceeds back to back until the
 * next scheduled trigger takes over.
 */
export async function POST(request: Request) {
  const response = await run(request);
  const chained = Number(request.headers.get(CHAIN_HEADER) ?? 0);
  const secret = process.env.CRON_SECRET;
  let body = null;
  try {
    body = (await response.clone().json()) as {
      results?: Record<string, unknown>;
    };
  } catch {
    // Not a result to continue from.
  }
  if (secret && Number.isInteger(chained) && shouldContinue(body, chained))
    after(async () => {
      try {
        // Only long enough to hand the request over: the next run answers
        // after its own forty seconds.
        await fetch(request.url, {
          method: 'POST',
          headers: {
            'x-cron-secret': secret,
            [CHAIN_HEADER]: String(chained + 1),
          },
          signal: AbortSignal.timeout(3_000),
        });
      } catch {
        // The scheduled trigger continues the copy in any case.
      }
    });
  return response;
}
