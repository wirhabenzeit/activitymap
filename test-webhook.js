// Simple script to test the Strava webhook endpoint
const fetch = require('node-fetch');

// Replace with your local or production URL
const WEBHOOK_URL = 'http://localhost:3000/api/strava/webhook';

// Sample webhook event data
const webhookEvent = {
  object_type: 'activity',
  object_id: 12345678901,
  aspect_type: 'create',
  owner_id: 12345, // Replace with a valid athlete ID from your database
  subscription_id: 1,
  event_time: Math.floor(Date.now() / 1000)
};

async function testWebhook() {
  console.log('Sending test webhook event to:', WEBHOOK_URL);
  console.log('Event data:', webhookEvent);
  
  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookEvent),
    });
    
    const text = await response.text();
    console.log(`Response status: ${response.status}`);
    console.log(`Response body: ${text}`);
    
    if (response.ok) {
      console.log('✅ Webhook test successful!');
    } else {
      console.log('❌ Webhook test failed!');
    }
  } catch (error) {
    console.error('Error sending webhook test:', error);
  }
}

testWebhook();
