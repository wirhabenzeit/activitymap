import { checkWebhookStatus } from '../src/server/strava/actions';

async function main() {
  try {
    console.log('Checking webhook status and syncing to database...');
    const result = await checkWebhookStatus();
    
    console.log('Webhook status check complete:');
    console.log('- Expected URL:', result.expectedUrl);
    console.log('- Has matching subscription:', result.hasMatchingSubscription);
    console.log('- Database status:', result.databaseStatus);
    
    if (result.matchingSubscription) {
      console.log('- Matching subscription found');
      console.log('- Created at:', new Date(result.matchingSubscription.created_at).toISOString());
      console.log('- Updated at:', new Date(result.matchingSubscription.updated_at).toISOString());
    } else {
      console.log('No matching subscription found. You may need to create a new webhook subscription.');
    }
    
    console.log('\nNumber of active Strava subscriptions:', result.subscriptions.length);
  } catch (error) {
    console.error('Error syncing webhook:', error);
  } finally {
    process.exit(0);
  }
}

main().catch(console.error);
