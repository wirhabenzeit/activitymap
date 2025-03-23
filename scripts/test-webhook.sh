#!/bin/bash

# Default values if not provided - replace with your own values when testing
ACTIVITY_ID=${1:-0000000000}
OWNER_ID=${2:-0000000000}

# Test the webhook locally (replace with your local server URL if testing locally)
LOCAL_URL="http://localhost:3000/api/strava/webhook"

# Or use your production URL
PROD_URL="https://activitymap.dominik.page/api/strava/webhook"

# Choose which URL to use (uncomment one)
URL=$LOCAL_URL
#URL=$PROD_URL

# Current timestamp
CURRENT_TIME=$(date +%s)

# Print info about the test
echo "Testing webhook with activity ID: $ACTIVITY_ID"
echo "Owner ID: $OWNER_ID"
echo "Using URL: $URL"

# Sample webhook payload for an activity update
curl -X POST $URL \
  -H "Content-Type: application/json" \
  -d "{
    \"object_type\": \"activity\",
    \"object_id\": $ACTIVITY_ID,
    \"aspect_type\": \"update\",
    \"owner_id\": $OWNER_ID,
    \"subscription_id\": 123456,
    \"event_time\": $CURRENT_TIME,
    \"updates\": {
      \"title\": \"Updated via webhook test\"
    }
  }"

echo -e "\n\nDone. Check your server logs for the webhook processing output."
