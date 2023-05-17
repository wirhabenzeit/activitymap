# Display Strava activities on a map

## Example 

[Hiking Diary](https://wirhabenzeit.github.io/stravamap/)

## Replication Steps
Here are the steps I took to get this up-and-running. If other people start using this I'll find a more streamlined
way to replicate this, especially by removing the need for steps 4 and 5.

### Step 1: Prepare Strava
Create an "application" on [Strava](https://www.strava.com/settings/api). Put "local host" (without the quotes)
in the "Authorization Callback Domain" field.

### Step 2: Add Strava Secrets to Google Cloud Platform
Add `strava_client_id`, `strava_client_secret`, `strava_access_token`, `strava_refresh_token` to the Secret Manager

### Step 3: Deploy Cloud functions 
```
cd gcp 
gcloud functions deploy strava_geojson --runtime python311 --trigger-http --allow-unauthenticated
gcloud functions deploy strava_webhook --runtime python311 --trigger-http 
--allow-unauthenticated
```