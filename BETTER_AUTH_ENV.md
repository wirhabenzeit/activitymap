# Better Auth Environment Variables

Add these to your `.env` file:

```bash
# Better Auth Configuration
BETTER_AUTH_SECRET=evA1k85T3xxXd+ap9K8wHv923lL2OqIKazquwYcEG3I=
BETTER_AUTH_URL=http://localhost:3000

# Strava OAuth (map from existing AUTH_STRAVA_* variables)
STRAVA_CLIENT_ID=${AUTH_STRAVA_ID}
STRAVA_CLIENT_SECRET=${AUTH_STRAVA_SECRET}

# Optional: Public app URL for client
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Notes

- `BETTER_AUTH_SECRET`: Generated using `openssl rand -base64 32`
- `BETTER_AUTH_URL`: Your app's base URL (change for production)
- `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET`: These should match your existing Strava OAuth credentials

## Existing Variables Detected

From your `.env` file:
- `AUTH_STRAVA_ID=106267`
- `AUTH_STRAVA_SECRET=b47d8fd2076ef9e194f0435b9d1791267ad70bcc`

You can either:
1. Add the new variables and keep the old ones (for gradual migration)
2. Or update your Better Auth config to use `AUTH_STRAVA_ID` and `AUTH_STRAVA_SECRET` directly
