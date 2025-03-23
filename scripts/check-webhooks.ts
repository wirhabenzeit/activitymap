import { db } from '../src/server/db';
import { stravaWebhooks } from '../src/server/db/schema';

async function main() {
  try {
    // Query all webhooks
    const allWebhooks = await db.select().from(stravaWebhooks);
    console.log('All Strava webhooks in database:');
    console.log(JSON.stringify(allWebhooks, null, 2));
    
    // If you need to check a specific webhook, uncomment and provide ID
    // const webhookId = process.argv[2];
    // if (webhookId) {
    //   const specificWebhook = await db.query.stravaWebhooks.findFirst({
    //     where: eq(stravaWebhooks.subscriptionId, parseInt(webhookId))
    //   });
    //   console.log(`\nWebhook with ID ${webhookId}:`);
    //   console.log(JSON.stringify(specificWebhook, null, 2));
    // }
  } catch (error) {
    console.error('Error querying webhooks:', error);
  } finally {
    process.exit(0);
  }
}

main().catch(console.error);
