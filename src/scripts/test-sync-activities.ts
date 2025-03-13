import { syncActivities } from '~/server/strava/sync';

/**
 * Simple test script to verify the syncActivities function
 * 
 * Usage:
 * - Run with a user ID to sync a specific user: npm run test:sync -- userId=1234
 * - Run without args to sync all users: npm run test:sync
 */
async function main() {
  console.log('🔄 Testing activity sync...');
  
  // Check for userId parameter from command line args
  const userIdArg = process.argv.find(arg => arg.startsWith('userId='));
  const userId = userIdArg ? userIdArg.split('=')[1] : undefined;
  
  try {
    const result = await syncActivities({
      userId,
      maxIncompleteActivities: 5, // Process fewer activities for testing
      maxOldActivities: 5,        // Process fewer activities for testing
    });
    
    console.log('✅ Sync completed successfully:', JSON.stringify(result, null, 2));
    
    if (Object.keys(result.errors).length > 0) {
      console.log('⚠️ Some users had errors:', result.errors);
    }
    
    if (result.reachedOldest.length > 0) {
      console.log('📌 These users reached their oldest activities:', result.reachedOldest);
    }
  } catch (error) {
    console.error('❌ Sync failed:', error);
  }
}

main().catch(console.error).finally(() => {
  console.log('🏁 Test script completed');
  process.exit(0);
});
