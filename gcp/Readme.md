# To deploy

    gcloud functions deploy strava_geojson --runtime python311 --trigger-http --allow-unauthenticated
    gcloud functions deploy strava_webhook --runtime python311 --trigger-http --allow-unauthenticated