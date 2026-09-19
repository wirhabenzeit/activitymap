import { db } from '../src/server/db';
import { stravaWebhooks } from '../src/server/db/schema';
import { logger } from '../src/server/logging/logger';

async function main() {
  try {
    // Select only diagnostic metadata. In particular, never load or print the
    // stored webhook verification token.
    const allWebhooks = await db
      .select({
        id: stravaWebhooks.id,
        subscriptionId: stravaWebhooks.subscriptionId,
        callbackUrl: stravaWebhooks.callbackUrl,
        createdAt: stravaWebhooks.createdAt,
        updatedAt: stravaWebhooks.updatedAt,
      })
      .from(stravaWebhooks);

    logger.info('Strava webhooks in database:', allWebhooks);
  } catch (error) {
    logger.error('Error querying webhooks:', error);
  } finally {
    process.exit(0);
  }
}

main().catch((error: unknown) =>
  logger.error('Webhook inspection failed:', error),
);
