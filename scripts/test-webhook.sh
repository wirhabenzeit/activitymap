#!/bin/bash

# Default values if not provided - replace with your own values when testing
ACTIVITY_ID=${1:-0000000000}
OWNER_ID=${2:-0000000000}

# Local development only. Deliveries must use the secret callback URL
# (/api/strava/webhook/<STRAVA_WEBHOOK_CALLBACK_SECRET>); never point this at
# production, where it would inject a fake Strava event.
if [ -z "$STRAVA_WEBHOOK_CALLBACK_SECRET" ]; then
  echo "Set STRAVA_WEBHOOK_CALLBACK_SECRET to your local value." >&2
  exit 1
fi
URL="http://localhost:3000/api/strava/webhook/$STRAVA_WEBHOOK_CALLBACK_SECRET"

# Current timestamp
CURRENT_TIME=$(date +%s)

# Print info about the test
echo "Testing webhook with activity ID: $ACTIVITY_ID"
echo "Owner ID: $OWNER_ID"
echo "Using URL: http://localhost:3000/api/strava/webhook/<secret>"

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
