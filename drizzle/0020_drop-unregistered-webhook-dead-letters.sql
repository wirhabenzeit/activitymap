-- Strava delivers webhooks for every athlete who ever authorised the app,
-- including athletes without an ActivityMap account. Those deliveries were
-- recorded and immediately dead-lettered ("No account or valid access token
-- found"). The webhook route now acknowledges them without storing them;
-- remove the ones already recorded. Data only: no schema change.
DELETE FROM "strava_webhook_events" AS e
WHERE e."status" = 'dead_letter'
  AND NOT EXISTS (
    SELECT 1
    FROM "account" AS a
    WHERE a."providerId" = 'strava'
      AND a."accountId" = e."owner_id"::text
  );
