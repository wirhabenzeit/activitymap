import { eq } from 'drizzle-orm';

import { db } from '~/server/db';
import { users } from '~/server/db/schema';
import { logger } from '~/server/logging/logger';
import { providerGatewayConfig } from '~/server/provider-gateway/config';
import {
  gatewayFailureFor,
  readFromStrava,
} from '~/server/provider-gateway/strava';
import { writerOf } from '~/server/repositories/writers';

import { createProviderGatewayHandler } from './handler';

export const maxDuration = 60;
export const POST = createProviderGatewayHandler({
  // Off unless keys are configured and automated external effects are
  // enabled for this deployment.
  config: providerGatewayConfig,
  // Exactly the accounts whose library Convex writes.
  serves: async (userId) => (await writerOf(userId)) === 'convex',
  athleteFor: async (userId) => {
    const [user] = await db
      .select({ athleteId: users.athlete_id })
      .from(users)
      .where(eq(users.id, userId));
    return user?.athleteId ?? null;
  },
  read: readFromStrava,
  failureFor: gatewayFailureFor,
  onFailure: (failure, operation) =>
    logger.info('Provider gateway read failed', {
      kind: operation.kind,
      failure: failure.kind,
    }),
  onError: (error) =>
    logger.error('Provider gateway request failed', { error }),
});
