# ActivityMap iOS mockup

This is the SwiftUI prototype for a future native ActivityMap client. It currently uses sample data and is not connected to the v1 API or sync engine.

## Run it

1. Use Xcode 27 or newer.
2. Copy `Config/Local.xcconfig.example` to `Config/Local.xcconfig`.
3. Add a URL-restricted public Mapbox token to the local file.
4. Open `ActivityMap.xcodeproj` and run the `ActivityMap` scheme.

Swift Package Manager pins the Mapbox dependency in `Package.resolved`. Local Xcode state and credentials are intentionally ignored.

No signing team is committed, because Simulator development does not need one and a personal team is not a shared setting. Legal links and App Store metadata also remain unset while this is a mockup.

## Deployment configuration

The app talks to an ActivityMap deployment over `/api/v1`. It never holds a database credential or a Strava token, so pointing the app at an environment means pointing it at a deployment; that deployment owns its own database.

`Config/Base.xcconfig` declares the values, `Config/Local.xcconfig` overrides them locally, and `Info.plist` surfaces them to `Networking/APIConfiguration.swift`:

| xcconfig value | Default | Purpose |
| --- | --- | --- |
| `ACTIVITYMAP_API_BASE_URL` | `http://localhost:3000` | The deployment to call |
| `ACTIVITYMAP_AUTH_CALLBACK_SCHEME` | `activitymap` | Registered in `CFBundleURLTypes`; what `ASWebAuthenticationSession` watches for |
| `ACTIVITYMAP_AUTH_REDIRECT_URI` | `activitymap://auth/callback` | Where mobile sign-in returns its one-time code |

Note that `//` starts a comment in xcconfig, so URL separators are composed from `$(SLASH)` rather than written literally.

`Info.plist` carries one narrow App Transport Security exception, permitting insecure HTTP loads to `localhost` only, so Debug builds can reach a local `pnpm dev` server. Running against a device on the LAN needs its own exception or an HTTPS tunnel.

## Local sign-in setup

Native sign-in works against an explicitly configured local server. It does **not** work against a Vercel Preview: Preview runs with `ACTIVITYMAP_EXTERNAL_EFFECTS` disabled, and `src/lib/auth.ts` only registers the Strava OAuth provider when external effects are enabled, so a Preview has no provider for the mobile flow to redirect to. Treat Preview as build-only.

Set these in the repository's `.env` or `.env.local`. `.env.example` is documentation only, so uncommenting a line there configures nothing:

| Variable | Why |
| --- | --- |
| `MOBILE_AUTH_REDIRECT_ALLOWLIST=activitymap://auth/callback` | Must match the app's `ACTIVITYMAP_AUTH_REDIRECT_URI`; matched on exact protocol, host, and path prefix |
| `ACTIVITYMAP_EXTERNAL_EFFECTS=enabled` | Without this the Strava OAuth provider is never registered and sign-in cannot start |
| `AUTH_STRAVA_ID`, `AUTH_STRAVA_SECRET` | The Strava OAuth application credentials |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Session signing, and the trusted-origin fallback |

Be aware of what the second one turns on: with external effects enabled, the local server makes real Strava API calls and real Strava writes, and any webhook or cron route you invoke acts against live data. That is why the default everywhere except production is `disabled`. Enable it deliberately, for a sign-in session you are actually testing.

The bundle identifier is `page.dominik.activitymap` and is deliberately stable, because a registered URL scheme and any future universal link both depend on it.

Production universal links can replace the custom scheme once there is a final bundle identifier, an Apple team, an Associated Domains entitlement, and a hosted AASA file. Until then the custom scheme is the supported path.

Configuration alone does not put a sign-in button in the app: `ios/ActivityMapMobileAuthTestClient/` is not part of the app target yet, and has never been compiled. Integrating it is the next iOS authentication change.

## Shared configuration direction

Portable map sources live in the validated `shared/map-catalog.json` catalogue. The web client reads it directly, while `pnpm map-catalog:generate` produces the committed Swift representation.

The v1 wire types are generated the same way. `pnpm api-dtos:generate` derives `Networking/DTO/ActivityMapAPI.generated.swift` from the Zod contracts in `src/contracts/v1`, and `pnpm api-dtos:check` fails CI if the committed Swift no longer matches them. Do not edit that file by hand; change the Zod schema and regenerate. Its hand-written companion `Networking/DTO/APISupport.swift` holds the pieces generics cannot express — the response envelope, paged lists, `JSONValue`, and the date-tolerant JSON decoder.

Each client composes those sources with platform-native additions. The React-based Friflyt GeoJSON layer therefore stays in the web adapter, and Mapbox Standard stays native to iOS. UI implementation, icons, gestures, and locale-aware date, duration, measurement, and number formatting remain native. API payloads remain defined by OpenAPI.
